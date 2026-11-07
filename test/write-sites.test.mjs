/** 書き込みと見分けの判定。ページの動きは見ない（本物のブラウザが要る）。 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasSiteGuard, readsSites, writeSites } from "../tools/write-sites.ts";

const guarded = "(async () => {\n  if (!onSite()) return;\n  await 1;\n})();\n";

test("onSite() はホスト名との比較に置き換わる", () => {
  assert.equal(
    writeSites(guarded, ["a.test"]),
    '(async () => {\n  if (!(location.hostname === "a.test")) return;\n  await 1;\n})();\n',
  );
});

test("ホスト名が 2 本なら || で繋ぐ", () => {
  assert.match(writeSites(guarded, ["a.test", "b.test"]), /location\.hostname === "a\.test" \|\| location\.hostname === "b\.test"/);
});

test("catalogSites() は配列のリテラルに置き換わる", () => {
  assert.equal(writeSites("const s = catalogSites();\n", ["a.test", "b.test"]), 'const s = ["a.test","b.test"];\n');
});

test("空白の入った onSite( ) も同じ結果になる", () => {
  assert.equal(writeSites("if (!onSite( )) x();\n", ["a.test"]), writeSites("if (!onSite()) x();\n", ["a.test"]));
});

test("コメントと文字列の中の onSite() には触らない", () => {
  const code = '// onSite() と書く\nconst s = "onSite()";\n';
  assert.equal(writeSites(code, ["a.test"]), code);
});

test("引数のある onSite は置き換えない（tsc が止める）", () => {
  const code = 'onSite("a.test");\n';
  assert.equal(writeSites(code, ["a.test"]), code);
});

test("2 か所を置き換えても位置がずれない", () => {
  assert.equal(
    writeSites("const a = catalogSites();\nif (!onSite()) x();\n", ["a.test"]),
    'const a = ["a.test"];\nif (!(location.hostname === "a.test")) x();\n',
  );
});

for (const [name, code, expected] of [
  ["最初の文の見分け", guarded, true],
  ["import の後の IIFE", 'import { z } from "zod";\n(async () => {\n  if (!onSite()) return;\n  void z;\n})();\n', true],
  ["同期の IIFE", "(() => {\n  if (!onSite()) return;\n})();\n", true],
  ["見分けが無い", "(async () => {\n  await 1;\n})();\n", false],
  ["呼ぶだけで結果を捨てる", "(async () => {\n  onSite();\n})();\n", false],
  ["void で捨てる", "(async () => {\n  void onSite();\n})();\n", false],
  ["|| true で必ず通す", "(async () => {\n  if (!(onSite() || true)) return;\n})();\n", false],
  ["2 文目に置く", "(async () => {\n  const t = Date.now();\n  if (!onSite()) return;\n  void t;\n})();\n", false],
  ["呼ばない関数の中", "(async () => {\n  const never = () => onSite();\n  void never;\n})();\n", false],
  ["ホスト名を渡す", '(async () => {\n  if (!onSite("a.test")) return;\n})();\n', false],
  ["else を持つ", "(async () => {\n  if (!onSite()) return;\n  else void 0;\n})();\n", false],
  ["IIFE が無い", "if (!onSite()) throw 1;\n", false],
  ["反対向き（対象サイトで止まる）", "(async () => {\n  if (onSite()) return;\n})();\n", false],
  ["return に値を持つ", "(async () => {\n  if (!onSite()) return 1;\n})();\n", false],
  ["IIFE の前に文を置く", 'document.title = "x";\n(async () => {\n  if (!onSite()) return;\n})();\n', false],
  ["見分けの無い 2 本目の IIFE", "(async () => {\n  if (!onSite()) return;\n})();\n(async () => {\n  await 1;\n})();\n", false],
]) {
  test(`見分けの判定: ${name}`, () => {
    assert.equal(hasSiteGuard(code), expected);
  });
}

test("読んでいるかはコメントと文字列を数えない", () => {
  assert.equal(readsSites("// onSite()\nconst s = 'catalogSites()';\n"), false);
  assert.equal(readsSites("const s = catalogSites();\n"), true);
});
