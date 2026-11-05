// Engine syntax guard for the shipped bundle (issue #41): regex lookbehind
// `(?<=` / `(?<!` is a parse error on WebKit before Safari 16.4 (iOS
// 16.0–16.3, old desktop Safari 16), and one bad literal kills its whole
// module at evaluation time — before any try/catch around a later call could
// help. Every `.js` under dist is parsed: app chunks, the copied foliate
// runtime and vendored dependencies.
//
// String and template literals are checked too: a dependency can build a
// pattern from parts at module load (`new RegExp(parts.join("|"))`), and the
// part that carries the lookbehind is still a literal somewhere in the bundle.
// A lookbehind token in a string is regex source in practice.
//
// A literal inside a `try` block's body is exempt: feature-detection code
// (marked does this) can rely on the parse failure of a *new RegExp* inside
// the try — never a bare literal, which parses eagerly with its file. So is
// the true branch of `probe ? lookbehind : fallback` when `probe` is bound to
// such a detection (marked picks its link pattern that way): engines without
// lookbehind take the other branch. Bindings are resolved by the TypeScript
// checker, not by name, because minified bundles reuse short names per scope.
//
// Run via `bun run check:engine` after `vite build`.

import { readdirSync } from "node:fs";
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

const isLookbehindLiteral = (node: ts.Node, source: ts.SourceFile): boolean => {
  if (ts.isRegularExpressionLiteral(node)) {
    const literal = node.getText(source);
    return lookbehindAt(literal.slice(1, literal.lastIndexOf("/"))) >= 0;
  }
  return (
    (ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)) &&
    lookbehindAt(node.text) >= 0
  );
};

const contains = (node: ts.Node, test: (node: ts.Node) => boolean): boolean =>
  test(node) || (ts.forEachChild(node, (child) => contains(child, test) || undefined) ?? false);

const program = ts.createProgram(scripts, {
  allowJs: true,
  noLib: true,
  noResolve: true,
  noEmit: true,
  types: [],
  target: ts.ScriptTarget.ESNext,
});
const checker = program.getTypeChecker();

for (const file of scripts) {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`engine-compat: ${file} was not parsed`);
  const flag = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const snippet = node.getText(source).replace(/\s+/g, " ").slice(0, 160);
    findings.push(`${relative(web, file)}:${line + 1}:${character + 1}  ${snippet}`);
  };

  // Variables initialised by a lookbehind support detection: a try block that
  // constructs a lookbehind pattern.
  const probes = new Set<ts.Symbol>();
  const findProbes = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      contains(
        node.initializer,
        (inner) => ts.isTryStatement(inner) && contains(inner.tryBlock, (lit) => isLookbehindLiteral(lit, source)),
      )
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) probes.add(symbol);
    }
    ts.forEachChild(node, findProbes);
  };
  findProbes(source);
  const isProbe = (node: ts.Expression): boolean => {
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined;
    return symbol !== undefined && probes.has(symbol);
  };

  const visit = (node: ts.Node, exempt: boolean): void => {
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, true);
      if (node.catchClause) visit(node.catchClause, exempt);
      if (node.finallyBlock) visit(node.finallyBlock, exempt);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = ts.isParenthesizedExpression(node.condition) ? node.condition.expression : node.condition;
      const negated =
        ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
          ? condition.operand
          : undefined;
      visit(node.condition, exempt);
      visit(node.whenTrue, exempt || isProbe(condition));
      visit(node.whenFalse, exempt || (negated !== undefined && isProbe(negated)));
      return;
    }
    if (!exempt && isLookbehindLiteral(node, source)) flag(node);
    ts.forEachChild(node, (child) => visit(child, exempt));
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
