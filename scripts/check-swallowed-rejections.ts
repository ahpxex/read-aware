/**
 * Rejects promise-rejection handlers that discard the failure without a word:
 * `.catch(() => {})`, `.catch(() => undefined)`, `.then(ok, () => {})` and the
 * like. Such a handler must log through the module's logger, or carry a comment
 * saying why ignoring the failure is correct — on the handler, on the line of the
 * call, or directly above the statement (see CLAUDE.md, "Errors and IPC").
 *
 * oxlint has no rule for this shape (no-empty-function would also flag every
 * intentional no-op callback), so it runs beside `oxlint` in `bun run lint`.
 *
 *   bun scripts/check-swallowed-rejections.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** Generated, vendored or built output: not code this repository writes. */
const IGNORED = [
  /(^|\/)dist\//,
  /^apps\/web\/public\//,
  /^apps\/web\/foliate-js\/src\/vendor\//,
  /^apps\/desktop\/src-tauri\//,
  /^apps\/desktop\/vendor\//,
  /routeTree\.gen\.ts$/,
];

type Finding = { file: string; line: number; text: string };

function trackedSources(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return output.split("\0").filter((file) => SOURCE.test(file) && !IGNORED.some((pattern) => pattern.test(file)));
}

/** A handler that neither inspects nor reports the failure it receives. */
function discardsFailure(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const body = node.body;
  if (ts.isBlock(body)) return body.statements.length === 0;
  const value = ts.isParenthesizedExpression(body) ? body.expression : body;
  return (
    (ts.isIdentifier(value) && value.text === "undefined") ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isVoidExpression(value) && ts.isLiteralExpression(value.expression))
  );
}

function rejectionHandler(call: ts.CallExpression): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  if (method === "catch") return call.arguments[0];
  if (method === "then") return call.arguments[1];
  return undefined;
}

function hasComment(text: string, start: number, end: number): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text.slice(start, end));
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) return true;
  }
  return false;
}

function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    !ts.isBlock(current.parent) &&
    !ts.isModuleBlock(current.parent) &&
    !ts.isCaseClause(current.parent) &&
    !ts.isDefaultClause(current.parent)
  )
    current = current.parent;
  return current;
}

function lineRange(source: ts.SourceFile, line: number): [number, number] {
  const starts = source.getLineStarts();
  return [starts[line]!, line + 1 < starts.length ? starts[line + 1]! : source.text.length];
}

/** Documented when a comment sits in the handler, on the line of `.catch(` /
 * `.then(`, on the line just above the handler, or directly above the
 * statement that makes the call. */
function documented(source: ts.SourceFile, call: ts.CallExpression, handler: ts.Expression): boolean {
  const text = source.text;
  if (hasComment(text, handler.getStart(source), handler.getEnd())) return true;
  const callLine = source.getLineAndCharacterOfPosition(call.expression.getEnd()).line;
  if (hasComment(text, ...lineRange(source, callLine))) return true;
  const handlerLine = source.getLineAndCharacterOfPosition(handler.getStart(source)).line;
  if (handlerLine > 0 && /^\s*(\/\/|\/\*|\*)/.test(text.slice(...lineRange(source, handlerLine - 1)))) return true;
  const statement = enclosingStatement(call);
  return hasComment(text, statement.getFullStart(), statement.getStart(source));
}

export function findSwallowedRejections(file: string, text: string): Finding[] {
  const kind = file.endsWith("x")
    ? ts.ScriptKind.TSX
    : file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const handler = rejectionHandler(node);
      if (handler && discardsFailure(handler) && !documented(source, node, handler)) {
        const { line } = source.getLineAndCharacterOfPosition(handler.getStart(source));
        findings.push({ file, line: line + 1, text: text.split("\n")[line]!.trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

if (import.meta.main) {
  const findings = trackedSources().flatMap((file) => findSwallowedRejections(file, readFileSync(file, "utf8")));
  for (const finding of findings) console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  if (findings.length) {
    console.error(
      `\n${findings.length} promise rejection(s) discarded without a log or a comment saying why ignoring is correct.`,
    );
    process.exit(1);
  }
  console.log("No silently swallowed promise rejections.");
}
