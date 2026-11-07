#!/usr/bin/env node
/**
 * この repo が言えることだけを言う検査 (`pnpm run check` の最後。前は tsc と試験)。
 *
 * ## 何を見るか
 *
 * 1. **catalog.json と実体が一致するか** —— 列挙された `file` が在る / `scripts/` の
 *    `.ts` が全部列挙されている (サイト用の物は `generated/` の同じ名前で) / `id` が重複しない /
 *    `phase` が 2 値のどちらか。
 * 2. **対象サイト (`sites`) の形** —— 書くなら小文字のホスト名を 1 本以上・重複なし
 *    (台帳の CHECK と同じ式)。サイト用のスクリプトも、選ばれればどの頁でも走るので、`scripts/` が
 *    IIFE 1 つで、その最初の文が `if (!onSite()) return;` であることを構文木で見る。`generated/` は
 *    作り直して比べ、古い物と作る物の無い物を止める。`sites` の無いスクリプトが `onSite()` を読むのも止める。
 * 3. **クロールごとの値の宣言 (`params`) の形と、source との一致** —— name の綴り・kind・required・
 *    summary・schema・重複・知らない鍵 (既定値はソースの中にしか置かない)。変数の正は source の
 *    `defineParams(z.object({ … }))` で、`catalog.json` の `params` (kind: variable) はその写し
 *    (`tools/read-params.ts` が走らせずに読み、1 つでも違えば止める)。シークレットは `params` が正で、
 *    宣言した名前を source が `__bh.secrets.<名前>` で読んでいること、逆に読んでいる名前は宣言に在ること
 *    (コメントは除いて見る。`["名前"]` の形は見ない)。書き忘れと綴り違いを、台帳に入れる前に止める。
 * 4. **`import` の形** —— 受けるのは `import { z } from "zod"` と `import * as z from "zod/mini"` の 2 つで、
 *    先頭の文に 1 つだけ。`phase: preload` のスクリプトには `import` も `defineParams` も書けない。tsc は
 *    どの形でも通すので、ここで見ないと tag の後にクロールの段で初めて落ちる (ts-compile-service の
 *    `BH0003`・`BH0004` と同じ決まり)。
 * 5. **sha256 を印字する** —— 台帳 (`pnpm run scripts list`) に並ぶ digest と、
 *    目で突き合わせられるように。台帳が打つのは、`file` が指す TS のバイト列に対する値。
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { readParams } from "./read-params.ts";
import { hasSiteGuard, readsSites, writeSites } from "./write-sites.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHASES = new Set(["preload", "behavior"]);
/** 対象サイトの形。小文字の ASCII のホスト名 (IDN は punycode)。台帳の CHECK (capture-ledger の 021) と同じ式 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** 値の名前の形。台帳の schema と BrowserHive の契約 (ValueName) と同じ式。長さは 64 字まで */
const PARAM_NAME = /^[a-z][a-z0-9_]*$/;
const PARAM_NAME_MAX = 64;
const PARAM_KINDS = new Set(["variable", "secret"]);
const PARAM_KEYS = new Set(["name", "kind", "required", "summary", "schema"]);

/**
 * コメントを除いた source。宣言と読む所の突き合わせに使う —— doc comment に書いた
 * `__bh.secrets.api_token` を「読んでいる」と数えないため。tsc の scanner で token だけを拾う
 * (正規表現で `//` を消すと、文字列の中の URL まで消える)。token の間は空白 1 つ。
 */
const withoutComments = (code) => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  return tokens.join(" ");
};

