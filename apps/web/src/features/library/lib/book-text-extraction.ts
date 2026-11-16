import { AppError, buildChapterLayout, errorCode, type BookTextSnapshot } from "@read-aware/core";
import { detectPageHeadings } from "./page-headings";
import type { ChapterMap, FoliateBook } from "../../reader/lib/foliate-engine";
import { readerChapterBlock, readSectionBlocks } from "../../reader/lib/reader-document-layout";
import { collapseText, pageTextBlocks } from "./book-text-layout";
import { navigationFromOutlines, navigationState, readSectionOutline } from "../../reader";
import { buildChapterMap } from "../../../../foliate-js/src/chapter-map";
import type { ResolvedNavigation, TOCItem } from "../../../../foliate-js/src/book";
import {
  sectionsComplete,
  snapshotFromText,
  type BookTextRecord,
  type ExtractedChapter,
  type NavigationItem,
  type TextPiece,
} from "./book-text-record";

type ExtractionOptions = {
  bookId: string;
  contentVersion: string;
  prior: BookTextRecord | null;
  /** The book's chapter map (`chapterMapFor`): the reader's chapters are the text's chapters. */
  chapters: ChapterMap;
  signal: AbortSignal;
  yieldToReader(): Promise<void>;
  readSection?(read: () => Promise<string>): Promise<string>;
  save(record: BookTextRecord): Promise<void>;
  progress(snapshot: BookTextSnapshot): void;
  warn(message: string, error: unknown): void;
};

