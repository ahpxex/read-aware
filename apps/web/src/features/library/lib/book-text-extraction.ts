import { errorCode, type BookTextSnapshot } from "@read-aware/core";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { flattenToc } from "../../reader/lib/epub-utils";
import { sectionsComplete, snapshotFromText, type BookTextRecord, type ExtractedChapter } from "./book-text-record";

type ExtractionOptions = {
  bookId: string;
  contentVersion: string;
  prior: BookTextRecord | null;
  signal: AbortSignal;
  yieldToReader(): Promise<void>;
  save(record: BookTextRecord): Promise<void>;
  progress(snapshot: BookTextSnapshot): void;
  warn(message: string, error: unknown): void;
};

/** Section reads and checkpoints have independent outcomes. Only successful sections are reused. */
export async function extractBookText(book: FoliateBook, options: ExtractionOptions): Promise<BookTextRecord> {
  const { bookId, contentVersion, signal } = options;
  const sections = book.sections ?? [];
  const required = sections.flatMap((section, index) => section.linear === "no" ? [] : [index]);
  const prior = options.prior;
  const resume = prior && prior.bookId === bookId && prior.contentVersion === contentVersion
    && prior.sectionCount === sections.length && JSON.stringify(prior.required) === JSON.stringify(required);
  const pieces = new Map((resume ? prior.pieces : []).map(piece => [piece.sectionIndex, piece]));
  const failures = new Map<number, string>();
  const unsupported: number[] = [];
  let hasText = [...pieces.values()].some(piece => piece.text.length > 0);
  // Per-section observation stays constant-size; sort/copy the growing text only at checkpoints.
  const progress = () => options.progress({ bookId, contentVersion, status: "preparing", text: hasText ? "available" : "unknown",
    chapterCount: 0, progress: { total: required.length, completed: pieces.size, failed: failures.size, unsupported: unsupported.length },
    ...(failures.size ? { errorCode: failures.values().next().value } : {}) });
  const entries = flattenToc(book.toc ?? []);
  const owners: (number | undefined)[] = new Array(sections.length).fill(undefined);
  for (const [index, entry] of entries.entries()) {
    signal.throwIfAborted();
    try {
      const section = (await book.resolveHref?.(entry.href))?.index;
      if (typeof section === "number" && Number.isInteger(section) && section >= 0 && section < sections.length && owners[section] === undefined) owners[section] = index;
    } catch (error) { options.warn("TOC entry could not be assigned during text extraction", error); }
  }
  for (let i = 1; i < owners.length; i++) owners[i] ??= owners[i - 1];
  const record = (): BookTextRecord => ({ version: 5, bookId, contentVersion, extractedAt: new Date().toISOString(), finalized: false,
    sectionCount: sections.length, required, pieces: [...pieces.values()].sort((a, b) => a.sectionIndex - b.sectionIndex),
    failures: [...failures].map(([sectionIndex, code]) => ({ sectionIndex, code })), unsupported: [...unsupported], chapters: [] });
  let sinceSave = 0, consecutiveFailures = 0;
  progress();
  for (const index of required) {
    signal.throwIfAborted();
    if (pieces.has(index)) continue;
    const section = sections[index]!;
    if (typeof section.getText !== "function" && typeof section.createDocument !== "function") {
      unsupported.push(index); progress(); continue;
    }
    await options.yieldToReader(); signal.throwIfAborted();
    try {
      const raw = section.getText ? await section.getText() : (await section.createDocument!()).body?.textContent ?? "";
      signal.throwIfAborted();
      const text = raw.replace(/\s+/g, " ").trim();
      hasText ||= text.length > 0;
      pieces.set(index, { sectionIndex: index, ...(section.id == null ? {} : { href: String(section.id) }), text });
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
      signal.throwIfAborted(); await options.save(record()); sinceSave = 0;
    }
    if (consecutiveFailures >= 5) break;
  }
  signal.throwIfAborted();
  const result = record();
  // Partial chapters could renumber subsequent chapter references on retry.
  // Do not publish them into Agent/digest/index consumers before completion.
  if (sectionsComplete(result)) {
    result.chapters = mergeTextChapters(result, owners, entries,
      sections.some(section => typeof section.getText === "function"));
    result.finalized = true;
  }
  await options.save(result);
  signal.throwIfAborted(); options.progress(snapshotFromText(result));
  return result;
}

/** Retain the existing TOC/PDF grouping and minimum chapter policy; text presence is tracked separately. */
function mergeTextChapters(record: BookTextRecord, owners: (number | undefined)[],
  entries: ReturnType<typeof flattenToc>, pageText: boolean): ExtractedChapter[] {
  const chapters: ExtractedChapter[] = [];
  let current: { owner: number | undefined; title?: string; hrefs: string[]; texts: string[]; first: number; last: number; chars: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.texts.filter(Boolean).join(" ").trim();
    if (text.length >= 40) {
      const hrefs = [...new Set(current.hrefs)];
      const pages = current.first === current.last ? `Page ${current.first + 1}` : `Pages ${current.first + 1}-${current.last + 1}`;
      chapters.push({ title: current.title ?? (pageText ? pages : undefined), text, ...(hrefs.length ? { hrefs } : {}) });
    }
    current = null;
  };
  for (const piece of record.pieces) {
    const owner = owners[piece.sectionIndex];
    const merges = current && (owner !== undefined && owner === current.owner
      || pageText && owner === undefined && current.owner === undefined && current.texts.length < 8 && current.chars < 16_000);
    if (!merges) {
      flush();
      const entry: (typeof entries)[number] | undefined = owner === undefined ? undefined : entries[owner];
      current = { owner, title: entry?.label, hrefs: entry?.href ? [entry.href] : [], texts: [], first: piece.sectionIndex, last: piece.sectionIndex, chars: 0 };
    }
    if (piece.href) current!.hrefs.push(piece.href);
    current!.texts.push(piece.text); current!.last = piece.sectionIndex; current!.chars += piece.text.length;
  }
  flush(); return chapters;
}
