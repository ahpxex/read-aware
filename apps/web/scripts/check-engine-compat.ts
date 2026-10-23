// Engine syntax guard for the shipped bundle (issue #41): regex lookbehind
// `(?<=` / `(?<!` is a parse error on WebKit before Safari 16.4 (iOS
// 16.0–16.3, old desktop Safari 16), and one bad literal kills its whole
// module at evaluation time — before any try/catch around a later call could
// help. Every `.js` under dist is parsed: app chunks, the copied foliate
// runtime and vendored dependencies.
//
// A literal inside a `try` block's body is exempt: feature-detection code
// (marked does this) can rely on the parse failure of a *new RegExp* inside
// the try — never a bare literal, which parses eagerly with its file.
//
// Run via `bun run check:engine` after `vite build`.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(web, "dist");

const scripts: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".js")) scripts.push(path);
  }
};
walk(dist);

/** Offset of a genuine lookbehind in `pattern`, or -1. An odd run of
 * backslashes before `(` means an escaped `\(` — literal text, not a group. */
const lookbehindAt = (pattern: string): number => {
  for (const token of ["(?<=", "(?<!"]) {
    let index = pattern.indexOf(token);
    while (index !== -1) {
      let backslashes = 0;
      for (let i = index - 1; i >= 0 && pattern[i] === "\\"; i -= 1) backslashes += 1;
      if (backslashes % 2 === 0) return index;
      index = pattern.indexOf(token, index + 1);
    }
  }
  return -1;
};

const findings: string[] = [];

for (const file of scripts) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const flag = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const snippet = node.getText(source).replace(/\s+/g, " ").slice(0, 160);
    findings.push(`${relative(web, file)}:${line + 1}:${character + 1}  ${snippet}`);
  };
  const visit = (node: ts.Node, inTry: boolean): void => {
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, true);
      if (node.catchClause) visit(node.catchClause, inTry);
      if (node.finallyBlock) visit(node.finallyBlock, inTry);
      return;
    }
    if (!inTry) {
      if (ts.isRegularExpressionLiteral(node)) {
        const literal = node.getText(source);
        const pattern = literal.slice(1, literal.lastIndexOf("/"));
        if (lookbehindAt(pattern) >= 0) flag(node);
      } else if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "RegExp"
      ) {
        const [argument] = node.arguments ?? [];
        if (
          argument &&
          (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) &&
          lookbehindAt(argument.text) >= 0
        ) {
          flag(node);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inTry));
  };
  visit(source, false);
}

if (findings.length) {
  console.error(
    `engine-compat: regex lookbehind shipped in the bundle — a parse error on Safari < 16.4 (issue #41):\n\n${findings.join("\n")}\n`,
  );
  process.exit(1);
}
console.log(`engine-compat: no regex lookbehind in ${scripts.length} dist scripts`);
