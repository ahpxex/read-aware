/**
 * Fallback synthesis for deficient tables of contents. Some converted books
 * (Calibre size-splits are the usual culprit) carry a nav with one or two
 * entries — "Cover" / "Text" — while the spine holds many sections, leaving
 * the TOC panel useless and every chapter-scoped feature blind. When the nav
 * covers too little of the spine, this rewrites `book.toc` IN PLACE before the
 * view opens: original entries keep their spot, and every uncovered linear
 * section gets an entry labeled by its first heading — or, headingless, by its
 * opening words. Run it on the parsed book BEFORE `view.open(book)`: foliate
 * builds its TOC progress (relocate's `tocItem`) from `book.toc` at open time,
 * so rewriting first aligns the engine and the app on the same synthesized map.
 */

import type { Book, BookSection, TOCItem } from "../../../../foliate-js/src/book";
import { createLogger } from "../../../platform/logger";

type SectionLike = Pick<BookSection, "id" | "linear" | "createDocument">;
type NavItemLike = TOCItem;
type BookLike = Pick<Book, "toc" | "splitTOCHref" | "getSectionHref" | "resolveHref"> & { sections?: SectionLike[] };
const log = createLogger("toc-synthesis");

/** Beyond this many sections, scanning every document is too costly — and a
 *  book that large with a tiny nav is practically nonexistent. */
const MAX_SYNTHESIZED_SECTIONS = 60;
/** A nav covering less than this share of the linear spine is deficient. */
const MIN_SPINE_COVERAGE = 0.5;
const MIN_SECTIONS_TO_BOTHER = 4;
const LABEL_MAX_CHARS = 24;
const MIN_LABEL_SOURCE_CHARS = 6;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

/** File part of an href, canonicalized the way epub-utils does. */
function fileOf(href: string): string {
  return decodeURI(String(href).split("#")[0])
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function flattenNav(items: NavItemLike[] | null | undefined): NavItemLike[] {
  return (items ?? []).flatMap((item) => [
    item,
    ...flattenNav(item.subitems ?? undefined),
  ]);
}

/** The section a nav href points at, by the engine's own mapping when it has one. */
async function sectionIndexOfHref(book: BookLike, href: string, sections: SectionLike[]): Promise<number> {
  if (typeof book.splitTOCHref === "function") {
    let split: Awaited<ReturnType<NonNullable<Book['splitTOCHref']>>>;
    try {
      split = await book.splitTOCHref(href);
    } catch (error) {
      log.warn("Could not resolve TOC section", error);
      split = null;
    }
    const first = split?.[0];
    if (typeof first === "number") return first >= 0 && first < sections.length ? first : -1;
  }
  const file = fileOf(href);
  return sections.findIndex((section) => {
    if (section.id == null) return false;
    const sectionFile = fileOf(String(section.id));
    return sectionFile === file || sectionFile.endsWith(file) || file.endsWith(sectionFile);
  });
}

/** Map each nav entry (with an href) to the section it lands in. */
async function sectionIndexesCoveredByNav(
  book: BookLike,
  nav: NavItemLike[],
  sections: SectionLike[],
): Promise<Map<number, NavItemLike[]>> {
  const covered = new Map<number, NavItemLike[]>();
  for (const item of nav) {
    if (!item.href) continue;
    const index = await sectionIndexOfHref(book, item.href, sections);
    if (index < 0) continue;
    const existing = covered.get(index);
    if (existing) existing.push(item);
    else covered.set(index, [item]);
  }
  return covered;
}

/** First heading text, else the opening words of the first substantial paragraph. */
function labelFromDocument(doc: Document): string | null {
  const heading = Array.from(doc.querySelectorAll("h1, h2, h3"))
    .map((el) => normalizeWhitespace(el.textContent ?? ""))
    .find((text) => text.length > 0);
  if (heading) return truncateLabel(heading);

  const candidates = [
    ...Array.from(doc.body?.querySelectorAll("p") ?? []),
    ...Array.from(doc.body?.children ?? []),
  ];
  for (const el of candidates) {
    const text = normalizeWhitespace(el.textContent ?? "");
    if (text.length >= MIN_LABEL_SOURCE_CHARS) return truncateLabel(text);
  }
  return null;
}

function truncateLabel(text: string): string {
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text;
}

/**
 * Detect a deficient nav and rewrite `book.toc` with synthesized entries.
 * Returns true when the toc was rewritten. Non-linear sections and sections
 * with no readable text stay out (a chapter spanning several files keeps a
 * single entry at its first file — the rest just continue it).
 */
export async function ensureUsableToc(target: BookLike): Promise<boolean> {
  const sections = target.sections ?? [];
  const linearIndexes = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.linear !== "no" && typeof section.createDocument === "function")
    .map(({ index }) => index);
  if (linearIndexes.length < MIN_SECTIONS_TO_BOTHER) return false;
  if (linearIndexes.length > MAX_SYNTHESIZED_SECTIONS) return false;

  const flatNav = flattenNav(target.toc);
  const covered = await sectionIndexesCoveredByNav(target, flatNav, sections);
  const coverage = covered.size / linearIndexes.length;
  if (flatNav.length > 0 && coverage >= MIN_SPINE_COVERAGE) return false;

  const synthesized: NavItemLike[] = [];
  let added = 0;
  for (const index of linearIndexes) {
    const original = covered.get(index);
    if (original?.length) {
      // Keep the book's own entries where they exist — flattened, since the
      // synthesized neighbors have no hierarchy to nest under.
      synthesized.push(...original.map((item) => ({ label: item.label, href: item.href })));
      continue;
    }
    const section = sections[index];
    // The entry must be something the engine can navigate to: the engine's
    // own href for the section when it minted one (MOBI/KF8), else the
    // section's file path (EPUB). A section with neither gets no entry —
    // an unresolvable href is worse than a missing one.
    const href =
      typeof target.getSectionHref === "function"
        ? target.getSectionHref(index)
        : section.id != null && typeof target.splitTOCHref !== "function"
          ? String(section.id)
          : undefined;
    if (!href) continue;
    try {
      const doc = await section.createDocument!();
      const label = labelFromDocument(doc);
      if (!label) continue;
      synthesized.push({ label, href });
      added++;
    } catch (error) {
      log.warn("Could not synthesize a chapter label", error);
    }
  }

  if (added === 0) return false;
  target.toc = synthesized;
  return true;
}
