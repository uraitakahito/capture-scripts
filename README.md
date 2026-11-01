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
| `catalog.json` | ソースが自分では言えないこと —— `id` と `phase`、一言の `summary`、サイト用なら `sites`、既定に入れないなら `default`、クロールごとの値を読むなら `params` |
| `tsconfig.json` | strict と `erasableSyntaxOnly`。enum のような「剥がして消えない構文」を書かせない |
| `tools/check.mjs` | `pnpm run check` の後半。`catalog.json` と一致するか・札（`sites`）と `default` の形・`params` の形と source との一致・sha256 はいくつか（前半は tsc） |

runtime の依存は無い。台帳が読むのは書いたままの TS のバイト列そのもので、それに `sha256` を打つ。
JS への変換は Windmill の flow の中で ts-compile-service がクロールの段ごとに行い、BrowserHive は
その JS を `sha256` で照合する —— 2 つの hash が、変換した場所で継がれる。dev の依存は typescript だけ。

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

  // クロールごとの変数。catalog.json の params（kind: variable）で宣言した名前。値は文字列で、記録に残る
  vars: { query: "個人情報" },

  // クロールごとのシークレット。params（kind: secret）で宣言した名前。値は文字列で、記録には名前だけ残る
  secrets: { api_token: "…" },

  // 残り時間 (ms)。**協調的** —— 見なければ止まらないし、止めてもくれない
  get remainingMs() { /* … */ },

  // 1 スクリプト 1 行。id と経過 ms は受け皿が付ける
  report(id, data) { /* … */ },
};
```

書くときの作法は 3 つだけ。`globalThis.__bh` は `types/host.d.ts` で型が付いていて、
綴りを間違えると tsc が止める（`remaining` → "Did you mean 'remainingMs'?"）。

```ts
(async () => {
  const opts = globalThis.__bh.opts["あなたの id"] ?? {};   // ① 値は 変数 → 版の設定 → ソースの既定 の順。既定はソースの中に
  const query = String(globalThis.__bh.vars.query ?? opts.query ?? "既定の語");   // 変数は params で宣言する（下の節）
  const maxSteps = Number(opts.maxSteps ?? 40);

  while (/* … */) {
    if (globalThis.__bh.remainingMs < 500) break;            // ② 予算を見る。見ないと巻き込まれる
    // …
  }

  globalThis.__bh.report("あなたの id", { /* 何を判断したか */ });  // ③ 報告する
})();
```

**既定値はソースの中にしか置かない。** `catalog.json` に写すと 2 か所になり、必ず片方が腐る。
配備ごとに変えたい値は、台帳に入れるときに渡すもの（`--options`）で、スクリプトの性質ではない。
クロールごとに変えたい値は、`params` で宣言して頼みで渡すもの（下の「クロールごとの値」）。
`params` にも既定値は書けない（`pnpm run check` が止める）。

## 2 つの口 —— `phase`

`catalog.json` の `phase` が、BrowserHive のどちらの注入口を使うかを決める。
**約束が違うので、混ぜられない。**

| | `behavior` | `preload` |
|---|---|---|
| いつ | 読み込みの**後** | 遷移の**前** |
| どこで | 主フレームだけ | **iframe を含む全フレーム** |
| 何回 | 1 回 | **遷移のたび** |
| 受け皿 | 在る（報告できる） | **無い（報告できない）** |

`phase` がここに在ることが、`catalog.json` の存在理由。ソースからは読めないので、
無ければ運用する人が `--phase` で手打ちすることになり、打ち間違えると
「遷移の前に入れるはずのコードが、読み込みの後に 1 回だけ走って、しかも成功する」。

## サイト用のスクリプト —— `sites`

決まったサイトの頁でだけ意味のあるスクリプトには、`catalog.json` に札 `sites`（ホスト名の列）を書く。
札を省いたスクリプトは、今までどおりどこでも走る。この repo の見本は `egov-law-search` で、
[e-Gov 法令検索](https://laws.e-gov.go.jp/)の頁の中で法令名を引き（語は変数 `query`。既定は「セキュリティ」）、件数と法令名を報告する。

```json
{
  "id": "egov-law-search",
  "phase": "behavior",
  "file": "scripts/egov-law-search.ts",
  "sites": ["laws.e-gov.go.jp"],
  "params": [
    { "name": "query", "kind": "variable", "required": false, "summary": "法令名の検索語。省けばソースの既定" }
  ],
  "summary": "e-Gov 法令検索で法令名を引き（語は変数 query。既定はセキュリティ）、件数と法令名を報告する"
}
```

（`params` は後の「クロールごとの値」の節。）

いまの `catalog.json` の形は `profile` が `capture-scripts/4` で、capture-ledger は v0.67.0 から読む
（それより前の台帳は `/4` を断るので、札や `default` や `params` を黙って捨てることはない）。

**札を使うのは台帳。** capture-ledger は札のあるスクリプトを、クロールの起点のどれかがそのサイトに
あるときだけ入れる —— `scripts` を省いたクロールでは起点に合う物を自分で選び、起点に合わない
物を名指せば 400 で断る。dashboard は札を見せ、新しいクロールの画面で同じ決まりのとおりに選ぶ。

- **書けるのは小文字のホスト名だけ。** IDN は punycode で書く。ポート・scheme・`*` は書けない。
  照らすのは起点の `new URL(…).hostname` との完全一致で、`example.com` と `www.example.com` は別
  （両方要るなら両方書く）
- **見分けの行も書く。** 決まりはクロールの単位で、リンクを辿って別のホストへ出た頁でも、スクリプトは走る。
  冒頭で `location.hostname` と比べ、違えば何もしないで終わる。`pnpm run check` は、札のホスト名が
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
  "summary": "srcset の全候補・data-* を能動的に取りに行く（既定では走らない）"
}
```

