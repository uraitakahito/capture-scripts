/**
 * サイト用のスクリプトに catalog.json の sites を書き込む係。字ではなく構文木で探すので、コメントや文字列の中の
 * `onSite()` には触らず、`onSite( )` のような書き方でも同じ結果になる。
 *
 * 書き込む比較は `===` を `||` で繋ぐ。`Array.prototype.includes` は相手のサイトの JS が差し替えられる。
 */
import ts from "typescript";

const parse = (code: string): ts.SourceFile =>
  ts.createSourceFile("script.ts", code, ts.ScriptTarget.Latest, true);

/** `onSite()` を比較の式に、`catalogSites()` を配列のリテラルに置き換えた TS。 */
export const writeSites = (code: string, sites: readonly string[]): string => {
  const source = parse(code);
  const test = `(${sites.map((site) => `location.hostname === ${JSON.stringify(site)}`).join(" || ")})`;
  const values = new Map([
    ["onSite", test],
    ["catalogSites", JSON.stringify(sites)],
  ]);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length === 0) {
      const text = values.get(node.expression.text);
      if (text !== undefined) edits.push({ start: node.getStart(source), end: node.getEnd(), text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits.reduceRight((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), code);
};

/**
 * import の他は IIFE 1 つだけで、その最初の文が `if (!onSite()) return;` か。呼ぶだけで結果を捨てる形、
 * 後ろに置く形、IIFE の外や 2 つ目の IIFE で動く文を止める。
 */
export const hasSiteGuard = (code: string): boolean => {
  const [statement, ...others] = parse(code).statements.filter((each) => !ts.isImportDeclaration(each));
  if (statement === undefined || others.length > 0) return false;
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const callee = statement.expression.expression;
  const fn = ts.isParenthesizedExpression(callee) ? callee.expression : undefined;
  if (fn === undefined || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) return false;
  const first = fn.body.statements[0];
  if (first === undefined || !ts.isIfStatement(first) || first.elseStatement !== undefined) return false;
  if (!ts.isReturnStatement(first.thenStatement) || first.thenStatement.expression !== undefined) return false;
  const test = first.expression;
  if (!ts.isPrefixUnaryExpression(test) || test.operator !== ts.SyntaxKind.ExclamationToken) return false;
  const call = test.operand;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "onSite" &&
    call.arguments.length === 0
  );
};

/** source が `onSite` か `catalogSites` を呼んでいるか。コメントと文字列は数えない。 */
export const readsSites = (code: string): boolean => {
  const source = parse(code);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === "onSite" || node.text === "catalogSites")) found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};
