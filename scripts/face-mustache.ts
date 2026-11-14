import { FaceDetector } from "@mediapipe/tasks-vision";

/**
 * 取り込みのページの写真から顔を見つけ、鼻と口の間にヒゲの絵（SVG）を重ねる。外のライブラリを束ねる見本で、
 * `pnpm run build` が `@mediapipe/tasks-vision` ごと 1 本の JS にして `generated/face-mustache.ts` に書く。
 *
 * 置き方は ICS MEDIA の記事 https://ics.media/entry/240709/ と同じ: 顔検出が返す 6 点（両目・鼻先・口の中心・両耳）から、
 * 傾き（両目の並び）・大きさ（両耳の距離）・位置（鼻先から口の中心へ）を決める。記事は Web カメラの動画に
 * TensorFlow.js の包みを使う。ここは静止画なので、同じ検出器（MediaPipe の BlazeFace short range）を
 * `@mediapipe/tasks-vision` の `FaceDetector` で呼ぶ。
 *
 * 探すのは主フレームと、同じ origin の子フレーム（`<frameset>` の `<frame>` も）の `<img>` で、縦横とも 96 px 以上の物。
 * 写真は描き直さない —— 足すのは写真の上に重ねる `<svg>` だけで、`data-capture-script="face-mustache"` を付ける。
 * 別 origin の子フレームは触れないので飛ばし、CORS の無い別 origin の絵は画素を読めないので `unreadable` に数える。
 *
 * **外へ読みに行く物**（顔を検出する絵が 1 枚以上在るときだけ。無ければ何も読まずに報告する）:
 * - jsDelivr の `@mediapipe/tasks-vision@<束ねた版>/wasm` の `vision_wasm_internal.js`（約 320 KB）と
 *   `vision_wasm_internal.wasm`（約 11 MB）。WASM は束ねた JS と同じ版でなければ動かないので、版は build が
 *   package の版から書き込む
 * - storage.googleapis.com の BlazeFace short range のモデル（float16・約 230 KB）
 *
 * 読み込み元を替える設定は持たない。版の設定（`__bh.opts`）は WACZ に残らないので、替えると何を読んだかが
 * 記録から言えなくなる。読んだ物は通信の記録として WARC に残る。
 *
 * **`catalog.json` で `default: false`。** 走らせると頁ごとに WASM の約 11 MB を取りに行く。名指したクロールでだけ走る。
 * 1.x の `@mediapipe/tasks-vision` は使い方の統計を外（`odml.pa.googleapis.com`）へ送るので、0.10 の版に留める。
 *
 * ライブラリの license は Apache-2.0（https://www.apache.org/licenses/LICENSE-2.0 ・束ねた JS の先頭にも書く）。
 *
 * 予算は `__bh.remainingMs` で見て、尽きたら残りの絵を見ずに報告する。検出器の読み込みの途中では止まれない。
 * 報告: 絵の数・顔の数・描いた数・読めなかった数・準備と全体の ms・顔ごとの位置（絵の画素）・大きさ（両耳の距離）・
 * 傾き（度）・確からしさ。
 */
declare const TASKS_VISION_VERSION: string;

