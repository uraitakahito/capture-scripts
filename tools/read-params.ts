/**
 * `defineParams(z.object({ … }))` の宣言を、**走らせずに**構文木から読む。ここが正で、ts-compile-service が
 * `src/vendor/read-params.ts` に 1 バイトも変えずに写す (あちらの `host-types:check` が見る)。
 *
 * ## 走らせない
 *
 * 頼まれた TS をサービスの中で評価すれば、`process.exit` でも何でも走る。だから構文木を歩き、呼べる名前と
 * リテラルの引数だけを、ここにある本物の Zod に渡して組む。読めない形は「読めない」と言って止める。
 *
 * ## 読むのは値が文字列の物だけ
 *
 * 値は `POST /api/crawls` の `variables` から文字列で来て、台帳が JSON Schema で検査する。だから呼べるのは
 * JSON Schema に写せる物だけ。`.default` は既定をソースの外から読めなくし (既定は `??` で書く)、`.regex` は
 * 利用者の正規表現を台帳で走らせることになり (ReDoS)、`.refine` は走らせないと分からない。
 *
 * 答えの `schema` の鍵は `type`・`minLength`・`maxLength`・`enum` だけ。
 */
import ts from "typescript";
import { z } from "zod";

/** 値の名前の形。台帳の schema と BrowserHive の契約 (ValueName) と同じ式。 */
const NAME = /^[a-z][a-z0-9_]*$/;
const NAME_MAX = 64;
/**
 * 呼べる名前と、その引数の形。`z.` の次に呼べるのは ROOTS だけ (値は文字列だけなので `z.number` は読まない)。
 * 引数も形を決める —— `@ts-nocheck` の `.min("x")` を黙って読むと、制約が消えた宣言になる。
 */
const ROOTS = new Set(["string", "enum"]);
type Argument = "count" | "text" | "list";
const SIGNATURES: Readonly<Record<string, readonly Argument[]>> = {
  string: [],
  enum: ["list"],
  min: ["count"],
  max: ["count"],
  length: ["count"],
  optional: [],
  describe: ["text"],
};
const SCHEMA_KEYS = ["type", "minLength", "maxLength", "enum"] as const;

export interface ParamSchema {
  type: "string";
  minLength?: number;
  maxLength?: number;
  enum?: string[];
}

export interface ReadParam {
  name: string;
  kind: "variable";
  required: boolean;
  /** `.describe("…")` の字。無ければ鍵が無い。 */
  summary?: string;
  schema: ParamSchema;
}

export interface Position {
  line: number;
  col: number;
}

export interface ReadProblem extends Position {
  message: string;
}

export interface ReadResult {
  /** 宣言の順。読めなければ空。 */
  params: ReadParam[];
  /** 名前ごとの宣言の位置 (1 始まり)。「渡されていない」の誤りが指す。 */
  positions: Map<string, Position>;
  /** 読めない形。在れば `params` は当てにならない。 */
  problems: ReadProblem[];
  /** `defineParams` を呼んでいるか。 */
  declares: boolean;
  /** 最初の `defineParams(…)` の呼び出しの位置。 */
  at?: Position;
}

class Unreadable extends Error {
  readonly node: ts.Node;

  constructor(node: ts.Node, message: string) {
    super(message);
    this.node = node;
  }
}

/** 引数を、決まった形のリテラルとして読む。呼び出しも変数も読まない。 */
const argumentOf = (node: ts.Expression, shape: Argument): number | string | string[] => {
  switch (shape) {
    case "count":
      if (ts.isNumericLiteral(node) && Number.isInteger(Number(node.text))) return Number(node.text);
      throw new Unreadable(node, "ここに書けるのは 0 以上の整数のリテラルだけ (走らせずに読むため)");
    case "text":
      if (ts.isStringLiteralLike(node)) return node.text;
      throw new Unreadable(node, "ここに書けるのは文字列のリテラルだけ (走らせずに読むため)");
    case "list":
      if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
        return node.elements.map((element) => {
          if (!ts.isStringLiteralLike(element)) {
            throw new Unreadable(element, "列に書けるのは文字列のリテラルだけ");
          }
          return element.text;
        });
      }
      throw new Unreadable(node, "ここに書けるのは文字列のリテラルの列だけ (走らせずに読むため)");
  }
};