/** Section reads and checkpoints have independent outcomes. Only successful sections are reused. */
export async function extractBookText(book: FoliateBook, options: ExtractionOptions): Promise<BookTextRecord> {
  const { bookId, contentVersion, signal } = options;
  const sections = book.sections ?? [];
  const required = sections.flatMap((section, index) => (section.linear === "no" ? [] : [index]));
  const prior = options.prior;
  const navigation = navigationState(book);
  const deferredNavigation = navigation === "deferred";
  const resume =
    prior &&
    prior.bookId === bookId &&
    prior.contentVersion === contentVersion &&
    prior.sectionCount === sections.length &&
    JSON.stringify(prior.required) === JSON.stringify(required);
  const pieces = new Map((resume ? prior.pieces : []).map((piece) => [piece.sectionIndex, piece]));
  const failures = new Map<number, string>();
  const unsupported: number[] = [];
  let hasText = [...pieces.values()].some((piece) => piece.text.trim().length > 0);
  // Per-section observation stays constant-size; sort/copy the growing text only at checkpoints.
  const progress = () =>
    options.progress({
      bookId,
      contentVersion,
      status: "preparing",
      text: hasText ? "available" : "unknown",
      chapterCount: 0,
      progress: {
        total: required.length,
        completed: pieces.size,
        failed: failures.size,
        unsupported: unsupported.length,
      },
      ...(failures.size ? { errorCode: failures.values().next().value } : {}),
    });
  // Every TOC target becomes an anchor into the text; the chapter map's starts
  // cut it into chapters. Targets in skipped (non-linear) sections are dropped.
  const place = (index: number, href: string) => `${index}\n${href}`;
  const chapterTitles = new Map(
    options.chapters.chapters.map((chapter) => [place(chapter.target.index, chapter.href), chapter.title]),
  );
  const targets = new Map<number, { href: string; title?: string; start: boolean; target: ResolvedNavigation }[]>();
  for (const entry of options.chapters.entries) {
    if (!required.includes(entry.target.index)) continue;
    const key = place(entry.target.index, entry.href);
    const start = chapterTitles.has(key);
    const group = targets.get(entry.target.index) ?? [];
    group.push({
      href: entry.href,
      title: start ? chapterTitles.get(key) || undefined : undefined,
      start,
      target: entry.target,
    });
    targets.set(entry.target.index, group);
    // One TOC entry per place starts its chapter; a duplicate stays an anchor.
    chapterTitles.delete(key);
  }
  const record = (): BookTextRecord => ({
    version: 10,
    bookId,
    contentVersion,
    extractedAt: new Date().toISOString(),
    finalized: false,
    sectionCount: sections.length,
    required,
    pieces: [...pieces.values()].sort((a, b) => a.sectionIndex - b.sectionIndex),
    failures: [...failures].map(([sectionIndex, code]) => ({ sectionIndex, code })),
    unsupported: [...unsupported],
    chapters: [],
  });
  let sinceSave = 0,
    consecutiveFailures = 0;
  progress();
  for (const index of required) {
    signal.throwIfAborted();
    if (pieces.has(index)) continue;
    const section = sections[index]!;
    if (typeof section.getText !== "function" && typeof section.createDocument !== "function") {
      unsupported.push(index);
      progress();
      continue;
    }
    await options.yieldToReader();
    signal.throwIfAborted();
    try {
      const piece: TextPiece = {
        sectionIndex: index,
        ...(section.id == null ? {} : { href: String(section.id) }),
        text: "",
        starts: [],
        anchors: [],
        blocks: [],
      };
      const read = async () => {
        // Keep source text offsets until all anchor ranges have been sliced.
        // Normalizing first would move every boundary after whitespace runs.
        const doc = !section.getText && section.createDocument ? await section.createDocument() : undefined;
        const raw = doc?.body?.textContent ?? (section.getText ? await section.getText(signal) : "");
        if (doc?.body) {
          const { blocks, headings } = readSectionBlocks(doc.body);
          piece.blocks = blocks;
          if (headings.length) piece.headings = headings;
        } else piece.blocks = pageTextBlocks(raw);
        // Navigation left to this pass is rebuilt from the headings, once every section is read.
        if (doc && deferredNavigation) piece.outline = readSectionOutline(doc);
        for (const point of targets.get(index) ?? []) {
          let offset = 0;
          if (doc?.body) {
            const anchor = typeof point.target.anchor === "function" ? point.target.anchor(doc) : point.target.anchor;
            if (anchor == null && point.href.includes("#"))
              throw new AppError(
                "library/text-extraction-failed",
                "Chapter anchor is missing from its source document",
              );
            if (anchor && typeof anchor !== "number" && anchor !== doc.body && anchor !== doc.documentElement) {
              const node = "startContainer" in anchor ? anchor.startContainer : anchor;
              const block = point.start ? readerChapterBlock(node) : null;
              const before = doc.createRange();
              before.selectNodeContents(doc.body);
              if (block && block !== doc.body) before.setEndBefore(block);
              else if ("startContainer" in anchor) before.setEnd(anchor.startContainer, anchor.startOffset);
              else before.setEndBefore(anchor);
              offset = before.toString().length;
            }
          }
          const position = { offset, href: point.href };
          piece.anchors.push(position);
          if (point.start) piece.starts.push({ ...position, title: point.title });
        }
        return raw;
      };
      piece.text = options.readSection ? await options.readSection(read) : await read();
      signal.throwIfAborted();
      hasText ||= piece.text.trim().length > 0;
      pieces.set(index, piece);
      consecutiveFailures = 0;
    } catch (error) {
      signal.throwIfAborted();
      options.warn("Book text section failed", error);
      failures.set(index, errorCode(error) ?? "library/text-extraction-failed");
      consecutiveFailures++;
    }
    progress();
    sinceSave++;
    if (sinceSave >= Math.max(25, Math.floor(pieces.size / 20)) || consecutiveFailures >= 5) {
      signal.throwIfAborted();
      await options.save(record());
      sinceSave = 0;
    }
    if (consecutiveFailures >= 5) break;
  }
  signal.throwIfAborted();
  const result = record();
  // Partial chapters could renumber subsequent chapter references on retry.
  // Do not publish them into Agent/digest/index consumers before completion.
  if (sectionsComplete(result)) {
    const pageText = sections.some((section) => typeof section.getText === "function");
    // A paged book without an outline: recover one from its page headings.
    if (pageText && !options.chapters.entries.length) applyPageHeadings(result);
    else if (deferredNavigation) await applyRebuiltNavigation(book, result);
    // Navigation the opening repaired or rebuilt is kept for the next opening.
    else if (navigation !== "source" && book.toc?.length) result.outline = navigationItems(book.toc);
    signal.throwIfAborted();
    const language = book.metadata?.language;
    result.chapters = mergeTextChapters(result, pageText, Array.isArray(language) ? language[0] : language);
    result.finalized = true;
  }
  await options.save(result);
  signal.throwIfAborted();
  options.progress(snapshotFromText(result));
  return result;
}

