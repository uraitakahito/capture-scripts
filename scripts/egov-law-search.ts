/**
 * e-Gov 法令検索 (`laws.e-gov.go.jp`) で法令名を検索し、答えの件数と法令名を報告する。
 * サイト用のスクリプトの見本で、札は `laws.e-gov.go.jp` (`catalog.json`)。
 *
 * 頁は Vue の SPA で、読み込みの直後には検索窓がまだ無い —— 描かれるまで待つ。「検索」のボタンは
 * `type="button"` で、押しても文書は替わらない (答えは `/internal-api/SelectLaw.json` から引き、
 * 頁の中で `/result` に切り替わる)。取り込む文書は起点の頁のまま —— JS で頁を移ると、去った
 * 文書は本文の無い応答として archive に残る。
 *
 * 設定は `__bh.opts["egov-law-search"]` から: query (既定 "セキュリティ") / waitMs (待つ上限。既定 10000)
 */
(async () => {
  // 決まりはクロールの単位なので、リンクを辿って別のホストへ出た頁でも走る
  if (location.hostname !== "laws.e-gov.go.jp") return;
  const id = "egov-law-search";
  const opts = globalThis.__bh.opts[id] ?? {};
  const query = String(opts.query ?? "セキュリティ");
  const waitMs = Number(opts.waitMs ?? 10000);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** find が null 以外を返すまで 100 ms ごとに見る。待つ上限か予算が尽きたら null */
  const waitFor = async <T>(find: () => T | null): Promise<T | null> => {
    const until = Date.now() + waitMs;
    for (;;) {
      const found = find();
      if (found !== null) return found;
      if (Date.now() > until || globalThis.__bh.remainingMs < 500) return null;
      await sleep(100);
    }
  };

  // 検索窓 (法令名) とボタン。Vue が描くまで待つ
  const box = await waitFor(() =>
    document.querySelector<HTMLInputElement>('form[role="search"] input.searchfield'),
  );
  const button = document.querySelector<HTMLButtonElement>('form[role="search"] button.searchbutton');
  if (box === null || button === null) {
    globalThis.__bh.report(id, { query, searched: false, why: "検索窓が無い" });
    return;
  }
  // Vue の v-model は input の出来事で値を読む。value を替えるだけでは届かない
  box.value = query;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  button.click();

  // 答え: <h1 class="numberofresults"> 検索結果: <strong>4</strong> 件 </h1> と a.lawtitle。/result に
  // 切り替わった時点では <strong> が空で描かれ、答えが届くと数が入る (2026-10-29 に測って約 2 秒後)
  const count = await waitFor(() => {
    const strong = document.querySelector("h1.numberofresults strong");
    return strong !== null && /\d/.test(strong.textContent ?? "") ? strong : null;
  });
  const laws = Array.from(
    document.querySelectorAll("a.lawtitle"),
    (a) => a.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
  globalThis.__bh.report(id, {
    query,
    searched: count !== null,
    hits: count === null ? 0 : Number(count.textContent?.replace(/,/g, "") ?? 0),
    laws: laws.slice(0, 5),
  });
})();
