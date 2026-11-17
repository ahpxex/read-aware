/**
 * Rejects Tailwind's stock corner radii in product code. Corners come from the
 * design system's named radii (packages/ui/src/radius.css): `rounded-fine`,
 * `-mark`, `-control`, `-surface`, plus `rounded-full` and `rounded-none`.
 * Stock sizes (`rounded`, `rounded-sm` … `rounded-4xl`) and arbitrary values
 * (`rounded-[3px]`) slip past that vocabulary one class at a time, which is how
 * a surface ends up a few pixels off its neighbours. The stock scale stays
 * defined only for third-party markup (Streamdown's compiled classes).
 *
 * Every string and template literal in the app, the design system and the
 * first-party plugins is checked, so class names built with `cn()` count too.
 * The landing site keeps its own styling and is not checked.
 *
 *   bun scripts/check-radius-classes.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SOURCE = /\.tsx?$/;
const CHECKED = [/^apps\/web\/src\//, /^packages\/ui\/src\//, /^plugins\/[^/]+\/src\//];

/** A radius utility with any variant prefixes (`hover:`, `md:`) stripped. */
const RADIUS = /^rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(.+))?$/;
const NAMED = new Set(["fine", "mark", "control", "surface", "full", "none"]);

type Finding = { file: string; line: number; className: string };

function checkedSources(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return output.split("\0").filter((file) => SOURCE.test(file) && CHECKED.some((pattern) => pattern.test(file)));
}

function stockRadii(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.slice(token.lastIndexOf(":") + 1).replace(/^!/, ""))
    .filter((token) => {
      const match = RADIUS.exec(token);
      return match !== null && !NAMED.has(match[1] ?? "");
    });
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return undefined;
}

const findings: Finding[] = [];
for (const file of checkedSources()) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("rounded")) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    const value = literalText(node);
    if (value !== undefined) {
      for (const className of stockRadii(value)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        findings.push({ file, line: line + 1, className });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (findings.length > 0) {
  console.error(
    `${findings.length} stock radius class(es). Use rounded-fine / -mark / -control / -surface (packages/ui/src/radius.css), rounded-full or rounded-none:`,
  );
  for (const finding of findings) console.error(`  ${finding.file}:${finding.line}  ${finding.className}`);
  process.exit(1);
}
console.log("Corner radii use the design system's names.");