/** The serializable part of a navigation tree. */
function navigationItems(items: readonly TOCItem[]): NavigationItem[] {
  return items.map((item) => ({
    label: item.label ?? "",
    href: item.href ?? "",
    ...(item.subitems?.length ? { subitems: navigationItems(item.subitems) } : {}),
  }));
}

/**
 * Navigation too large to rebuild as the book opened, rebuilt from the headings
 * collected while reading: chapters are re-cut by a chapter map of the rebuilt
 * navigation, anchored at the headings' recorded offsets, and the navigation is
 * kept for the next opening.
 */
async function applyRebuiltNavigation(book: FoliateBook, record: BookTextRecord): Promise<void> {
  const outlines = new Map(record.pieces.map((piece) => [piece.sectionIndex, piece.outline ?? null]));
  const toc = await navigationFromOutlines(book, outlines);
  if (!toc || !book.resolveHref) return;
  const map = await buildChapterMap({ toc, sections: book.sections, resolveHref: book.resolveHref.bind(book) });
  const pieces = new Map(record.pieces.map((piece) => [piece.sectionIndex, piece]));
  for (const piece of record.pieces) {
    piece.starts = [];
    piece.anchors = [];
  }
  const place = (index: number, href: string) => `${index}\n${href}`;
  const titles = new Map(map.chapters.map((chapter) => [place(chapter.target.index, chapter.href), chapter.title]));
  for (const entry of map.entries) {
    const piece = pieces.get(entry.target.index);
    if (!piece) continue;
    const id = entry.href.includes("#") ? entry.href.slice(entry.href.indexOf("#") + 1) : null;
    const offset = (id && piece.outline?.headings.find((heading) => heading.id === id)?.offset) || 0;
    piece.anchors.push({ offset, href: entry.href });
    const key = place(entry.target.index, entry.href);
    if (titles.has(key)) {
      piece.starts.push({ offset, href: entry.href, title: titles.get(key) || undefined });
      titles.delete(key);
    }
  }
  record.outline = navigationItems(toc);
}

/** Chapter starts and a navigable outline from headings found on the pages. PDF hrefs are
 * explicit destinations: `[pageIndex]`. */
function applyPageHeadings(record: BookTextRecord): void {
  const pages: string[] = Array.from({ length: record.sectionCount }, () => "");
  for (const piece of record.pieces) pages[piece.sectionIndex] = piece.text;
  const headings = detectPageHeadings(pages);
  if (!headings.length) return;
  const pieces = new Map(record.pieces.map((piece) => [piece.sectionIndex, piece]));
  record.outline = [];
  for (const { page, offset, label } of headings) {
    const piece = pieces.get(page);
    if (!piece) continue;
    const href = JSON.stringify([page]);
    piece.starts.push({ offset, href, title: label });
    piece.anchors.push({ offset, href });
    record.outline.push({ label, href });
  }
}

/** Logical chapters follow the chapter map's starts across spine files. A spine
 * boundary is never a chapter boundary when a navigable TOC exists. Each chapter
 * keeps the section slices it was built from and the layout of its text: a
 * block begins wherever a section's block does, and wherever a slice does. */
