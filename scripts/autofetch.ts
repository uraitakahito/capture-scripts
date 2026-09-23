/**
 * ページが参照 **しうる** 画像の URL を能動的に取りに行く —— `srcset` の候補すべて
 * (1x / 2x、小・中・大)、`data-src` の遅延属性、`poster`、同一 origin のスタイルシートの
 * `url(...)` —— いまの viewport と DPR が選ばなかったものまで含めて。この取得は
 * NetworkRecorder が見ているのと同じネットワーク経路を通るので、そのバイト列は WARC に載る。
 *
 * かつて BrowserHive に同梱されていた built-in の `autofetch` を、**リクエストで送る形**
 * に書き直したもの。同梱の `ctx.Lib` が無くなったので、使っていた DOM ヘルパは
 * このファイルの中に畳んである。
 *
 * これが要る理由: 1280px・DPR 1 の取り込みは `_large` (1x) の候補しか **要求しない** ので、
 * Retina の replay が求める `_2x` が archive に無い。これがそれを引き込む。
 *
 * 設定は `__bh.opts["autofetch"]` から: maxUrls (既定 2000)
 */
(async () => {
  const opts = globalThis.__bh.opts["autofetch"] ?? {};
  const maxUrls = Number(opts.maxUrls ?? 2000);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const toAbsolute = (url: string, base?: string): string | null => {
    try {
      return new URL(url, base ?? document.baseURI).href;
    } catch {
      return null;
    }
  };

  const urls = new Set<string>();
  const push = (u: string | null | undefined) => {
    const abs = u && toAbsolute(u);
    if (abs) urls.add(abs);
  };

  const nodes = document.querySelectorAll(
    "img,source,[data-src],[data-srcset],[data-lazy-src],[poster]",
  );
  // `currentSrc` は、取り込み時の viewport と DPR のもとでブラウザがその要素に対して
  // 実際に選んだ 1 つ。それ以外に集めたものは、ブラウザが要求することのなかった変種 ——
  // そしてそこを埋めるのがこのスクリプトの存在理由なので、数える価値がある。
  const chosen = new Set<string>();
  for (const el of Array.from(nodes)) {
    for (const attr of ["src", "data-src", "data-lazy-src", "poster"]) {
      push(el.getAttribute(attr));
    }
    for (const attr of ["srcset", "data-srcset"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      // "url 1x, url 2x, url 480w" → カンマ区切りの候補それぞれから URL を取る
      for (const candidate of v.split(",")) push(candidate.trim().split(/\s+/)[0]);
    }
    // `currentSrc` を持つのは img と video/audio だけ (型がそう言う。Element には無い)。
    // 他の要素では空で、JS だった頃も undefined を読んで飛ばしていた。
    const current =
      el instanceof HTMLImageElement || el instanceof HTMLMediaElement ? el.currentSrc : "";
    if (current) chosen.add(current);
  }
  const fromElements = urls.size;

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules; // cross-origin のシートは throw する → 飛ばす
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      for (const m of rule.cssText.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        const abs = m[2] && toAbsolute(m[2], sheet.href ?? undefined);
        if (abs && !abs.startsWith("data:")) urls.add(abs);
      }
    }
  }
  const fromStyleSheets = urls.size - fromElements;
  const neverRequested = [...urls].filter((u) => !chosen.has(u)).length;

  let n = 0;
  for (const url of urls) {
    if (n >= maxUrls || globalThis.__bh.remainingMs <= 0) break;
    n++;
    // no-cors にして、cross-origin の CDN にもリクエストが出るようにする。CDP の
    // NetworkRecorder は CORS に関係なく wire の応答を捕まえる。
    try {
      void fetch(url, { mode: "no-cors", credentials: "include" }).catch(() => undefined);
    } catch {
      /* 個々の取得の失敗は無視する */
    }
    if (n % 16 === 0) await sleep(0); // event loop に息継ぎをさせる
  }

  globalThis.__bh.report("autofetch", {
    candidates: urls.size,
    elements: nodes.length,
    neverRequestedByTheBrowser: neverRequested,
    fromStyleSheets,
    fetched: n,
  });
})();
