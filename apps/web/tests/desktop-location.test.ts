import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const web = resolve(import.meta.dir, "..");
const desktop = join(web, "tests/desktop");
const retired = join(web, "src/features/plugins/runtime/fixtures");

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
      if (((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node)
        || (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword && parent.arguments[0] === node)
        || (ts.isNewExpression(parent) && parent.expression.getText(ast) === "URL" && parent.arguments?.[0] === node)
        || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))) result.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

test("desktop acceptance modules live outside production source and keep resolvable source paths", () => {
  expect(existsSync(retired)).toBe(false);
  const modules = files(desktop).filter((path) => /\.tsx?$/.test(path));
  expect(modules.length).toBeGreaterThan(0);
  for (const path of modules) {
    for (const reference of references(path).filter((item) => item.startsWith("."))) {
      const target = resolve(dirname(path), reference);
      // Formal plugin output is generated in stage two, not required in a clean checkout.
      if (/\/plugins\/[^/]+\/dist\/main\.js$/.test(target)) {
        expect(existsSync(resolve(dirname(target), "../manifest.json"))).toBe(true);
        continue;
      }
      expect(["", ".ts", ".tsx", ".json", "/index.ts", "/index.tsx"].some((suffix) => existsSync(target + suffix)),
        `${relative(web, path)}: ${reference}`).toBe(true);
    }
  }
});

test("production modules do not depend on desktop acceptance code", () => {
  for (const path of files(join(web, "src")).filter((path) => /\.tsx?$/.test(path) && !/\.(test|stories)\.tsx?$/.test(path))) {
    for (const reference of references(path)) {
      expect(reference.includes("runtime/fixtures"), path).toBe(false);
      const target = reference.startsWith(".") ? resolve(dirname(path), reference) : resolve(web, `.${reference}`);
      expect(target === desktop || target.startsWith(`${desktop}/`), path).toBe(false);
    }
  }
});

test("desktop typechecking is retained by the workspace typecheck task", () => {
  const config = JSON.parse(readFileSync(join(desktop, "tsconfig.json"), "utf8"));
  expect(config.include).toContain("./**/*.ts");
  expect(config.include).toContain("./**/*.tsx");
  const manifest = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
  expect(manifest.scripts.typecheck).toContain("bun run typecheck:desktop");
  expect(manifest.scripts["typecheck:desktop"]).toContain("tests/desktop/tsconfig.json");
});
