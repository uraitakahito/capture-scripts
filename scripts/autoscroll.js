/**
 * ページの全高までスクロールして、遅延読み込み (`loading="lazy"`、IntersectionObserver、
 * `data-src`) を発火させ、そのリソースを記録させてから、スクリーンショットのために
 * 先頭へ戻る。
 *
 * かつて BrowserHive に同梱されていた built-in の `autoscroll` を、**リクエストで送る形**
 * に書き直したもの。サーバは顔ぶれを持たないので、これを送らなければスクロールは起きない。
 *
 * 設定 (`options_json`) は `__bh.opts["autoscroll"]` から引く:
 *   maxSteps (既定 40) / stepDelayMs (既定 250) / idleTimeMs (既定 1000)
 *
 * 報告の 2 つの値は用途が違う。`stopped` はログの中で人が読む文で、いずれ言い回しが
 * 変わる。**`reachedBottom` と `scrollSteps` はサーバの `analyzeCoverage` が読む** ので、
 * 文を書き直しても archive の自己申告が黙って反転することはない。この 2 つの鍵を
 * 報告した行が coverage を述べる、という約束になっている。
 */
(async () => {
  const opts = globalThis.__bh.opts["autoscroll"] ?? {};
  const maxSteps = Number(opts.maxSteps ?? 40);
  const stepDelayMs = Number(opts.stepDelayMs ?? 250);
  const settleMs = Number(opts.idleTimeMs ?? 1000);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let last = -1;
  let steps = 0;
  // この 2 つを区別することこそが、判断を報せる理由そのもの:
  // 「step を使い切った」は、打ち切りより下のページが一度も視界に入らなかったという
  // ことで、そこの遅延リソースは archive に無い。
  let reachedBottom = false;
  while (steps++ < maxSteps) {
    // **受け皿の予算を見る。** 見ないスクリプトは止まらない (強制停止はサーバ側)。
    // 1 段ぶんの猶予が無ければ、そこで畳む。
    if (globalThis.__bh.remainingMs < stepDelayMs + settleMs) {
      steps--;
      break;
    }
    window.scrollBy(0, window.innerHeight);
    await sleep(stepDelayMs);
    if (window.scrollY === last) {
      reachedBottom = true;
      break;
    }
    last = window.scrollY;
  }
  window.scrollTo(0, 0); // スクリーンショットのために先頭へ
  await sleep(settleMs); // 走り出したばかりの読み込みを少しだけ待つ

  globalThis.__bh.report("autoscroll", {
    stopped: reachedBottom
      ? `bottom reached after ${String(steps)} steps`
      : `maxSteps ${String(maxSteps)} reached — bottom NOT reached`,
    reachedBottom,
    scrollSteps: reachedBottom ? steps : maxSteps,
  });
})();
