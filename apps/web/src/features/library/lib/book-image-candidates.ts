import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { ContentBudgetError } from "../../../../foliate-js/src/content-budget";
import { isInlineFootnote, NON_FOOTNOTE_IMAGE_SELECTOR } from "../../reader/lib/inline-footnote";

export type ImageCandidate = { element: Element; src: string; original: boolean };
const selector = `${NON_FOOTNOTE_IMAGE_SELECTOR}, image`;
const source = (element: Element) =>
  element.getAttribute("src") ??
  element.getAttribute("href") ??
  element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
  "";

/** Authored candidates, not the browser's viewport/density choice. Keep data-URL commas intact. */
export function srcsetUrls(input: string): string[] {
  const urls: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (/[\s,]/.test(input[cursor] ?? "") && cursor < input.length) cursor++;
    const start = cursor;
    while (cursor < input.length && !/\s/.test(input[cursor])) cursor++;
    let url = input.slice(start, cursor),
      trailingComma = false;
    while (url.endsWith(",")) {
      url = url.slice(0, -1);
      trailingComma = true;
    }
    if (url) urls.push(url);
    if (!trailingComma)
      while (cursor < input.length && input[cursor++] !== ",") {
        /* skip descriptor */
      }
    if (urls.length > 1000) throw new ContentBudgetError();
  }
  return urls;
}

function cssUrls(style: CSSStyleDeclaration): string[] {
  const values = [
    "background",
    "background-image",
    "border-image",
    "border-image-source",
    "list-style",
    "list-style-image",
    "content",
    "mask-image",
  ].map((property) => style.getPropertyValue(property));
  return values.flatMap((value) =>
    Array.from(value.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]+))\s*\)/gi), (match) =>
      (match[1] ?? match[2] ?? match[3]).replace(
        /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
        (_all, hex: string | undefined, escaped: string | undefined) => {
          const code = hex ? parseInt(hex, 16) : 0;
          return hex
            ? String.fromCodePoint(code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? code : 0xfffd)
            : (escaped ?? "");
        },
      ),
    ),
  );
}

/** Linear block scan, respecting strings/comments; nested conditional rules are independent candidates. */
function* cssRules(text: string): Generator<{ selector: string; body: string }> {
  const stack: { start: number; body: number; nested: boolean; group: boolean }[] = [];
  let start = 0,
    quote = "",
    comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === "*" && text[i + 1] === "/") {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      comment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ start, body: i + 1, nested: false, group: text.slice(start, i).trimStart().startsWith("@") });
      start = i + 1;
    } else if (ch === "}") {
      const rule = stack.pop();
      if (rule && !rule.nested && !rule.group)
        yield { selector: text.slice(rule.start, rule.body - 1), body: text.slice(rule.body, i) };
      start = i + 1;
    } else if (ch === ";" && (!stack.length || stack[stack.length - 1].group)) start = i + 1;
  }
}

export async function imageCandidates(
  book: FoliateBook,
  index: number,
  doc: Document,
  signal?: AbortSignal,
): Promise<ImageCandidate[]> {
  const result: ImageCandidate[] = [],
    seen = new WeakMap<Element, Set<string>>();
  const add = (element: Element, src: string, original = false) => {
    const values = seen.get(element) ?? new Set<string>();
    seen.set(element, values);
    if (values.has(src)) return;
    values.add(src);
    result.push({ element, src, original });
    if (result.length > 10_000) throw new ContentBudgetError();
  };
  // Preserve all existing img/SVG descriptor ordinals; append newly discovered candidates.
  for (const element of doc.querySelectorAll(selector)) add(element, source(element), true);
  for (const element of doc.querySelectorAll("img[srcset], picture > source[srcset]")) {
    if (isInlineFootnote(element)) continue;
    const anchor = element.localName === "source" ? element.parentElement?.querySelector("img") : element;
    if (anchor) for (const url of srcsetUrls(element.getAttribute("srcset") ?? "")) add(anchor, url);
  }
  const scratch = doc.createElementNS("http://www.w3.org/1999/xhtml", "span") as HTMLElement;
  for (const element of doc.querySelectorAll("[style]")) {
    scratch.style.cssText = element.getAttribute("style") ?? "";
    for (const url of cssUrls(scratch.style)) add(element, url);
  }
  const sheets = Array.from(doc.querySelectorAll("style"), (style) => ({
    text: style.textContent ?? "",
    resolveHref: (href: string) => href,
  }));
  sheets.push(...((await book.sections[index].getImageStyles?.(doc, signal)) ?? []));
  signal?.throwIfAborted();
  let chars = 0,
    rules = 0,
    scannedElements = 0;
  const elementCount = doc.getElementsByTagName("*").length;
  for (const sheet of sheets) {
    if ((chars += sheet.text.length) > 512 * 1024) throw new ContentBudgetError();
    // Discover declarations in nested @media/supports too, without claiming the active cascade.
    for (const rule of cssRules(sheet.text)) {
      if (++rules > 5000) throw new ContentBudgetError();
      const selector = rule.selector.trim().replace(/::?(?:before|after)\b/g, "");
      if (!selector || selector.startsWith("@")) continue;
      scratch.style.cssText = rule.body;
      const urls = cssUrls(scratch.style);
      if (!urls.length) continue;
      if ((scannedElements += elementCount) > 5_000_000) throw new ContentBudgetError();
      let matches: NodeListOf<Element>;
      try {
        matches = doc.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const element of matches) for (const url of urls) add(element, sheet.resolveHref(url));
    }
  }
  return result;
}
