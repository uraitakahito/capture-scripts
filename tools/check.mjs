#!/usr/bin/env node
/**
 * この repo が言えることだけを言う検査 (`pnpm run check` の後半。前半は tsc)。
 *
 * ## 何を見るか
 *
 * 1. **catalog.json と実体が一致するか** —— 列挙された `file` が在る / `scripts/` の
 *    `.ts` が全部列挙されている / `id` が重複しない / `phase` が 2 値のどちらか。
 * 2. **sha256 を印字する** —— 台帳 (`pnpm run scripts list`) に並ぶ digest と、
 *    目で突き合わせられるように。台帳が打つのは、書いたままの TS のバイト列に対する値。
 *
 * ## 何を見ないか
 *
 * **型と構文は tsc が見る** (`pnpm run typecheck`)。型が通らない TS は tag にならない ——
 * それが門番の 1 か所目で、2 か所目はクロールの段ごとに同じ型検査をする ts-compile-service。
 *
 * **「本当にスクロールするか」は、ここでは言えない。** jsdom はレイアウトを持たず
 * `scrollHeight` が常に 0 なので、`autoscroll` は 1 段も進まない。振る舞いの証拠には
 * 本物のブラウザが要るので、capture-scheduler の e2e (capture-fixtures の
 * `/responsive-images` に対して `autofetch` が引いた変種を数える) に置いてある。
 *
 * ここの検査は「catalog の食い違い」を止めるためのもの。
 */
import { createHash } from "node:crypto";
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
  .filter((name) => name.endsWith(".ts"))
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
  if (typeof script.file !== "string" || !script.file.endsWith(".ts")) {
    fail(`${where}: file は scripts/ の .ts を指すこと (いまは ${String(script.file)})`);
  }

  let source;
  try {
    source = readFileSync(join(root, script.file), "utf8");
  } catch {
    fail(`${where}: ${String(script.file)} が無い`);
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

process.stdout.write(`\n✓ check passed: ${String(rows.length)} 本とも catalog.json と一致している\n`);
