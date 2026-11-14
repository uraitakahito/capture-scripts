/** 束ねたスクリプト（tools/bundle.mjs の BUNDLES）の形。頁の中の動きは見ない（本物のブラウザが要る）。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

import { BUNDLES, bundle, installed } from "../tools/bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** TS の修飾子。JS には無い */
const TS_MODIFIERS = new Set([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.OverrideKeyword,
]);

/**
 * TS としてだけ意味を持つ節。束ねた JS は tsc (ここの typecheck と ts-compile-service) が TS として読むので、
 * minify した `a<b>(c)` を型引数つきの呼び出しと読めば、JS の比較が型引数に化けて意味が変わる。
 * 型の節 (型引数・`as`・`<T>x`・`satisfies`・注記はどれも型の節を持つ)・型の引数の宣言・非 null の表明・enum・namespace・
 * TS の修飾子を数える。答えは見つけた節の種類と位置
 */
const tsOnlyNodes = (code) => {
  const source = ts.createSourceFile("bundle.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (
      // `class A extends B` の B (型引数の無い ExpressionWithTypeArguments) は JS にも在る
      (ts.isTypeNode(node) && !(ts.isExpressionWithTypeArguments(node) && (node.typeArguments?.length ?? 0) === 0)) ||
      ts.isTypeParameterDeclaration(node) ||
      ts.isNonNullExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      TS_MODIFIERS.has(node.kind)
    ) {
      found.push(`${ts.SyntaxKind[node.kind]}@${String(node.getStart(source))}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { found, syntaxErrors: source.parseDiagnostics.length };
};

test("TS としてだけ意味を持つ節を見分ける（見張りの見張り）", () => {
  const tsOnly = [
    "f<T>(x);",
    "new C<T>();",
    "f<T>;",
    "x as T;",
    "<T>x;",
    "x satisfies T;",
    "let a: number = 1;",
    "function f<T>() {}",
    "x!;",
    "enum E { A }",
    "namespace N {}",
    "class A { private x; }",
  ];
  for (const code of tsOnly) assert.notDeepEqual(tsOnlyNodes(code).found, [], code);
  for (const code of ["a < b > c;", "a < b && c > d;", "class A extends B {}", "x != y;", "(a) => a;", "a !== b;"]) {
    assert.deepEqual(tsOnlyNodes(code).found, [], code);
  }
});

for (const name of Object.keys(BUNDLES)) {
  const committed = readFileSync(join(root, "generated", name), "utf8");

  test(`${name}: 作り直すと commit した物と同じバイト列になる`, async () => {
    const first = await bundle(name);
    assert.equal(await bundle(name), first);
    assert.ok(first === committed, `generated/${name} が作り直した物と違う —— pnpm run build を流す`);
  });

  test(`${name}: 先頭の行が // @ts-nocheck`, () => {
    assert.equal(committed.split("\n", 1)[0], "// @ts-nocheck");
  });

  test(`${name}: classic script として読める（ts-compile-service の BH0006 と同じ見方）`, () => {
    assert.doesNotThrow(() => new vm.Script(committed));
  });

  test(`${name}: TS として読んでも、TS だけの節も構文の誤りも無い`, () => {
    assert.deepEqual(tsOnlyNodes(committed), { found: [], syntaxErrors: 0 });
  });

  test(`${name}: 外の部品の URL の版が、束ねた package の版と同じ`, () => {
    for (const pkg of Object.values(BUNDLES[name].versions)) {
      const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const versions = [...committed.matchAll(new RegExp(`${escaped}@([^/"'\`]+)/`, "g"))].map((m) => m[1]);
      assert.ok(versions.length > 0, `${pkg}@<版>/ の URL が無い`);
      assert.deepEqual(new Set(versions), new Set([installed(pkg).version]));
    }
  });
}

test("face-mustache.ts: 足す要素に data-capture-script を付ける", () => {
  const committed = readFileSync(join(root, "generated", "face-mustache.ts"), "utf8");
  assert.ok(committed.includes('setAttribute("data-capture-script",'), "data-capture-script を付ける行が無い");
  assert.ok(committed.includes('"face-mustache"'), "値の face-mustache が無い");
});
