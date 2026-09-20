#!/usr/bin/env node
/**
 * この repo が言えることだけを言う検査 (`npm run check`)。
 *
 * ## 何を見るか
 *
 * 1. **JS として読めるか** —— `node --check`。壊れた source を配ると、BrowserHive は
 *    ページの中で評価に失敗し、取り込み自体は成功したまま「何も起きなかった」になる。
 * 2. **catalog.json と実体が一致するか** —— 列挙された `file` が在る / `scripts/` の
 *    `.js` が全部列挙されている / `id` が重複しない / `phase` が 2 値のどちらか。
 * 3. **sha256 を印字する** —— 台帳 (`pnpm run scripts list`) に並ぶ digest と、
 *    目で突き合わせられるように。
 *
 * ## 何を見ないか
 *
 * **「本当にスクロールするか」は、ここでは言えない。** jsdom はレイアウトを持たず
 * `scrollHeight` が常に 0 なので、`autoscroll` は 1 段も進まない。振る舞いの証拠には
 * 本物のブラウザが要るので、capture-scheduler の e2e (capture-fixtures の
 * `/responsive-images` に対して `autofetch` が引いた変種を数える) に置いてある。
 *
 * ここの検査は「壊れた JS」と「catalog の食い違い」を止めるためのもの。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHASES = new Set(["preload", "behavior"]);

const problems = [];
const fail = (message) => problems.push(message);

/** @type {{ profile: string, scripts: { id: string, phase: string, file: string, summary: string }[] }} */
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));

if (catalog.profile !== "capture-scripts/1") {
  fail(`catalog.json の profile が知らない綴り: ${String(catalog.profile)}`);
}

// **ディスクの側から見る。** catalog を基準に回すと、catalog に載っていないファイルが
// 黙って配られない (そして誰も気づかない) —— 足したのに載せ忘れた、がいちばん起きる。
const onDisk = readdirSync(join(root, "scripts"))
  .filter((name) => name.endsWith(".js"))
  .sort();
const listed = new Set(catalog.scripts.map((script) => script.file));
for (const name of onDisk) {
  if (!listed.has(`scripts/${name}`)) {
    fail(`scripts/${name} が catalog.json に載っていない —— 載せないと配られない`);
  }
}

const seen = new Set();
const rows = [];

for (const script of catalog.scripts) {
  const where = `catalog.json の ${script.id ?? "(id 無し)"}`;

  if (typeof script.id !== "string" || script.id.trim() !== script.id || script.id === "") {
    fail(`${where}: id は前後に空白の無い文字列であること`);
  }
  if (seen.has(script.id)) fail(`${where}: id が重複している`);
  seen.add(script.id);

  // **phase がこの repo に在ることが、catalog.json の存在理由。** ソースからは読めず、
  // 運用する人が `--phase` で手打ちしていた —— 打ち間違えると、遷移の前に入れるはずの
  // コードが読み込みの後に 1 回だけ走り、しかも成功する。
  if (!PHASES.has(script.phase)) {
    fail(`${where}: phase は preload か behavior (いまは ${String(script.phase)})`);
  }
  if (typeof script.summary !== "string" || script.summary === "") {
    fail(`${where}: summary が空 —— 一覧で何をするものか分からなくなる`);
  }

  let source;
  try {
    source = readFileSync(join(root, script.file), "utf8");
  } catch {
    fail(`${where}: ${String(script.file)} が無い`);
    continue;
  }

  try {
    execFileSync(process.execPath, ["--check", join(root, script.file)], { stdio: "pipe" });
  } catch (error) {
    const detail = String(error.stderr ?? error).split("\n").slice(0, 3).join(" / ");
    fail(`${where}: JS として読めない —— ${detail}`);
    continue;
  }

  rows.push({
    id: script.id,
    phase: script.phase,
    bytes: Buffer.byteLength(source, "utf8"),
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
  });
}

for (const row of rows) {
  process.stdout.write(
    `  ${row.id.padEnd(16)} ${row.phase.padEnd(9)} ${String(row.bytes).padStart(6)} B  sha256:${row.sha256}\n`,
  );
}

if (problems.length > 0) {
  process.stderr.write(`\n✗ check failed (${String(problems.length)} 件):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `\n✓ check passed: ${String(rows.length)} 本とも読めて、catalog.json と一致している\n`,
);