いま既定に入らないのは `autofetch` だけ。2026-10-29 の e-Gov 法令検索の取り込みで、`autofetch` が取りに行った
6 本はどれもブラウザが読み済みで、新しく取れた物は 0 本だった。そのうち `@import` で読まれていた CSS 2 本は、
`fetch()` で取り直した本文が化けて記録された（BrowserHive の本文の取り方の不具合）。`autofetch` を直すかは、
BrowserHive の本文の取り方を直した後で考え直す。

## クロールごとの値 —— `params`（変数とシークレット）

版の設定（`--options`）は台帳に入れるときに決まり、同じ版のクロールは全部同じ値を読む。
**クロールごとに変えたい値**（検索語、サイトの鍵）は、`catalog.json` の `params` で読む名前を宣言し、
スクリプトは受け皿の `__bh.vars.<名前>`（kind が `variable`）か `__bh.secrets.<名前>`（kind が `secret`）で読む。
この repo の見本は `egov-law-search` の `query`（上の `sites` の節の JSON）。

- `name` は英小文字で始め、英小文字・数字・`_` で 64 字まで（`^[a-z][a-z0-9_]*$`）。名前の空間は台帳の中で 1 つ ——
  2 本のスクリプトが同じ名前を宣言すれば、同じ値を読む
- `kind` は `variable`（値は記録に残る。WACZ の `settings.variables`・台帳の行・dashboard）か
  `secret`（記録に残るのは名前だけ）
- `required` は省けば false。渡されなければスクリプトは undefined を読む。true の物が無いクロールは台帳が 400 で断る
- `summary` は値を入れる欄の説明。空は書けない。**既定値は書けない**（既定はソースの中に。知らない鍵は `check` が止める）

**変数は、クロールを始める頼みで渡す**（台帳の `POST /api/crawls` の `variables`。dashboard の新しいクロールの画面は、
選んだスクリプトの宣言から欄を作る）。宣言に無い名前を渡せば台帳が 400 で断る。値は文字列だけで、数や JSON は
スクリプトが読み替える。

**シークレットは、人が前もって Windmill の secret 変数 `f/waggle_secrets/<名前>` に置く**
（置き方は [capture-scheduler](https://github.com/uraitakahito/capture-scheduler) の docs「クロール」）。頼みには書かない。
台帳は在るかだけを確かめ（無ければ 400 で名前と path を言う）、Windmill の flow が走らせる直前に解いて BrowserHive に渡す。
値を持つのは Windmill と、走っている頁だけ。

頁の中では隠せない —— 受け皿は頁の JS から読める主ワールドに在る。スクリプトが値を網に送れば、その要求は WARC に残る。
隠すのは記録（WACZ・台帳・ログ）からだけ。

`pnpm run check` は、宣言した名前がソースに `__bh.vars.<名前>`／`__bh.secrets.<名前>` の形で出ること、逆にソースが
読む名前が宣言に在ることを見る（コメントは除く。`["名前"]` の形は見ない）。書き忘れと綴り違いを、台帳に入れる前に止める。

この repo にシークレットを読む見本は無い（秘密を要するサイトのスクリプトが無い）。

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
2. `catalog.json` に `id` / `phase` / `file` / `summary` を足す（サイト用なら `sites`、既定に入れないなら `"default": false`、クロールごとの値を読むなら `params` も）
3. `pnpm run check`（tsc → `catalog.json` との一致と札・`params` の形 → sha256 の印字）
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
