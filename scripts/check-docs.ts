/** Check authored local file and fragment links in docs and repository entrypoints. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";

function documents(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? documents(path) : /\.(md|html)$/.test(path) ? [path] : [];
  });
}

function withoutExamples(text: string): string {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
}

const anchors = new Map<string, Set<string>>();
function documentAnchors(path: string): Set<string> {
  const cached = anchors.get(path);
  if (cached) return cached;
  const text = withoutExamples(readFileSync(path, "utf8"));
  const ids = new Set([...text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map((m) => m[1]));
  if (extname(path) === ".md") {
    const counts = new Map<string, number>();
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
      const slug = match[1]
        .replace(/<[^>]*>/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
        .replace(/ /g, "-");
      const count = counts.get(slug) ?? 0;
      ids.add(slug + (count ? `-${count}` : ""));
      counts.set(slug, count + 1);
    }
  }
  anchors.set(path, ids);
  return ids;
}

// The capability matrix and its archived baseline belong to the manual capability
// audit (`check:capabilities` passes --with-capabilities): they link hundreds of
// source files and are not kept current on every commit, so a rename must not
// fail CI here.
const capabilityDocs = [join("docs", "capabilities") + sep, join("docs", "archive", "capabilities") + sep];
const withCapabilities = process.argv.includes("--with-capabilities");
const files = [
  ...documents("docs").filter((path) => withCapabilities || !capabilityDocs.some((dir) => path.startsWith(dir))),
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "CLAUDE.md",
];
const errors: string[] = [];
let checked = 0;
for (const file of files) {
  const text = withoutExamples(readFileSync(file, "utf8"));
  const urls = [
    ...[...text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  for (const raw of new Set(urls)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) continue;
    const url = raw.replace(/^<|>$/g, "").replaceAll("&amp;", "&");
    const [local, fragment] = url.split("#", 2);
    const target = resolve(dirname(file), decodeURIComponent(local.split("?")[0]) || ".");
    const path = local ? target : resolve(file);
    checked++;
    if (!existsSync(path)) {
      errors.push(`${file}: missing file ${raw}`);
    } else if (
      fragment &&
      /\.(md|html)$/.test(path) &&
      statSync(path).isFile() &&
      !documentAnchors(path).has(decodeURIComponent(fragment))
    ) {
      errors.push(`${file}: missing anchor ${raw}`);
    }
  }
}
if (errors.length) {
  for (const error of errors) console.error(error);
  console.error(`${errors.length} broken local links across ${files.length} documents.`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} local links across ${files.length} documents and entrypoints.`);
}