function mergeTextChapters(record: BookTextRecord, pageText: boolean, locale?: string): ExtractedChapter[] {
  const chapters: ExtractedChapter[] = [];
  const hasToc = record.pieces.some((piece) => piece.starts.length > 0);
  type Slice = { piece: TextPiece; start: number; end: number };
  let current: { title?: string; hrefs: string[]; slices: Slice[]; first: number; last: number; chars: number } | null =
    null;
  const flush = () => {
    if (!current) return;
    // Where each slice begins in the joined text, then its blocks and headings there.
    let joined = "";
    const bases = current.slices.map((slice) => {
      const base = joined.length ? joined.length + 1 : 0;
      joined += (joined.length ? " " : "") + slice.piece.text.slice(slice.start, slice.end);
      return base;
    });
    const within = (slice: Slice, offset: number) => offset >= slice.start && offset < slice.end;
    const blockMarks = current.slices.flatMap((slice, index) => [
      bases[index]!,
      ...slice.piece.blocks
        .filter((offset) => within(slice, offset))
        .map((offset) => bases[index]! + offset - slice.start),
    ]);
    const headingMarks = current.slices.flatMap((slice, index) =>
      (slice.piece.headings ?? [])
        .filter((heading) => within(slice, heading.offset))
        .map((heading) => ({ mark: bases[index]! + heading.offset - slice.start, level: heading.level })),
    );
    const { text, at } = collapseText(joined, [
      ...bases,
      ...blockMarks,
      ...headingMarks.map((heading) => heading.mark),
    ]);
    // Preserve short titled sections too: silently dropping them renumbers the TOC.
    if (text && (hasToc || text.length >= 40)) {
      const pages =
        current.first === current.last ? `Page ${current.first + 1}` : `Pages ${current.first + 1}-${current.last + 1}`;
      const blocksFrom = bases.length;
      const headingsFrom = blocksFrom + blockMarks.length;
      chapters.push({
        title: current.title ?? (pageText ? pages : undefined),
        text,
        hrefs: [...new Set(current.hrefs)],
        layout: buildChapterLayout(text, at.slice(blocksFrom, headingsFrom), {
          unit: pageText ? "page" : "paragraph",
          headings: headingMarks.map((heading, index) => ({ offset: at[headingsFrom + index]!, level: heading.level })),
          locale,
        }),
        sources: current.slices.map((slice, index) => ({
          sectionIndex: slice.piece.sectionIndex,
          start: slice.start,
          end: slice.end,
          at: at[index]!,
        })),
      });
    }
    current = null;
  };
  for (const piece of record.pieces) {
    if (!hasToc && current && (!pageText || current.last - current.first >= 7 || current.chars >= 16_000)) flush();
    const starts = [...piece.starts].sort((a, b) => a.offset - b.offset);
    const offsets = [...new Set([0, ...starts.map((start) => start.offset)])];
    for (const [position, offset] of offsets.entries()) {
      const end = offsets[position + 1] ?? piece.text.length;
      const start = starts.find((start) => start.offset === offset);
      if (start) flush();
      current ??= {
        title: start?.title,
        hrefs: start ? [start.href] : [],
        slices: [],
        first: piece.sectionIndex,
        last: piece.sectionIndex,
        chars: 0,
      };
      if (offset === 0 && piece.href) current.hrefs.push(piece.href);
      current.hrefs.push(
        ...piece.anchors
          .filter(
            (anchor) =>
              anchor.offset >= offset &&
              (anchor.offset < end || (position === offsets.length - 1 && anchor.offset === end)),
          )
          .map((anchor) => anchor.href),
      );
      current.slices.push({ piece, start: offset, end });
      current.last = piece.sectionIndex;
      current.chars += end - offset;
    }
  }
  flush();
  return chapters;
}
