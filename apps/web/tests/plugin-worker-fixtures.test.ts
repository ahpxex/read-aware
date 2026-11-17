import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const web = resolve(import.meta.dir, "..");
const fixtures = join(web, "tests/fixtures/plugin-workers");
const retired = [join(web, "src/features/plugins/runtime/fixtures"), join(web, "tests/desktop")];

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function references(path: string): string[] {
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      if (
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) &&
          parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
          parent.arguments[0] === node) ||
        (ts.isNewExpression(parent) && parent.expression.getText(ast) === "URL" && parent.arguments?.[0] === node) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
      )
        result.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

test("plugin Worker probes live outside production source and keep resolvable source paths", () => {
  for (const path of retired) expect(existsSync(path)).toBe(false);
  const modules = files(fixtures).filter((path) => /\.tsx?$/.test(path));
  expect(modules.length).toBeGreaterThan(0);
  for (const path of modules) {
    for (const reference of references(path).filter((item) => item.startsWith("."))) {
      const target = resolve(dirname(path), reference);
      expect(
        ["", ".ts", ".tsx", ".json", "/index.ts", "/index.tsx"].some((suffix) => existsSync(target + suffix)),
        `${relative(web, path)}: ${reference}`,
      ).toBe(true);
    }
  }
});

test("production modules do not depend on the Worker probes", () => {
  for (const path of files(join(web, "src")).filter(
    (path) => /\.tsx?$/.test(path) && !/\.(test|stories)\.tsx?$/.test(path),
  )) {
    for (const reference of references(path)) {
      expect(reference.includes("runtime/fixtures"), path).toBe(false);
      const target = reference.startsWith(".") ? resolve(dirname(path), reference) : resolve(web, `.${reference}`);
      expect(target === fixtures || target.startsWith(`${fixtures}/`), path).toBe(false);
    }
  }
});
