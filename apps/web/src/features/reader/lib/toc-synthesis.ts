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

/** Map each nav entry (with an href) to the first section whose id matches its file. */
function sectionIndexesCoveredByNav(nav: NavItemLike[], sections: SectionLike[]): Map<number, NavItemLike[]> {
  const covered = new Map<number, NavItemLike[]>();
  for (const item of nav) {
    if (!item.href) continue;
    const file = fileOf(item.href);
    const index = sections.findIndex((section) => {
      if (section.id == null) return false;
      const sectionFile = fileOf(String(section.id));
      return sectionFile === file || sectionFile.endsWith(file) || file.endsWith(sectionFile);
    });
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
  const covered = sectionIndexesCoveredByNav(flatNav, sections);
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
    try {
      const doc = await section.createDocument!();
      const label = labelFromDocument(doc);
      if (!label || section.id == null) continue;
      synthesized.push({ label, href: String(section.id) });
      added++;
    } catch {
      // An unparseable section contributes no entry; its text still reads fine.
    }
  }

  if (added === 0) return false;
  target.toc = synthesized;
  return true;
}