/** 1 つの値の式を、本物の Zod の schema に組む。呼べる名前と引数の形を外れれば止める。 */
const valueOf = (node: ts.Expression): z.ZodType => {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    throw new Unreadable(node, "値に書けるのは z.string()・z.enum([…]) の式だけ");
  }
  const name = node.expression.name.text;
  const target = node.expression.expression;
  const isRoot = ts.isIdentifier(target) && target.text === "z";
  const signature = Object.hasOwn(SIGNATURES, name) ? SIGNATURES[name] : undefined;
  if (isRoot && !ROOTS.has(name)) throw new Unreadable(node, `z.${name} は読めない (値は文字列だけ)`);
  if (signature === undefined || (!isRoot && ROOTS.has(name))) {
    throw new Unreadable(node, `.${name} は読めない (走らせずに読める形だけ。既定は ?? で書く)`);
  }
  if (node.arguments.length !== signature.length) {
    throw new Unreadable(node, `${name} の引数は ${String(signature.length)} つ`);
  }
  const args = node.arguments.map((argument, index) => argumentOf(argument, signature[index] ?? "text"));
  if (isRoot) return name === "string" ? z.string() : z.enum(args[0] as [string, ...string[]]);
  const base = valueOf(target) as unknown as Record<string, ((...a: unknown[]) => z.ZodType) | undefined>;
  const method = base[name];
  if (typeof method !== "function") throw new Unreadable(node, `.${name} はこの値に使えない`);
  return method.apply(base, args);
};

const positionOf = (source: ts.SourceFile, node: ts.Node): Position => {
  const where = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: where.line + 1, col: where.character + 1 };
};

const callsOf = (source: ts.SourceFile): { calls: ts.CallExpression[]; strays: ts.Identifier[] } => {
  const calls: ts.CallExpression[] = [];
  const strays: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "defineParams") {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression === node) calls.push(parent);
      else strays.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, strays };
};

/** `z.object({ … })` を読み、宣言の列にする。 */
const declarationOf = (
  call: ts.CallExpression,
  source: ts.SourceFile,
): { params: ReadParam[]; positions: Map<string, Position> } => {
  const [argument] = call.arguments;
  if (
    call.arguments.length !== 1 ||
    argument === undefined ||
    !ts.isCallExpression(argument) ||
    argument.expression.getText(source) !== "z.object"
  ) {
    throw new Unreadable(call, "defineParams に渡せるのは z.object({ … }) の式だけ");
  }
  const [shape] = argument.arguments;
  if (argument.arguments.length !== 1 || shape === undefined || !ts.isObjectLiteralExpression(shape)) {
    throw new Unreadable(argument, "z.object に渡せるのは { 名前: 値, … } の形だけ");
  }
  const built = new Map<string, z.ZodType>();
  const positions = new Map<string, Position>();
  for (const property of shape.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Unreadable(property, "z.object に書けるのは 名前: 値 の組だけ");
    }
    const name = property.name.text;
    if (!NAME.test(name) || name.length > NAME_MAX) {
      throw new Unreadable(property, `名前 ${name} は ^[a-z][a-z0-9_]*$ で ${String(NAME_MAX)} 字まで`);
    }
    if (built.has(name)) throw new Unreadable(property, `名前 ${name} が 2 度ある`);
    built.set(name, valueOf(property.initializer));
    positions.set(name, positionOf(source, property));
  }
  const json = z.toJSONSchema(z.object(Object.fromEntries(built))) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  const params = [...built.keys()].map((name): ReadParam => {
    const raw = json.properties?.[name] ?? {};
    const schema = Object.fromEntries(
      SCHEMA_KEYS.flatMap((key) => (raw[key] === undefined ? [] : [[key, raw[key]]])),
    ) as unknown as ParamSchema;
    const summary = raw["description"];
    return {
      name,
      kind: "variable",
      required: required.has(name),
      ...(typeof summary === "string" ? { summary } : {}),
      schema,
    };
  });
  return { params, positions };
};

/** source の宣言を読む。走らせない。`defineParams` が無ければ空の答え。 */
export const readParams = (source: string): ReadResult => {
  const parsed = ts.createSourceFile("script.ts", source, ts.ScriptTarget.ES2023, true);
  const problems: ReadProblem[] = [];
  const problem = (node: ts.Node, message: string): void => {
    problems.push({ ...positionOf(parsed, node), message });
  };
  const { calls, strays } = callsOf(parsed);
  for (const stray of strays) problem(stray, "defineParams は直に呼ぶ (別の名前や式では読めない)");
  for (const extra of calls.slice(1)) problem(extra, "defineParams は 1 本に 1 回");
  const [call] = calls;
  if (call === undefined) {
    return { params: [], positions: new Map(), problems, declares: false };
  }
  const at = positionOf(parsed, call);
  try {
    const { params, positions } = declarationOf(call, parsed);
    return { params, positions, problems, declares: true, at };
  } catch (error) {
    if (error instanceof Unreadable) problem(error.node, error.message);
    // 組む途中で Zod が投げた形 (`.min("x")` を @ts-nocheck で書いたなど)
    else problem(call, `宣言を組めない: ${error instanceof Error ? error.message : String(error)}`);
    return { params: [], positions: new Map(), problems, declares: true, at };
  }
};
