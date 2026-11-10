// BrowserHive が behavior のスクリプトに見せる受け皿 `__bh` の写し。正は browserhive の
// `src/behaviors/host.ts`（頁に注入される定数。値はコードに埋めず、注入の直後に引数で渡す）。
// ここに在るのはスクリプトが読むメンバだけで、BrowserHive だけが呼ぶ物は写さない。preload には受け皿が無い。
// `__bh.vars` は BrowserHive に在るが、ここには無い。クロールごとの変数は `defineParams` で読む。
//
// **`declare var` にすること。** `declare const` だと `globalThis.__bh` の形で引けない
// (`typeof globalThis` に載るのは var だけ)。
//
// この 1 ファイルは ts-compile-service にも写され (`types/host.d.ts`・`capture-scripts.pin`)、
// あちらの CI が tag の raw と 1 バイトも違わないことを見る。直すならここが正。
/**
 * クロールごとの変数を宣言して読む。`.optional()` を付けない名前は必須で、渡さないクロールは ts-compile-service が
 * `BH0001` で止める。宣言は走らせずに読むので、書けるのは `z.object({ 名前: z.string() や z.enum([…]) })` と
 * `.min`・`.max`・`.length`・`.optional`・`.describe` だけ（`README.md`「クロールごとの値」）。値は文字列で、記録に残る
 * （WACZ の `settings.variables`・台帳の行）。JS では `globalThis.__bh.vars` に置き換わる。
 */
declare function defineParams<T extends import("zod").ZodType>(schema: T): Readonly<import("zod").infer<T>>;

declare var __bh: {
  /** 版の設定（台帳に入れるときの `--options`）を id で引く。中身は検査されていない。無ければ undefined */
  opts: Record<string, Record<string, unknown> | undefined>;
  /**
   * クロールごとのシークレット。`params`（kind: secret）で宣言した名前を引く。値は文字列だけで、
   * 渡されなければ undefined。頁の中では隠せない（頁の JS も読める）。値は台帳にも取り込みのログにも残らない。
   * **WARC からは既定で隠す** —— スクリプトが通信に載せても（URL・見出し・本文）、サイトが返しても `***` に
   * 置き換わる（WARC の外の記録でも）。置き換えるのは値と、その符号化した形（% の符号化・form・JSON・HTML・
   * base64）だけで、値から作った物（ハッシュや暗号文）は追わない。隠す値は 8 字以上（UTF-16 の code unit）が要り、
   * 短い値を渡した取り込みと、取り込む URL に隠す値を書いた取り込みは、BrowserHive が断る。宣言に
   * `archive: "keep"` と書いたシークレットだけは、通信の記録に値のまま残る（短くてよい）
   */
  secrets: Readonly<Record<string, string | undefined>>;
  /** 残り時間 (ms)。**協調的** —— 見なければ止まらないし、止めてもくれない */
  remainingMs: number;
  /**
   * 1 行を書く。行は書いたその場で BrowserHive に届き、取り込みの記録に残る (どこに残るかは BrowserHive の
   * docs「ログを読む」)。誰の行か (スクリプトの id) と、取り込みの始まりからの経過 ms は BrowserHive が付ける ——
   * スクリプトの関数が積んだ stack から決めるので、待たない続き (`setTimeout` の中など) の行も、書いた
   * スクリプトに付く。message と data のどこに書いたシークレットの値も、長さに依らず伏せられる
   */
  log: {
    debug(message: string, data?: object): void;
    info(message: string, data?: object): void;
    warn(message: string, data?: object): void;
    error(message: string, data?: object): void;
  };
  /**
   * スクリプトの結果を 1 回述べる。誰の行かと経過 ms を付けるのも、記録に残るのも、シークレットの値を
   * 伏せるのも log と同じ。引数が 2 つ (古い `report(id, data)`) か、data が object でなければ投げる。
   * reachedBottom と scrollSteps を述べた行は、datapackage.json の coverage になる
   */
  report(data: object): void;
};
