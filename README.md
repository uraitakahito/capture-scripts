# capture-scripts

BrowserHive が取り込むページの中で走らせる JavaScript。

**サーバは顔ぶれを持たない。** [BrowserHive](https://github.com/uraitakahito/browserhive) v11.0.0 から、
組み込みの behavior もサイト別の behavior も無くなった。送らなければページの中では何も走らず、
受け皿すら注入されない —— **それでも取り込みは成功し、アーカイブも出る**。

走らせるものを決めるのは頼む側で、その「走らせてよいものの一覧」がここに在る。
配るのは [capture-ledger](https://github.com/uraitakahito/capture-ledger) の目録
（`scripts` 表）で、この repo はその**出どころ**。

```
capture-scripts  ──→  capture-ledger の目録  ──→  Windmill の flow  ──→  BrowserHive  ──→  ページ
 (source と phase)      (版を固定する)          (運ぶだけ)         (評価する)
```

## 中身

| | |
|---|---|
| `scripts/*.js` | ページの中で評価される**素の JavaScript**。bundler も transpiler も通さない |
| `catalog.json` | ソースが自分では言えないこと —— `id` と `phase`、一言の `summary` |
| `tools/check.mjs` | `npm run check`。読めるか・catalog と一致するか・sha256 はいくつか |

依存は無い。**それがこの repo の性質の一部**で、台帳が読むのはファイルのバイト列そのもの、
BrowserHive はそれを `sha256` で照合する —— 間に何かを挟むと、その照合が
「何を照合したのか」を言えなくなる。

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

書くときの作法は 3 つだけ。

```js
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

1. `scripts/<id>.js` を書く（上の作法 3 つ）
2. `catalog.json` に `id` / `phase` / `file` / `summary` を足す
3. `npm run check`
4. 目録へ入れ直す

## この検査が言えないこと

**「本当にスクロールするか」はここでは言えない。** jsdom はレイアウトを持たないので
`scrollHeight` が常に 0 —— `autoscroll` は 1 段も進まない。振る舞いの証拠には本物の
ブラウザが要るので、capture-scheduler の e2e に置いてある
（capture-fixtures の `/responsive-images` に対して、ブラウザが自分では要求しない
画像の変種が届いたかを数える）。

ここの検査は「壊れた JS」と「catalog の食い違い」を止めるためのもの。

## リリース

`develop` に入れ、`develop → main` の PR（merge commit）で出し、その merge commit に
注釈タグを打つ。消費者は**タグの付いたコミットしか指せない**（submodule の規約）。
