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
| `catalog.json` | ソースが自分では言えないこと —— `id` と `phase`、一言の `summary`、サイト用なら `sites` |
| `tsconfig.json` | strict と `erasableSyntaxOnly`。enum のような「剥がして消えない構文」を書かせない |
| `tools/check.mjs` | `pnpm run check` の後半。`catalog.json` と一致するか・札（`sites`）の形・sha256 はいくつか（前半は tsc） |

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

BrowserHive はスクリプトを走らせる前に、**938 バイトの受け皿**を 1 つだけ注入する。
ページに現れる同梱のコードはこれだけで、アーカイブの `behaviors/runtime.js` に
そのまま残る。

```js
globalThis.__bh = {
  // このスクリプトに渡された値を id で引く。中身は検査されていない
  opts: { autoscroll: { maxSteps: 80 } },

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
  const opts = globalThis.__bh.opts["あなたの id"] ?? {};   // ① 設定は opts から、既定はソースの中に
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
札を省いたスクリプトは、今までどおりどこでも走る。

```json
{
  "id": "example-results",
  "phase": "behavior",
  "file": "scripts/example-results.ts",
  "sites": ["www.example.com"],
  "summary": "www.example.com の検索結果の頁で、見出しを報告する"
}
```

札を書ける形は `profile` が `capture-scripts/2` の `catalog.json` で、capture-ledger は v0.61.0 から読む
（それより前の台帳は `/2` を断るので、札を黙って捨てることはない）。

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
(() => {
  if (location.hostname !== "www.example.com") return;
  globalThis.__bh.report("example-results", { title: document.title });
})();
```

**撮れないサイトのスクリプトは足さない。** 台帳のクロールは robots.txt を守るので、robots が断る頁
（たとえば Google の `/search`）では、スクリプトは 1 度も走らない。

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
2. `catalog.json` に `id` / `phase` / `file` / `summary` を足す（サイト用なら `sites` も）
3. `pnpm run check`（tsc → `catalog.json` との一致と札の形 → sha256 の印字）
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