(async () => {
  const id = "face-mustache";
  const wasmBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
  const model =
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
  /** 予算がこれを切ったら、次の絵を見ない */
  const reserveMs = 500;
  const t0 = performance.now();

  /** ヒゲの形。幅 2（-1〜1）の座標で書いた 4 本の 3 次ベジェ */
  const path =
    "M0 -0.18" +
    "C0.25 -0.42 0.75 -0.3 1 -0.05" +
    "C0.8 0.22 0.35 0.3 0 0.08" +
    "C-0.35 0.3 -0.8 0.22 -1 -0.05" +
    "C-0.75 -0.3 -0.25 -0.42 0 -0.18Z";

  type Point = { x: number; y: number };
  /** 6 点（絵の画素）からヒゲの置き場所を決める。中心・半分の幅・傾き（ラジアン）と、大きさの元の顔の幅 */
  const place = (points: readonly Point[]) => {
    const [eyeA, eyeB, nose, mouth, earA, earB] = points;
    if (!eyeA || !eyeB || !nose || !mouth || !earA || !earB) return null;
    // 両目の並びの向き。どちらの目が左でも、右向きのベクトルに揃える
    const [left, right] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
    const faceWidth = Math.hypot(earA.x - earB.x, earA.y - earB.y);
    return {
      cx: nose.x + (mouth.x - nose.x) * 0.55,
      cy: nose.y + (mouth.y - nose.y) * 0.55,
      half: faceWidth * 0.24,
      angle: Math.atan2(right.y - left.y, right.x - left.x),
      faceWidth,
    };
  };

  // 主フレームと、同じ origin の子フレームの文書を集める。別 origin は document を読むと投げるので飛ばす
  const docs: Document[] = [];
  const walk = (w: Window): void => {
    try {
      docs.push(w.document);
    } catch {
      return;
    }
    for (let i = 0; i < w.frames.length; i++) {
      const child = w.frames[i];
      if (child) walk(child);
    }
  };
  walk(window);

  // 小さな絵（飾り・アイコン）は検出に掛けない
  const images = docs
    .flatMap((doc) => Array.from(doc.images))
    .filter((img) => img.complete && img.naturalWidth >= 96 && img.naturalHeight >= 96);
  const placed: { src: string; x: number; y: number; faceWidth: number; angleDeg: number; score: number }[] = [];
  let faces = 0;
  let drawn = 0;
  let unreadable = 0;
  let stopped = false;
  let readyMs: number | undefined;

  if (images.length > 0 && globalThis.__bh.remainingMs >= reserveMs) {
    const detector = await FaceDetector.createFromOptions(
      { wasmLoaderPath: `${wasmBase}/vision_wasm_internal.js`, wasmBinaryPath: `${wasmBase}/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: model, delegate: "CPU" }, runningMode: "IMAGE" },
    );
    readyMs = Math.round(performance.now() - t0);
    // ライブラリは WASM の読み込み役を <script> で主フレームの body に足す。読み終えた後は要らないので、
    // 頁に足した物を data-capture-script の要素だけにする（写しに外の <script> を残さない）
    for (const loader of document.querySelectorAll(`script[src^="${wasmBase}/"]`)) loader.remove();
    try {
      for (const img of images) {
        if (globalThis.__bh.remainingMs < reserveMs) {
          stopped = true;
          break;
        }
        let bitmap: ImageBitmap;
        let detections;
        try {
          // 子フレームの <img> は別の realm の物なので、主フレームの ImageBitmap にしてから渡す
          bitmap = await createImageBitmap(img);
          detections = detector.detect(bitmap).detections;
        } catch (error) {
          unreadable++;
          globalThis.__bh.log.warn("絵の画素を読めない", { src: (img.currentSrc || img.src).slice(0, 300), error: String(error) });
          continue;
        }
        const { width, height } = bitmap;
        bitmap.close();
        const spots = [];
        for (const detection of detections) {
          faces++;
          const spot = place(detection.keypoints.map((k) => ({ x: k.x * width, y: k.y * height })));
          if (!spot) continue;
          spots.push(spot);
          placed.push({
            src: (img.currentSrc || img.src).slice(0, 300),
            x: Math.round(spot.cx),
            y: Math.round(spot.cy),
            faceWidth: Math.round(spot.faceWidth),
            angleDeg: Number(((spot.angle * 180) / Math.PI).toFixed(1)),
            score: Number((detection.categories[0]?.score ?? 0).toFixed(3)),
          });
        }
        if (spots.length === 0) continue;

        // 絵の画素の座標（viewBox）で描き、要素の大きさに伸ばして、絵の真上に置く
        const doc = img.ownerDocument;
        const rect = img.getBoundingClientRect();
        const view = doc.defaultView;
        const ns = "http://www.w3.org/2000/svg";
        const svg = doc.createElementNS(ns, "svg");
        svg.setAttribute("data-capture-script", id);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("width", String(rect.width));
        svg.setAttribute("height", String(rect.height));
        svg.setAttribute(
          "style",
          `position:absolute;left:${rect.left + (view?.scrollX ?? 0)}px;top:${rect.top + (view?.scrollY ?? 0)}px;` +
            "pointer-events:none;z-index:2147483647",
        );
        for (const spot of spots) {
          const mustache = doc.createElementNS(ns, "path");
          mustache.setAttribute("d", path);
          mustache.setAttribute("fill", "#1b1410");
          mustache.setAttribute(
            "transform",
            `translate(${spot.cx} ${spot.cy}) rotate(${(spot.angle * 180) / Math.PI}) scale(${spot.half})`,
          );
          svg.appendChild(mustache);
        }
        (doc.body ?? doc.documentElement).appendChild(svg);
        drawn += spots.length;
      }
    } finally {
      detector.close();
    }
  } else if (images.length > 0) {
    stopped = true;
  }

  globalThis.__bh.report({
    images: images.length,
    faces,
    drawn,
    unreadable,
    stopped,
    ...(readyMs === undefined ? {} : { readyMs }),
    totalMs: Math.round(performance.now() - t0),
    placed,
  });
})();
