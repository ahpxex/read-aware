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

type SectionLike = {
  id?: string | number;
  linear?: string;
  createDocument?: () => Promise<Document> | Document;
};

type NavItemLike = {
  label?: string;
  href?: string;
  subitems?: NavItemLike[] | null;
};

type BookLike = {
  toc?: NavItemLike[];
  sections?: SectionLike[];
  /**
   * The engine's own href → section mapping (MOBI/KF8 return a numeric
   * section index; EPUB returns a file path). Authoritative when it yields an
   * index — those formats' hrefs (`filepos:`, `kindle:pos:`) carry no file
   * name to match against.
   */
  splitTOCHref?: (href: string) => unknown[] | null | undefined;
  /** A navigable href for a section, for formats whose hrefs are not file paths. */
  getSectionHref?: (index: number) => string | undefined;
};

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

function flattenNav(items: NavItemLike[] | undefined): NavItemLike[] {
  return (items ?? []).flatMap((item) => [
    item,
    ...flattenNav(item.subitems ?? undefined),
  ]);
}

/** The section a nav href points at, by the engine's own mapping when it has one. */
function sectionIndexOfHref(book: BookLike, href: string, sections: SectionLike[]): number {
  if (typeof book.splitTOCHref === "function") {
    let split: unknown[] | null | undefined;
    try {
      split = book.splitTOCHref(href);
    } catch {
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
function sectionIndexesCoveredByNav(
  book: BookLike,
  nav: NavItemLike[],
  sections: SectionLike[],
): Map<number, NavItemLike[]> {
  const covered = new Map<number, NavItemLike[]>();
  for (const item of nav) {
    if (!item.href) continue;
    const index = sectionIndexOfHref(book, item.href, sections);
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
export async function ensureUsableToc(book: unknown): Promise<boolean> {
  const target = book as BookLike;
  const sections = target.sections ?? [];
  const linearIndexes = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.linear !== "no" && typeof section.createDocument === "function")
    .map(({ index }) => index);
  if (linearIndexes.length < MIN_SECTIONS_TO_BOTHER) return false;
  if (linearIndexes.length > MAX_SYNTHESIZED_SECTIONS) return false;

  const flatNav = flattenNav(target.toc);
  const covered = sectionIndexesCoveredByNav(target, flatNav, sections);
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
    } catch {
      // An unparseable section contributes no entry; its text still reads fine.
    }
  }

  if (added === 0) return false;
  target.toc = synthesized;
  return true;
}
