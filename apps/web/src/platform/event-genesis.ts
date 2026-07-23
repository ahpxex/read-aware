/**
 * Genesis reconciliation: give pre-event-era data a history.
 *
 * The projections (books/collections/annotations) predate the event-sourced
 * write path, so rows can exist that no event ever created — data the sync
 * layer could never replicate. On every desktop boot this pass diffs the
 * projections against the log's covered aggregate ids and synthesizes the
 * missing CREATION events (current state as genesis; historical mutations are
 * gone and stay gone).
 *
 * Running every boot (instead of once behind a flag) makes it a self-healing
 * invariant: a v1 backup restored next year, or a UX write whose best-effort
 * event append failed, is picked up on the next launch. Cost is one indexed
 * id query plus the projection loads, per boot.
 *
 * Synthesized envelopes carry the row's historical timestamp in `createdAt`
 * (display/audit) while their HLC is stamped at synthesis time — reusing
 * historical millis for the HLC could collide with stamps already handed out
 * (see the envelope contract in @read-aware/core events.ts).
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  BookFormat,
  DictionaryEntrySnapshot,
  HighlightColor,
  HighlightStyle,
  ReadingStatus,
} from "@read-aware/core";
import { isTauri } from "./environment";
import { localKV } from "./local-store";
import {
  appendDomainEvents,
  listEventAggregateIds,
  type DomainEventDraft,
} from "./domain-events";

/** Event types whose presence marks an aggregate as already having a genesis. */
const CREATION_TYPES = [
  "book.imported",
  "collection.created",
  "highlight.created",
  "note.created",
  "ask.recorded",
  "vocabulary.added",
] as const;

// Raw wire shapes of the Rust projection commands (subset of fields used here).
type BookRow = {
  id: string;
  title: string;
  author: string;
  format: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  readingStatus: string;
  progress: {
    currentLocation: number;
    totalLocations: number;
    progressPercent: number;
    cfi: string | null;
    href: string | null;
  } | null;
  starred?: boolean;
  collectionId?: string | null;
};
type CollectionRow = { id: string; name: string; createdAt: string };
/**
 * Interim vocabulary-notebook item (localKV `read-aware-vocabulary`), read
 * directly here — platform code must not import feature libs, and genesis
 * already reads the other projections at the wire level.
 */
type VocabularyRow = {
  id: string;
  term: string;
  language: string;
  entry: DictionaryEntrySnapshot;
  context?: string;
  bookId?: string;
  bookTitle?: string;
  addedAt: number;
};

function readVocabularyRows(): VocabularyRow[] {
  try {
    const raw = localKV.getItem("read-aware-vocabulary");
    const items = raw ? (JSON.parse(raw) as VocabularyRow[]) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
type AnnotationRow = {
  id: string;
  bookId: string;
  type: string;
  cfiRange: string | null;
  chapterHref: string | null;
  text: string;
  color?: string;
  style?: string;
  content?: string;
  createdAt: string;
};

const byCreatedAt = <T extends { createdAt: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

function bookDrafts(book: BookRow): DomainEventDraft[] {
  const drafts: DomainEventDraft[] = [
    {
      type: "book.imported",
      createdAt: book.createdAt,
      payload: {
        bookId: book.id,
        title: book.title,
        author: book.author,
        format: book.format as BookFormat,
        fileName: book.fileName,
        mimeType: book.mimeType || undefined,
        fileSize: book.fileSize,
        sourceBlobKey: `bookfile:${book.id}`,
        // sourceSha256 omitted: the interim import path never recorded one.
        // The blob registry has the hash; a future consolidation can join it in.
      },
    },
  ];
  if (book.collectionId) {
    drafts.push({
      type: "book.addedToCollection",
      createdAt: book.updatedAt,
      payload: { bookId: book.id, collectionId: book.collectionId },
    });
  }
  if (book.progress) {
    drafts.push({
      type: "reading.progressed",
      createdAt: book.updatedAt,
      payload: {
        bookId: book.id,
        locator: book.progress.cfi ?? book.progress.href ?? "",
        chapterHref: book.progress.href ?? undefined,
        currentLocation: book.progress.currentLocation,
        totalLocations: book.progress.totalLocations,
        progressPercent: book.progressPercent,
        status: book.readingStatus as ReadingStatus,
      },
    });
  }
  if (book.starred) {
    drafts.push({
      type: "book.starred",
      createdAt: book.updatedAt,
      payload: { bookId: book.id, starred: true },
    });
  }
  return drafts;
}

function annotationDraft(annotation: AnnotationRow): DomainEventDraft | null {
  const base = {
    bookId: annotation.bookId,
    anchor: annotation.cfiRange ?? undefined,
    chapterHref: annotation.chapterHref ?? undefined,
  };
  switch (annotation.type) {
    case "highlight":
      return {
        type: "highlight.created",
        createdAt: annotation.createdAt,
        payload: {
          highlightId: annotation.id,
          ...base,
          text: annotation.text,
          color: annotation.color as HighlightColor | undefined,
          style: annotation.style as HighlightStyle | undefined,
        },
      };
    case "note":
      return {
        type: "note.created",
        createdAt: annotation.createdAt,
        payload: {
          noteId: annotation.id,
          ...base,
          quotedText: annotation.text || undefined,
          body: annotation.content ?? "",
        },
      };
    case "ask":
      return {
        type: "ask.recorded",
        createdAt: annotation.createdAt,
        payload: { askId: annotation.id, ...base, text: annotation.text },
      };
    default:
      return null;
  }
}

/**
 * Synthesize creation events for projection rows the log has never seen.
 * Idempotent (covered aggregates are skipped) and safe to fire-and-forget at
 * boot; a failure just retries next launch.
 */
export async function reconcileGenesisEvents(): Promise<void> {
  if (!isTauri()) return;
  const covered = await listEventAggregateIds([...CREATION_TYPES]);
  const [books, collections, annotations] = await Promise.all([
    invoke<BookRow[]>("library_load"),
    invoke<CollectionRow[]>("library_list_collections"),
    invoke<AnnotationRow[]>("annotations_list"),
  ]);

  // Creation order: collections before the books that reference them, books
  // before their annotations. Within a group, oldest first for a tidy log.
  const drafts: DomainEventDraft[] = [];
  for (const collection of byCreatedAt(collections)) {
    if (covered.has(collection.id)) continue;
    drafts.push({
      type: "collection.created",
      createdAt: collection.createdAt,
      payload: { collectionId: collection.id, name: collection.name },
    });
  }
  for (const book of byCreatedAt(books)) {
    if (covered.has(book.id)) continue;
    drafts.push(...bookDrafts(book));
  }
  for (const annotation of byCreatedAt(annotations)) {
    if (covered.has(annotation.id)) continue;
    const draft = annotationDraft(annotation);
    if (draft) drafts.push(draft);
  }
  for (const item of [...readVocabularyRows()].sort((a, b) => a.addedAt - b.addedAt)) {
    if (covered.has(item.id)) continue;
    drafts.push({
      type: "vocabulary.added",
      createdAt: new Date(item.addedAt).toISOString(),
      payload: {
        entryId: item.id,
        term: item.term,
        language: item.language,
        entry: item.entry,
        context: item.context,
        bookId: item.bookId,
        bookTitle: item.bookTitle,
      },
    });
  }

  if (drafts.length === 0) return;
  await appendDomainEvents(drafts);
  console.info(`[event-genesis] backfilled ${drafts.length} events for pre-event-era rows`);
}
