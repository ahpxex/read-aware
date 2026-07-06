/**
 * Headless EPUB 抽取（fixture 专用）：解 zip → OPF spine 顺序 → 章节 HTML 转纯文本，
 * NCX 提供章节标题。给 repl/测试喂真书正文用 —— 不是产品的阅读引擎（那是
 * foliate-js，跑在 webview 里）；这里只求"文本对、顺序对、标题对"。
 */
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterSeed } from "./fixtures";

export interface EpubFixture {
  title: string;
  author?: string;
  chapters: ChapterSeed[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

function htmlToText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br[^>]*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|td)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
}

/** 相对 href 归一到 zip 内路径（仅处理同级/子级与 `../`，fixture 足够）。 */
function resolveHref(baseDir: string, href: string): string {
  const parts = `${baseDir}${href}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function loadEpubFixture(path: string): EpubFixture {
  const files = unzipSync(readFileSync(path));
  const read = (name: string): string | undefined =>
    files[name] ? strFromU8(files[name]) : undefined;

  const container = read("META-INF/container.xml");
  const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error(`not an EPUB (no OPF path): ${path}`);
  const opf = read(opfPath);
  if (!opf) throw new Error(`OPF missing in zip: ${opfPath}`);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const title = decodeEntities(
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1] ?? "Untitled",
  ).trim();
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/.exec(opf)?.[1]?.trim();

  // manifest: id → { href, type }
  const manifest = new Map<string, { href: string; type: string }>();
  for (const [tag] of opf.matchAll(/<item\s[^>]*>/g)) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) manifest.set(id, { href, type: attr(tag, "media-type") ?? "" });
  }

  // NCX 目录：zip 内路径（去 fragment）→ 首个 navPoint 标题
  const titleByPath = new Map<string, string>();
  const ncx = [...manifest.values()].find((item) => item.type === "application/x-dtbncx+xml");
  const ncxContent = ncx && read(resolveHref(opfDir, ncx.href));
  if (ncxContent) {
    const ncxDir = resolveHref(opfDir, ncx.href).split("/").slice(0, -1).join("/");
    const baseDir = ncxDir ? `${ncxDir}/` : "";
    for (const [, label, src] of ncxContent.matchAll(
      /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content src="([^"#]+)[^"]*"/g,
    )) {
      const key = resolveHref(baseDir, src);
      if (!titleByPath.has(key)) titleByPath.set(key, decodeEntities(label).trim());
    }
  }

  // spine 顺序抽正文；跳过没有实际文本的页（封面、版权图页等）
  const chapters: ChapterSeed[] = [];
  for (const [, idref] of opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)) {
    const item = manifest.get(idref);
    if (!item || !item.type.includes("xhtml")) continue;
    const zipPath = resolveHref(opfDir, item.href);
    const html = read(zipPath);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 40) continue;
    const chapterTitle =
      titleByPath.get(zipPath) ?? /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]?.trim();
    chapters.push({ title: chapterTitle, text });
  }

  return { title, author, chapters };
}
