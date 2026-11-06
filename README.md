# capture-scripts

BrowserHive が取り込むページの中で走らせるスクリプト。TypeScript で書く。

**サーバは顔ぶれを持たない。** [BrowserHive](https://github.com/uraitakahito/browserhive) v11.0.0 から、
組み込みの behavior もサイト別の behavior も無くなった。送らなければページの中では何も走らず、
受け皿すら注入されない —— **それでも取り込みは成功し、アーカイブも出る**。

走らせるものを決めるのは頼む側で、その「走らせてよいものの一覧」がここに在る。
配るのは [capture-ledger](https://github.com/uraitakahito/capture-ledger)
（`scripts` 表）で、この repo はその**出どころ**。

```
capture-scripts  ──→  capture-ledger（台帳）  ──→  Windmill の flow  ──→  ts-compile-service  ──→  BrowserHive  ──→  ページ
 (TS と phase)          (TS の版を固定する)        (運ぶだけ)          (型検査して JS に)      (JS を評価する)
```

## 中身

| | |
|---|---|
| `scripts/*.ts` | ページの中で走らせるスクリプト。書いたままのバイト列が台帳に入る |
| `types/host.d.ts` | 受け皿 `__bh` の型。[ts-compile-service](https://github.com/uraitakahito/ts-compile-service) にも写される（下の「2 つの門番」） |
| `catalog.json` | ソースが自分では言えないこと —— `id` と `phase`、一言の `summary`、サイト用なら `sites`、既定に入れないなら `default`、シークレットを読むなら `params`（変数の `params` はソースの宣言の写し） |
| `tsconfig.json` | strict と `erasableSyntaxOnly`。enum のような「剥がして消えない構文」を書かせない |
| `tools/check.mjs` | `pnpm run check` の後半。`catalog.json` と一致するか・対象サイト（`sites`）と `default` の形・`params` の形と source との一致・`import` の形・sha256 はいくつか（前半は tsc） |
| `tools/read-params.ts` | `defineParams` の宣言を走らせずに読む係。[ts-compile-service](https://github.com/uraitakahito/ts-compile-service) にも 1 バイトも変えずに写される |
| `examples/*.ts` | 書き方の見本。配らないので `catalog.json` には載せず、tsc だけが読む |

runtime の依存は無い。台帳が読むのは書いたままの TS のバイト列そのもので、それに `sha256` を打つ。
JS への変換は Windmill の flow の中で ts-compile-service がクロールの段ごとに行い、BrowserHive は
その JS を `sha256` で照合する —— 2 つの hash が、変換した場所で継がれる。dev の依存は typescript と zod
（zod は型のため。ページの JS に入れるのは ts-compile-service。下の「Zod」）。

## 2 つの門番 —— 型が通らない TS は走らない

1. **この repo の CI** (`tsc --noEmit`)。型が通らなければ tag にならず、台帳にも入らない
2. **ts-compile-service**。クロールの段ごとに同じ tsconfig で型検査し、通らなければ 422 を返して段ごと落とす
   （台帳には CLI でも足せるので、tag を経ない道にも門番が要る）

受け皿の型 `types/host.d.ts` は 2 か所に在る（ここと ts-compile-service）。**直すならここが正**で、
あちらの CI が tag の raw と 1 バイトも違わないことを見る。

## 受け皿 —— ページの中で使えるもの

BrowserHive はスクリプトを走らせる前に、**受け皿 `__bh`** を 1 つだけ注入する。
ページに現れる同梱のコードはこれだけで、アーカイブの `behaviors/runtime.js` に
そのまま残る。受け皿のコードは値を含まない定数で（BrowserHive の版が同じなら同じバイト列）、
予算・版の設定・クロールごとの値は、注入の直後に引数で渡される。

```js
globalThis.__bh = {
  // 版の設定（台帳に入れるときの --options）を id で引く。中身は検査されていない
  opts: { autoscroll: { maxSteps: 80 } },

  // クロールごとの変数。スクリプトは直に読まず、defineParams で読む（下の「クロールごとの値」）
  vars: { query: "個人情報" },

  // クロールごとのシークレット。params（kind: secret）で宣言した名前。値は文字列で、記録には名前だけ残る
  secrets: { api_token: "…" },

  // 残り時間 (ms)。**協調的** —— 見なければ止まらないし、止めてもくれない
  get remainingMs() { /* … */ },

  // 1 行を書く。書いたその場で BrowserHive に届き、取り込みの記録に残る
  // （どこに残るかは BrowserHive の docs「ログを読む」）。誰の行か（id）と経過 ms は BrowserHive が付け、
  // シークレットの値は長さに依らず伏せる
  log: {
    debug(message, data) { /* … */ },
    info(message, data) { /* … */ },
    warn(message, data) { /* … */ },
    error(message, data) { /* … */ },
  },

  // スクリプトの結果を 1 回述べる。id は書かない（付けるのは log と同じく BrowserHive）。
  // 引数が 2 つ（古い report(id, data)）か、data が object でなければ投げる
  report(data) { /* … */ },
};
```

書くときの作法は 3 つだけ。`globalThis.__bh` は `types/host.d.ts` で型が付いていて、
綴りを間違えると tsc が止める（`remaining` → "Did you mean 'remainingMs'?"）。id を渡す古い
`report("あなたの id", { … })` も止める（引数が 1 つ多い。TS2554）。

```ts
import { z } from "zod";

(async () => {
  const { query } = defineParams(z.object({ query: z.string().min(1).describe("検索語") }));   // ① 必須の値は宣言する（下の節）
  const opts = globalThis.__bh.opts["あなたの id"] ?? {};   // 版の設定の既定はソースの中に
  const maxSteps = Number(opts.maxSteps ?? 40);

  while (/* … */) {
    if (globalThis.__bh.remainingMs < 500) break;            // ② 予算を見る。見ないと巻き込まれる
    // …
  }

  globalThis.__bh.log.warn("…が見つからない", { maxSteps });  // ③ 途中の様子は log に書き、
  globalThis.__bh.report({ /* 何を判断したか */ });           //    結果は report で 1 回述べる（id は書かない）
})();
```

誰の行かは、スクリプトの関数が積んだ stack から BrowserHive が決める。`setTimeout` の中のように
待たない続きで書いた行も、書いたスクリプトに付く。見本は `egov-law-search` の、検索窓が無いときの `log.warn`。

**既定値はソースの中にしか置かない。** `catalog.json` に写すと 2 か所になり、必ず片方が腐る。
配備ごとに変えたい値は、台帳に入れるときに渡すもの（`--options`）で、スクリプトの性質ではない。
クロールごとに変えたい値は、`defineParams` で宣言して頼みで渡すもの（下の「クロールごとの値」）。
任意の値の既定は `.optional()` と `??` で書く。`.default` は読めない（`pnpm run check` が止める）。

## 2 つの口 —— `phase`

`catalog.json` の `phase` が、BrowserHive のどちらの注入口を使うかを決める。
**約束が違うので、混ぜられない。**

| | `behavior` | `preload` |
|---|---|---|
| いつ | 読み込みの**後** | 遷移の**前** |
| どこで | 主フレームだけ | **iframe を含む全フレーム** |
| 何回 | 1 回 | **遷移のたび** |
| 受け皿 | 在る（log と report が使える） | **無い（log も report も使えない）** |

`phase` がここに在ることが、`catalog.json` の存在理由。ソースからは読めないので、
無ければ運用する人が `--phase` で手打ちすることになり、打ち間違えると
「遷移の前に入れるはずのコードが、読み込みの後に 1 回だけ走って、しかも成功する」。

## サイト用のスクリプト —— `sites`

決まったサイトの頁でだけ意味のあるスクリプトには、`catalog.json` に対象サイト `sites`（ホスト名の列）を書く。
対象サイトを省いたスクリプトは、今までどおりどこでも走る。この repo の見本は `egov-law-search` で、
[e-Gov 法令検索](https://laws.e-gov.go.jp/)の頁の中で法令名を引き（語は必須の変数 `query`）、件数と法令名を報告する。

```json
{
  "id": "egov-law-search",
  "phase": "behavior",
  "file": "scripts/egov-law-search.ts",
  "sites": ["laws.e-gov.go.jp"],
  "params": [
    {
      "name": "query",
      "kind": "variable",
      "required": true,
      "summary": "法令名の検索語",
      "schema": { "type": "string", "minLength": 1 }
    }
  ],
  "summary": "e-Gov 法令検索で法令名を引き（語は変数 query）、件数と法令名を報告する"
}
```

（`params` は後の「クロールごとの値」の節。）

いまの `catalog.json` の形は `profile` が `capture-scripts/5` で、`/4` までの台帳は断る
（対象サイトや `default` や `params` を黙って捨てることはない）。

**対象サイトを使うのは台帳。** capture-ledger は対象サイトのあるスクリプトを、クロールの起点のどれかがそのサイトに
あるときだけ入れる —— `scripts` を省いたクロールでは起点に合う物を自分で選び、起点に合わない
物を名指せば 400 で断る。dashboard は対象サイトを見せ、新しいクロールの画面で同じ決まりのとおりに選ぶ。

- **書けるのは小文字のホスト名だけ。** IDN は punycode で書く。ポート・scheme・`*` は書けない。
  照らすのは起点の `new URL(…).hostname` との完全一致で、`example.com` と `www.example.com` は別
  （両方要るなら両方書く）
- **見分けの行も書く。** 決まりはクロールの単位で、リンクを辿って別のホストへ出た頁でも、スクリプトは走る。
  冒頭で `location.hostname` と比べ、違えば何もしないで終わる。`pnpm run check` は、対象サイトのホスト名が
  source に `"…"` で出てこなければ止める（見分けの行の書き忘れ）

```ts
(async () => {
  if (location.hostname !== "laws.e-gov.go.jp") return;
  // …
})();
```

**撮れないサイトのスクリプトは足さない。** 台帳のクロールは robots.txt を守るので、robots が断る頁
（たとえば Google の `/search`）では、スクリプトは 1 度も走らない。

首相官邸（`www.kantei.go.jp`）も入れていない（2026-10-29 に確かめた）。`HeadlessChrome` と名乗る取得には、
トップも検索の頁も CSS も 404 を返す（BrowserHive は headless の Chrome で、名乗りを替えない）。
サイト内検索の答えは Google のプログラム可能検索エンジン（`cse.google.com`）が返し、その robots.txt は
全部を断り、利用規約の 1.4 は自動の手段で検索を作ることと、答えを残すことを禁じている。

## 実行の順 —— `catalog.json` の並び

`catalog.json` の `scripts` の並びが、既定の実行順になる。台帳は取り込みのときにこの並びを写し、`scripts` を
省いたクロールと、新しいクロールの画面の初めの順に使う。人はその画面の ↑↓ で、そのクロールの順を変えられる。

`autofetch` を最後に置くのは、読んだ時点でページに書かれている候補しか取りに行かないから。`autoscroll` の
遅延読み込みとサイト用のスクリプトの操作で候補が増えた後に走らせる。

## 既定に入らないスクリプト —— `default`

`catalog.json` の項目に `"default": false` を書くと、そのスクリプトは台帳の既定に入らない。
台帳は取り込みのときにこれを `enabled` に写し、`scripts` を省いたクロール（新しいクロールの画面の
初めのチェックと、毎朝の定期のクロール）では走らせない。名指しすれば走る。省けば既定に入る。

```json
{
  "id": "autofetch",
  "phase": "behavior",
  "file": "scripts/autofetch.ts",
  "default": false,
  "summary": "走る時点の srcset の候補・data-* を fetch() で取りに行く（CSP が拒む URL は取れない。既定では走らない）"
}
```

いま既定に入らないのは `autofetch` だけ。2026-10-29 の e-Gov 法令検索の取り込みで、`autofetch` が取りに行った
6 本はどれもブラウザが読み済みで、新しく取れた物は 0 本だった。そのうち `@import` で読まれていた CSS 2 本は、
`fetch()` で取り直した本文が化けて記録された（BrowserHive の本文の取り方の不具合）。`autofetch` を直すかは、
BrowserHive の本文の取り方を直した後で考え直す。

`fetch()` はページの CSP（Content Security Policy の connect-src、無ければ default-src）に従うので、拒まれる URL は
取れない。apple.com/jp の mzstatic の絵がそれで、Retina の replay で欠ける（CAPTURE-52）。

## クロールごとの値 —— 変数とシークレット

版の設定（`--options`）は台帳に入れるときに決まり、同じ版のクロールは全部同じ値を読む。
**クロールごとに変えたい値**（検索語、サイトの鍵）は、変数かシークレットで読む。名前は英小文字で始め、
英小文字・数字・`_` で 64 字まで（`^[a-z][a-z0-9_]*$`）。名前の空間は台帳の中で 1 つ —— 2 本のスクリプトが同じ名前を
宣言すれば、同じ値を読む（形が違う宣言を並べれば台帳が 400 で断る）。

### 変数 —— `defineParams`

変数は値が記録に残る（WACZ の `settings.variables`・台帳の行・dashboard）。スクリプトの中で宣言して読む。

```ts
import { z } from "zod";

(async () => {
  const { query, limit } = defineParams(
    z.object({
      query: z.string().min(1).describe("検索語"),                  // 必須
      limit: z.string().optional().describe("件数の上限。省けば 10"), // 任意
    }),
  );
  const max = Number(limit ?? "10");   // 任意の値の既定は ?? で
})();
```

- **`.optional()` を付けなければ必須。** 渡さないクロールは ts-compile-service が `BH0001` で止める
  （`egov-law-search.ts:20:7 BH0001 必須の変数 query が渡されていない`）。台帳は始める前に訊くので、クロールの行は立たない
- **宣言は走らせずに読む**（`tools/read-params.ts`）。書けるのは `z.object({ 名前: 値 })` で、値は `z.string()` か `z.enum([…])`、
  続けられるのは `.min`・`.max`・`.length`・`.optional`・`.describe` だけ。引数はリテラルだけ。ほかは `BH0002`。
  `.default` は既定をソースの外から読めなくし、`.regex` は利用者の正規表現を台帳で走らせることになるので読まない
- **値は文字列だけ。** 数や JSON はスクリプトが読み替える
- **1 本に 1 回。** `__bh.vars` は直に読めない（型に無く、`@ts-nocheck` でも `BH0005` で止まる）。`preload` では使えない（`BH0004`）
- **`zod/mini` では宣言できない。** `defineParams` は `zod` の型を受ける
- **`z` を宣言の中でしか読まなければ、Zod は JS に入らない。** `defineParams(…)` は JS で `globalThis.__bh.vars` に置き換わる

**頼みで渡す**（台帳の `POST /api/crawls` の `variables`。dashboard の新しいクロールの画面は、選んだスクリプトの宣言から
欄を作る）。宣言に無い名前を渡せば、`.min` などに合わない値を渡せば、台帳が 400 で断る。

台帳は `catalog.json` しか読まないので、**スクリプト集の変数は `catalog.json` の `params` に写す**
（`summary` は `.describe` の字で、スクリプト集では必須）。`pnpm run check` が 1 つでも違えば止め、正しい形を出す。

```json
{ "name": "query", "kind": "variable", "required": true, "summary": "検索語", "schema": { "type": "string", "minLength": 1 } }
```

### シークレット —— `params`

シークレットは記録に名前だけが残る。`catalog.json` の `params`（kind が `secret`）で宣言し、受け皿の `__bh.secrets.<名前>` で読む。

- `required` は省けば false。渡されなければスクリプトは undefined を読む。true の物が無いクロールは台帳が 400 で断る
- `summary` は説明。空は書けない。**既定値は書けない**（既定はソースの中に。知らない鍵は `check` が止める）

**人が前もって Windmill の secret 変数 `f/waggle_secrets/<名前>` に置く**
（置き方は [capture-scheduler](https://github.com/uraitakahito/capture-scheduler) の docs「クロール」）。頼みには書かない。
台帳は在るかだけを確かめ（無ければ 400 で名前と path を言う）、Windmill の flow が走らせる直前に解いて BrowserHive に渡す。
値を持つのは Windmill と、走っている頁だけ。

頁の中では隠せない —— 受け皿は頁の JS から読める主ワールドに在る。スクリプトが値を通信に載せれば（URL や本文に書けば）、その要求は WARC に残る。
隠すのは記録（WACZ・台帳・ログ）からだけ。

`pnpm run check` は、宣言した名前がソースに `__bh.secrets.<名前>` の形で出ること、逆にソースが
読む名前が宣言に在ることを見る（コメントは除く。`["名前"]` の形は見ない）。書き忘れと綴り違いを、台帳に入れる前に止める。

この repo にシークレットを読む見本は無い（秘密を要するサイトのスクリプトが無い）。

## Zod —— 読んだ値の形を確かめる

`behavior` のスクリプトは [Zod](https://zod.dev/) を読める。先頭の文に、次のどちらかを書く。

```ts
import { z } from "zod";        // 使う名前（z.object など）だけが JS に入る。目安 85 KB
import * as z from "zod/mini";  // 関数で組む小さい版。目安 15 KB
```

JS に束ねるのは ts-compile-service で、型は dev の依存の `zod` から付く。`import` の無いスクリプトの JS は変わらない。
見本は `examples/zod-in-page.ts`。

- **受けるのはこの 2 形だけ。** 別名（`import { z as zod }`）・既定の import・`import type` は ts-compile-service が
  `BH0003` で断り、ほかの package は `TS2307` になる。`pnpm run check` も同じ形を見る
- **説明のコメントは `import` の後に書く。** `import` の前のコメントは JS に残らない（`// @ts-nocheck` は前に在ってよい）
- **`parse` より `safeParse`。** `parse` の例外は「1 本の書き損じで他を落とさない」決まりで行 1 つになり、minify された束では
  `l: ZodError` としか残らない。`safeParse` と `__bh.log.error` なら、どの項目が違ったかが残る。形が合わなくてもクロールは成功のまま
- **`preload` では使えない。** 全部のフレームで遷移のたびに走り、受け皿が無いので失敗を書く先が無い。`pnpm run check` と
  ts-compile-service（`BH0004`）が断る
- **クロールごとの値を読むのも同じ `z`。** 宣言の中でしか `z` を読まなければ、Zod は JS に入らない（「クロールごとの値」）
- **厳しい CSP のページでも動く。** Zod は速い検査を `new Function` で作ろうとし、`script-src` が eval を禁じるページでは
  投げるうえ、相手のサイトへ違反の報告が飛ぶ。ts-compile-service は `jitless` で束ねるので、どちらも起きない

## 使う

台帳へまとめて入れる（capture-ledger 側）:

```sh
pnpm run scripts import .upstream/capture-scripts
pnpm run scripts list
```

同じバイト列を入れ直しても**版は増えない**。台帳が持つのはソースのバイト列で、
どのファイルから読んだかではないため。

## 足す

1. `scripts/<id>.ts` を書く（上の作法 3 つ）
2. `catalog.json` に `id` / `phase` / `file` / `summary` を足す（サイト用なら `sites`、既定に入れないなら `"default": false`、クロールごとの値を読むなら `params` も。変数はソースの宣言の写し）
3. `pnpm run check`（tsc → `catalog.json` との一致と対象サイト・`params` の形 → sha256 の印字）
4. 台帳へ入れ直す

## この検査が言えないこと

**「本当にスクロールするか」はここでは言えない。** jsdom はレイアウトを持たないので
`scrollHeight` が常に 0 —— `autoscroll` は 1 段も進まない。振る舞いの証拠には本物の
ブラウザが要るので、capture-scheduler の e2e に置いてある
（capture-fixtures の `/responsive-images` に対して、ブラウザが自分では要求しない
画像の変種が届いたかを数える）。

ここの検査は「型が通らない TS」と「`catalog.json` との食い違い」を止めるためのもの。

## リリース

`main` に PR を squash でマージし、
出す commit に注釈タグを打つ。消費者は**タグの付いたコミットしか指せない**（submodule の規約）。
