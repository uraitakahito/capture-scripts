# capture-scripts

BrowserHive が取り込むページの中で走らせるスクリプト。TypeScript で書く。

**サーバは顔ぶれを持たない。** [BrowserHive](https://github.com/uraitakahito/browserhive) v11.0.0 から、
組み込みの behavior もサイト別の behavior も無くなった。送らなければページの中では何も走らず、
受け皿すら注入されない —— **それでも取り込みは成功し、アーカイブも出る**。

走らせるものを決めるのは頼む側で、その「走らせてよいものの一覧」がここに在る。
配るのは [capture-ledger](https://github.com/uraitakahito/capture-ledger) の目録
（`scripts` 表）で、この repo はその**出どころ**。

```
capture-scripts  ──→  capture-ledger の目録  ──→  Windmill の flow  ──→  ts-compile-service  ──→  BrowserHive  ──→  ページ
 (TS と phase)          (TS の版を固定する)       (運ぶだけ)          (型検査して JS に)      (JS を評価する)
```

## 中身

| | |
|---|---|
| `scripts/*.ts` | ページの中で走らせるスクリプト。書いたままのバイト列が目録に入る |
| `types/host.d.ts` | 受け皿 `__bh` の型。[ts-compile-service](https://github.com/uraitakahito/ts-compile-service) にも写される（下の「2 つの門番」） |
| `catalog.json` | ソースが自分では言えないこと —— `id` と `phase`、一言の `summary` |
| `tsconfig.json` | strict と `erasableSyntaxOnly`。enum のような「剥がして消えない構文」を書かせない |
| `tools/check.mjs` | `pnpm run check` の後半。catalog と一致するか・sha256 はいくつか（前半は tsc） |

runtime の依存は無い。台帳が読むのは書いたままの TS のバイト列そのもので、それに `sha256` を打つ。
JS への変換は Windmill の flow の中で ts-compile-service がクロールの段ごとに行い、BrowserHive は
その JS を `sha256` で照合する —— 2 つの hash が、変換した場所で継がれる。dev の依存は typescript だけ。

## 2 つの門番 —— 型が通らない TS は走らない

1. **この repo の CI** (`tsc --noEmit`)。型が通らなければ tag にならず、目録にも入らない
2. **ts-compile-service**。クロールの段ごとに同じ tsconfig で型検査し、通らなければ 422 を返して段ごと落とす
   （目録は CLI でも足せるので、tag を経ない道にも門番が要る）

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
配備ごとに変えたい値は、目録に入れるときに渡すもの（`--options`）で、スクリプトの性質ではない。

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

## 使う

台帳の目録へまとめて入れる（capture-ledger 側）:

```sh
pnpm run scripts import .upstream/capture-scripts
pnpm run scripts list
```

同じバイト列を入れ直しても**版は増えない**。目録が持つのはソースのバイト列で、
どのファイルから読んだかではないため。

## 足す

1. `scripts/<id>.ts` を書く（上の作法 3 つ）
2. `catalog.json` に `id` / `phase` / `file` / `summary` を足す
3. `pnpm run check`（tsc → catalog の一致 → sha256 の印字）
4. 目録へ入れ直す

## この検査が言えないこと

**「本当にスクロールするか」はここでは言えない。** jsdom はレイアウトを持たないので
`scrollHeight` が常に 0 —— `autoscroll` は 1 段も進まない。振る舞いの証拠には本物の
ブラウザが要るので、capture-scheduler の e2e に置いてある
（capture-fixtures の `/responsive-images` に対して、ブラウザが自分では要求しない
画像の変種が届いたかを数える）。

ここの検査は「型が通らない TS」と「catalog の食い違い」を止めるためのもの。

## リリース

`main` に PR を squash でマージし、
出す commit に注釈タグを打つ。消費者は**タグの付いたコミットしか指せない**（submodule の規約）。
