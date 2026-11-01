// BrowserHive が behavior のスクリプトに見せる受け皿 `__bh` の写し。正は browserhive の
// `src/behaviors/host.ts`（頁に注入される定数。値はコードに埋めず、注入の直後に引数で渡す）。
// ここに在るのはスクリプトが読むメンバだけで、BrowserHive だけが呼ぶ物は写さない。preload には受け皿が無い。
//
// **`declare var` にすること。** `declare const` だと `globalThis.__bh` の形で引けない
// (`typeof globalThis` に載るのは var だけ)。
//
// この 1 ファイルは ts-compile-service にも写され (`types/host.d.ts`・`capture-scripts.pin`)、
// あちらの CI が tag の raw と 1 バイトも違わないことを見る。直すならここが正。
declare var __bh: {
  /** 版の設定（台帳に入れるときの `--options`）を id で引く。中身は検査されていない。無ければ undefined */
  opts: Record<string, Record<string, unknown> | undefined>;
  /**
   * クロールごとの変数。`catalog.json` の `params`（kind: variable）で宣言した名前を引く。値は文字列だけで、
   * 渡されなければ undefined（required: false の宣言）。値は記録に残る（WACZ の `settings.variables`・台帳の行）
   */
  vars: Readonly<Record<string, string | undefined>>;
  /**
   * クロールごとのシークレット。`params`（kind: secret）で宣言した名前を引く。値は文字列だけで、
   * 渡されなければ undefined。記録（WACZ・台帳・ログ）に残るのは名前だけ —— ただし頁の中では隠せず、
   * 網に送れば WARC には残る
   */
  secrets: Readonly<Record<string, string | undefined>>;
  /** 残り時間 (ms)。**協調的** —— 見なければ止まらないし、止めてもくれない */
  remainingMs: number;
  /**
   * 1 スクリプト 1 行。id と経過 ms は受け皿が付ける。行は BrowserHive のログに出るだけで、
   * custom.jsonl には残らない (残るのは送った source)。reachedBottom と scrollSteps を
   * 述べた行は、datapackage.json の coverage になる
   */
  report(id: string, data: unknown): void;
};
