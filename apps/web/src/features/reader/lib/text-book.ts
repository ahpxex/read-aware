/**
 * foliate-compatible books for the two formats the engine does not parse:
 * plain text and single-file HTML.
 *
 * Both are assembled app-side into the same section/toc contract `view.open()`
 * expects (the plugin-served virtual books use it too), so they read with the
 * same pagination, selection, CFI-anchored annotations, and progress model as
 * an EPUB. Nothing here touches the vendored engine.
 */
import { decodeTextBook } from "./decode-text";
import type { FoliateBook } from './foliate-engine';
import { escapeHtml, wrapSectionHtml } from "./section-document";
import {
  labelFromOpeningWords,
  linesToParagraphs,
  splitTextIntoChapters,
} from "./text-chapters";

type BuiltSection = {
  id: string;
  /** The heading the text carried, rendered at the top of the section. */
  title?: string;
  /** What the table of contents shows — falls back to the opening words. */
  label?: string;
  html: string;
};

/** Plain text arrives with no styling of its own; give it readable defaults. */
const TEXT_SECTION_STYLE = "p { margin: 0 0 1em; text-indent: 2em; }";

export function buildPlainTextFoliateBook(bytes: Uint8Array, fileName: string): FoliateBook {
  const text = decodeTextBook(bytes);
  const chapters = splitTextIntoChapters(text);
  const built: BuiltSection[] = chapters.map((chapter, index) => ({
    id: `text-${index}`,
    title: chapter.title,
    // An untitled run (the text before the first heading, or a synthesized
    // chunk) still deserves a readable TOC entry rather than a bare number.
    label: chapter.title ?? labelFromOpeningWords(chapter.lines),
    html: linesToParagraphs(chapter.lines)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join(""),
  }));

  return assembleBook(built, {
    title: stripExtension(fileName),
    language: guessLanguage(text),
    sectionStyle: TEXT_SECTION_STYLE,
  });
}

export function buildHtmlFoliateBook(bytes: Uint8Array, fileName: string): FoliateBook {
  const doc = new DOMParser().parseFromString(decodeTextBook(bytes), "text/html");
  const title = doc.querySelector("title")?.textContent?.trim();
  const author = doc
    .querySelector('meta[name="author" i]')
    ?.getAttribute("content")
    ?.trim();
  const language = doc.documentElement.getAttribute("lang")?.trim() || "en";

  return assembleBook(splitHtmlBody(doc), {
    title: title || stripExtension(fileName),
    author: author || undefined,
    language,
    // The document's own <style> rules travel with each section so a styled
    // article keeps looking like itself.
    sectionStyle: Array.from(doc.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n"),
  });
}

/**
 * Cut an HTML body at its top-level headings. A document with fewer than two
 * of them stays one section — splitting it would invent structure the author
 * did not write.
 */
function splitHtmlBody(doc: Document): BuiltSection[] {
  const body = doc.body ?? doc.documentElement;
  const children = Array.from(body.children);
  const headingAt = (element: Element) =>
    /^h[12]$/i.test(element.tagName) ? element.textContent?.trim() || undefined : null;

  const headingCount = children.filter((child) => headingAt(child) !== null).length;
  if (headingCount < 2) {
    return [{ id: "html-0", html: body.innerHTML }];
  }

  const sections: BuiltSection[] = [];
  let current: { title?: string; parts: string[] } | null = null;
  const flush = () => {
    if (current && (current.title || current.parts.some((part) => part.trim()))) {
      sections.push({
        id: `html-${sections.length}`,
        title: current.title,
        html: current.parts.join(""),
      });
    }
    current = null;
  };

  for (const child of children) {
    const heading = headingAt(child);
    if (heading !== null) {
      flush();
      current = { title: heading, parts: [] };
      continue;
    }
    current ??= { parts: [] };
    current.parts.push(child.outerHTML);
  }
  flush();
  return sections.length ? sections : [{ id: "html-0", html: body.innerHTML }];
}

function assembleBook(
  built: BuiltSection[],
  meta: { title: string; author?: string; language: string; sectionStyle: string },
): FoliateBook {
  const sections = built.length ? built : [{ id: "text-0", html: "" }];
  const docs = sections.map((section) =>
    wrapSectionHtml(section.html, section.title, meta.language, meta.sectionStyle),
  );
  const ids = sections.map((section) => section.id);

  return {
    metadata: {
      title: meta.title,
      author: meta.author ?? "",
      language: meta.language,
    },
    sections: sections.map((section, index) => {
      let url: string | null = null;
      return {
        id: section.id,
        linear: "yes",
        size: docs[index]!.length,
        load: async () =>
          (url ??= URL.createObjectURL(new Blob([docs[index]!], { type: "text/html" }))),
        unload: () => {
          if (url) {
            URL.revokeObjectURL(url);
            url = null;
          }
        },
        createDocument: async () => new DOMParser().parseFromString(docs[index]!, "text/html"),
      };
    }),
    // A single untitled section means the book has no navigation worth
    // showing; `ensureUsableToc` would otherwise synthesize one per chunk.
    toc: sections
      .map((section, index) => ({
        label: section.label || section.title || `${index + 1}`,
        href: section.id,
      }))
      .filter(() => sections.length > 1 || Boolean(sections[0]!.title)),
    resolveHref: (href: string) => {
      const index = ids.indexOf(href.split("#")[0]!);
      return { index: index < 0 ? 0 : index, anchor: () => null };
    },
    splitTOCHref: (href: string) => [href.split("#")[0], null],
    getTOCFragment: (doc: Document) => doc.documentElement,
  };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "") || fileName;
}

/**
 * Enough language signal for the reader's typography (CJK gets different line
 * breaking and justification than Latin script).
 */
function guessLanguage(text: string): string {
  const sample = text.slice(0, 4096);
  let cjk = 0;
  for (const char of sample) {
    const code = char.codePointAt(0)!;
    if (code >= 0x3400 && code <= 0x9fff) cjk++;
  }
  return cjk > sample.length * 0.1 ? "zh" : "en";
}