/** source が `__bh.secrets.<名前>` で読んでいる名前。token の間の空白を許す */
const readSecrets = (code) => {
  const names = new Set();
  for (const m of withoutComments(code).matchAll(/__bh\s*\.\s*secrets\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return names;
};

/** ts-compile-service が束ねられる形か。別名・既定の import・`import type`・ほかの package は通さない */
const isAllowedImport = (statement) => {
  if (!ts.isImportDeclaration(statement) || statement.attributes !== undefined) return false;
  const clause = statement.importClause;
  if (clause === undefined || clause.isTypeOnly || clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  const from = statement.moduleSpecifier.text;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return from === "zod/mini" && bindings.name.text === "z";
  const [only, ...rest] = bindings.elements;
  return from === "zod" && rest.length === 0 && only !== undefined && !only.isTypeOnly && only.propertyName === undefined && only.name.text === "z";
};

/** source の `import` の文の問題。答えは文の列 (preload か、形が違うか、先頭の文でないか) */
const importProblems = (code, phase) => {
  const source = ts.createSourceFile("script.ts", code, ts.ScriptTarget.Latest);
  const found = [];
  source.statements.forEach((statement, index) => {
    if (!ts.isImportDeclaration(statement) && !ts.isImportEqualsDeclaration(statement)) return;
    const text = statement.getText(source).replace(/\s+/g, " ");
    if (phase === "preload") found.push(`preload では import を書けない (${text})`);
    else if (!isAllowedImport(statement)) found.push(`受けない import の形 (${text})。"zod" か "zod/mini" の 2 形だけ (README の「Zod」)`);
    else if (index !== 0) found.push(`import は先頭の文に 1 つだけ (${text})`);
  });
  return found;
};

const problems = [];
const fail = (message) => problems.push(message);

/**
 * @typedef {{ name: string, kind: "variable" | "secret", required?: boolean, summary: string, schema?: object }} Param
 *   クロールごとの値の宣言。既定値は書けない (ソースの中にだけ置く)。schema は kind: variable の写しだけ
 * @type {{ profile: string, scripts: { id: string, phase: string, file: string, summary: string, sites?: string[], default?: boolean, params?: Param[] }[] }}
 */
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));

if (catalog.profile !== "capture-scripts/5") {
  fail(`catalog.json の profile が知らない綴り: ${String(catalog.profile)}`);
}

// **ディスクの側から見る。** catalog を基準に回すと、catalog に載っていないファイルが
// 黙って配られない (そして誰も気づかない) —— 足したのに載せ忘れた、がいちばん起きる。
const onDisk = readdirSync(join(root, "scripts"))
  .filter((name) => name.endsWith(".ts"))
  .sort();
const listed = new Set(catalog.scripts.map((script) => basename(String(script.file))));
for (const name of onDisk) {
  if (!listed.has(name)) {
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
    fail(`${where}: file は .ts を指すこと (いまは ${String(script.file)})`);
  }
  // 既定に入るか（台帳の enabled に写る）。省けば入る。真偽値のほかは書けない
  if (script.default !== undefined && typeof script.default !== "boolean") {
    fail(`${where}: default は true か false（省けば既定に入る）`);
  }
  // 対象サイトは省ける (どこでも走るスクリプト)。書くなら、小文字のホスト名を 1 本以上・重複なしで
  const sites = script.sites ?? [];
  if (script.sites !== undefined) {
    if (!Array.isArray(script.sites) || script.sites.length === 0) {
      fail(`${where}: sites は 1 本以上のホスト名の列 (省けばどこでも走る)`);
    } else {
      for (const site of script.sites) {
        if (typeof site !== "string" || !HOSTNAME.test(site)) {
          fail(`${where}: sites の ${JSON.stringify(site)} は小文字のホスト名ではない (ポート・scheme・* は書けない)`);
        }
      }
      if (new Set(script.sites).size !== script.sites.length) fail(`${where}: sites に同じホスト名が 2 度ある`);
    }
  }

  // クロールごとの値の宣言。省けば値を読まないスクリプト。書くなら列で、1 つずつ形を見る。
  // 既定値は書けない —— 知らない鍵 (default・value …) はここで止める (README「既定値はソースの中にしか置かない」)
  const declaredVariables = [];
  const declaredSecrets = new Set();
  if (script.params !== undefined) {
    if (!Array.isArray(script.params)) {
      fail(`${where}: params は宣言の列 (省けばクロールごとの値を読まないスクリプト)`);
    } else {
      const names = new Set();
      for (const param of script.params) {
        if (param === null || typeof param !== "object" || Array.isArray(param)) {
          fail(`${where}: params の項目は { name, kind, summary } の object (いまは ${JSON.stringify(param)})`);
          continue;
        }
        const label = `${where}: params の ${typeof param.name === "string" ? param.name : JSON.stringify(param.name)}`;
        if (typeof param.name !== "string" || !PARAM_NAME.test(param.name) || param.name.length > PARAM_NAME_MAX) {
          fail(`${label}: name は英小文字で始め、英小文字・数字・_ で ${String(PARAM_NAME_MAX)} 字まで`);
        }
        if (!PARAM_KINDS.has(param.kind)) {
          fail(`${label}: kind は variable か secret (いまは ${String(param.kind)})`);
        }
        if (param.kind === "secret" && param.schema !== undefined) {
          fail(`${label}: schema を書けるのは kind: variable だけ`);
        }
        if (param.required !== undefined && typeof param.required !== "boolean") {
          fail(`${label}: required は true か false (省けば false)`);
        }
        if (typeof param.summary !== "string" || param.summary === "") {
          fail(`${label}: summary が空 —— 値を入れる欄に何を書くか分からなくなる`);
        }
        for (const key of Object.keys(param)) {
          if (!PARAM_KEYS.has(key)) fail(`${label}: 知らない鍵 ${key} (既定値はソースの中にしか置かない)`);
        }
        if (names.has(param.name)) fail(`${label}: 同じ名前が 2 度ある`);
        names.add(param.name);
        if (param.kind === "variable") declaredVariables.push(param);
        if (param.kind === "secret" && typeof param.name === "string") declaredSecrets.add(param.name);
      }
    }
  }

  let source;
  try {
    source = readFileSync(join(root, script.file), "utf8");
  } catch {
    fail(`${where}: ${String(script.file)} が無い`);
    continue;
  }

  // シークレットの宣言と source の一致。宣言した名前を読んでいない = 書き忘れ、読んでいるのに宣言が無い = 綴り違いか
  // 宣言の忘れ。どちらも台帳に入った後では、頁の中で undefined を読むだけで誰も気づかない
  const secretReads = readSecrets(source);
  for (const name of declaredSecrets) {
    if (!secretReads.has(name)) {
      fail(`${where}: params の ${name} を ${script.file} が __bh.secrets.${name} で読んでいない`);
    }
  }
  for (const name of secretReads) {
    if (!declaredSecrets.has(name)) {
      fail(`${where}: ${script.file} が __bh.secrets.${name} を読むが、params に宣言が無い`);
    }
  }

  // 変数の正は source の宣言で、catalog.json はその写し。読めない形と、写しのずれを止める。答えの形をそのまま
  // 見せるので、catalog.json に貼れば直る
  const read = readParams(source);
  for (const problem of read.problems) {
    fail(`${where}: ${script.file}:${String(problem.line)}:${String(problem.col)} ${problem.message}`);
  }
  if (read.problems.length === 0) {
    const copy = declaredVariables.map((param) => ({ ...param, required: param.required === true }));
    if (!isDeepStrictEqual(copy, read.params)) {
      fail(
        `${where}: params の変数が ${script.file} の defineParams の宣言と食い違う。` +
          `source の宣言は ${JSON.stringify(read.params)}`,
      );
    }
  }
  for (const param of read.params) {
    if (param.summary === undefined || param.summary === "") {
      fail(`${where}: ${script.file} の ${param.name} に .describe("…") が無い —— 値を入れる欄に何を書くか分からなくなる`);
    }
  }
  if (script.phase === "preload" && read.declares) {
    fail(`${where}: ${script.file} は preload では defineParams を使えない (受け皿が無い)`);
  }

  for (const problem of importProblems(source, script.phase)) fail(`${where}: ${script.file} の ${problem}`);

  // 見分けの行は書く所 (scripts/) で見る。generated/ は作り直して比べる
  const wanted = Array.isArray(sites) ? sites : [];
  const name = basename(String(script.file));
  if (wanted.length > 0) {
    const written = readFileSync(join(root, "scripts", name), "utf8");
    if (!hasSiteGuard(written)) {
      fail(`${where}: scripts/${name} は IIFE 1 つにし、最初の文を if (!onSite()) return; にする`);
    }
    if (script.file !== `generated/${name}`) fail(`${where}: サイト用のスクリプトの file は generated/${name} を指す`);
    else if (source !== writeSites(written, wanted)) fail(`generated/${name} が古い —— pnpm run build を流す`);
  } else {
    if (readsSites(source)) fail(`${where}: sites の無いスクリプトが onSite() か catalogSites() を読む`);
    if (script.file !== `scripts/${name}`) fail(`${where}: file は scripts/${name} を指す`);
  }

  rows.push({
    id: script.id,
    phase: script.phase,
    sites: Array.isArray(sites) ? sites : [],
    vars: read.params.map((param) => param.name),
    secrets: [...declaredSecrets],
    bytes: Buffer.byteLength(source, "utf8"),
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
  });
}

for (const row of rows) {
  process.stdout.write(
    `  ${row.id.padEnd(16)} ${row.phase.padEnd(9)} ${String(row.bytes).padStart(6)} B  sha256:${row.sha256}` +
      (row.sites.length === 0 ? "" : `  sites:${row.sites.join(",")}`) +
      (row.vars.length === 0 ? "" : `  vars:${row.vars.join(",")}`) +
      (row.secrets.length === 0 ? "" : `  secrets:${row.secrets.join(",")}`) +
      "\n",
  );
}

// 見本は配らないが、書き方の手本なので、宣言は読める形であること
for (const name of readdirSync(join(root, "examples")).filter((file) => file.endsWith(".ts"))) {
  for (const problem of readParams(readFileSync(join(root, "examples", name), "utf8")).problems) {
    fail(`examples/${name}:${String(problem.line)}:${String(problem.col)} ${problem.message}`);
  }
}

// 作る物の無い生成物
const made = new Set(catalog.scripts.filter((script) => script.sites !== undefined).map((script) => basename(String(script.file))));
for (const name of existsSync(join(root, "generated")) ? readdirSync(join(root, "generated")) : []) {
  if (!made.has(name)) fail(`generated/${name} を作るスクリプトが無い`);
}

if (problems.length > 0) {
  process.stderr.write(`\n✗ check failed (${String(problems.length)} 件):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(`\n✓ check passed: ${String(rows.length)} 本とも catalog.json と一致している\n`);
