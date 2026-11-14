/**
 * 外のライブラリを束ねるスクリプトの目印と、束ね方。`tools/build.mjs` が `generated/` に書き、`tools/check.mjs` と
 * `test/bundle.test.mjs` が同じ関数で作り直して比べる。
 *
 * 束ねたスクリプトは import の無い 1 本の JS (esbuild の IIFE・minify) で、`generated/<名前>` の先頭に `// @ts-nocheck` を
 * 置く。型は束ねる前の `scripts/<名前>` を tsc が見る (tsconfig.json)。束ねた JS を tsc に意味を検査させると、
 * ライブラリの JS の型の緩さに当たって通らない。ts-compile-service も `// @ts-nocheck` の在る TS として受ける。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 束ねるスクリプト。鍵は `scripts/` の中の名前。
 * - `packages`: ソースが import してよい package。ここに無い物を import すると `tools/check.mjs` が止める
 * - `versions`: esbuild の define で版の文字列に置き換える識別子 → 版を読む package。ソースは `declare const` で宣言する。
 *   外から読みに行く部品 (WASM など) の URL の版を、束ねた JS の版と揃えるため
 *
 * @type {Readonly<Record<string, { packages: readonly string[], versions: Readonly<Record<string, string>> }>>}
 */
export const BUNDLES = {
  "face-mustache.ts": {
    packages: ["@mediapipe/tasks-vision"],
    versions: { TASKS_VISION_VERSION: "@mediapipe/tasks-vision" },
  },
};

/**
 * 入っている package の版と license。package.json の devDependencies の版 (範囲でなく 1 つの版) と食い違えば投げる ——
 * lockfile と node_modules が古いまま束ねると、URL に書く版と束ねた JS の版がずれる。
 * `@mediapipe/tasks-vision` の exports は `./package.json` を出さないので、node_modules の file を直に読む。
 */
export const installed = (name) => {
  const wanted = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies?.[name];
  const { version, license } = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  if (wanted !== version) {
    throw new Error(`${name}: package.json は ${String(wanted)}、入っているのは ${String(version)} —— pnpm install を流す`);
  }
  return { version, license: String(license) };
};

/** `scripts/<name>` を束ねた `generated/<name>` の中身 */
export const bundle = async (name) => {
  const spec = BUNDLES[name];
  if (spec === undefined) throw new Error(`${name} は束ねるスクリプトではない (tools/bundle.mjs の BUNDLES)`);
  const define = Object.fromEntries(
    Object.entries(spec.versions).map(([identifier, pkg]) => [identifier, JSON.stringify(installed(pkg).version)]),
  );
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join("scripts", name)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2023",
    minify: true,
    // ライブラリの license の注記 (/*! や @license の comment) は minify しても残す
    legalComments: "inline",
    define,
    write: false,
    logLevel: "silent",
  });
  const [output, ...rest] = result.outputFiles;
  if (output === undefined || rest.length > 0) throw new Error(`${name}: esbuild の出力が 1 本でない`);
  const header = [
    "// @ts-nocheck",
    `// capture-scripts の build (tools/build.mjs) が scripts/${name} を束ねて作った。手で書かない。`,
    "// 型は束ねる前に scripts/ で検査済み (tsconfig.json)。ここは束ねた JS なので、tsc に意味を検査させない。",
    ...spec.packages.map((pkg) => {
      const { version, license } = installed(pkg);
      return `// 束ねた package: ${pkg} ${version} (license: ${license})`;
    }),
  ];
  return `${header.join("\n")}\n${output.text}`;
};
