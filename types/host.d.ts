// BrowserHive が behavior のスクリプトに見せる受け皿。browserhive の `src/behaviors/host.ts`
// (文字列で注入される 938 バイト) の 3 メンバの写し。preload には受け皿が無い。
//
// **`declare var` にすること。** `declare const` だと `globalThis.__bh` の形で引けない
// (`typeof globalThis` に載るのは var だけ)。
//
// この 1 ファイルは ts-compile-service にも写され (`types/host.d.ts`・`capture-scripts.pin`)、
// あちらの CI が tag の raw と 1 バイトも違わないことを見る。直すならここが正。
declare var __bh: {
  /** `options_json` を id で引く。中身は検査されていない。無ければ undefined */
  opts: Record<string, Record<string, unknown> | undefined>;
  /** 残り時間 (ms)。**協調的** —— 見なければ止まらないし、止めてもくれない */
  remainingMs: number;
  /** 1 スクリプト 1 行。id と経過 ms は受け皿が付ける。WACZ の behaviors/custom.jsonl に残る */
  report(id: string, data: unknown): void;
};
