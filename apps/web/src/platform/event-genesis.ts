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
import { getVocabularyRows } from "./interim-projections";
import {
  appendDomainEvents,
  listEventAggregateIds,
  type DomainEventDraft,
} from "./domain-events";

/**
 * Event types whose presence marks an aggregate as already having a genesis.
 * Conversations and memories keep SEPARATE covered sets: a book thread's
 * conversationId IS the bookId, so a merged set would mistake every book
 * conversation for covered the moment `book.imported` exists.
 */
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
 * Vocabulary rows come from the boot-hydrated SQLite snapshot
 * (interim-projections — hydrated before genesis runs).
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
  const rows: VocabularyRow[] = [];
  for (const row of getVocabularyRows()) {
    try {
      const entry = JSON.parse(row.entryJson) as DictionaryEntrySnapshot | null;
      if (!entry) continue;
      rows.push({
        id: row.id,
        term: row.term,
        language: row.language,
        entry,
        context: row.context,
        bookId: row.bookId,
        bookTitle: row.bookTitle,
        addedAt: Date.parse(row.addedAt),
      });
    } catch {
      // Unparseable snapshot — skip; the projection row stays visible in-app.
    }
  }
  return rows;
}

/** Wire shape of the SQLite `ai_messages` rows (camelCase serde). */
type AiMessageRow = {
  id: string;
  conversationId: string;
  role: string;
  seq: number;
  content: string;
  createdAt: string;
  attachmentsJson?: string;
  error?: string;
};

/**
 * Global-thread id shape — mirrors the chat feature's `isGlobalThreadId`
 * (conversation-store.ts); duplicated here because platform code must not
 * import feature libs.
 */
const isGlobalThreadId = (id: string): boolean =>
  id === "__global__" || id.startsWith("thread-");

function conversationDrafts(conversationId: string, rows: AiMessageRow[]): DomainEventDraft[] {
  const messages = [...rows].filter((row) => !row.error).sort((a, b) => a.seq - b.seq);
  if (messages.length === 0) return [];
  const drafts: DomainEventDraft[] = [
    {
      type: "aiConversation.started",
      createdAt: messages[0].createdAt,
      payload: {
        conversationId,
        bookId: isGlobalThreadId(conversationId) ? undefined : conversationId,
      },
    },
  ];
  for (const row of messages) {
    let attachments: { text: string; cfiRange?: string | null; chapterHref?: string | null }[] = [];
    try {
      attachments = row.attachmentsJson ? JSON.parse(row.attachmentsJson) : [];
    } catch {
      attachments = [];
    }
    drafts.push({
      type: "aiMessage.appended",
      createdAt: row.createdAt,
      payload: {
        messageId: row.id,
        conversationId,
        role: row.role === "assistant" ? "assistant" : "user",
        seq: row.seq,
        content: row.content,
        attachments:
          attachments.length > 0
            ? attachments.map((attachment) => ({
                attachmentId: crypto.randomUUID(),
                kind: "selection" as const,
                text: attachment.text,
                anchor: attachment.cfiRange ?? undefined,
                chapterHref: attachment.chapterHref ?? undefined,
              }))
            : undefined,
      },
      origin: row.role === "assistant" ? "agent" : "user",
    });
  }
  return drafts;
}

/** Wire shape of the SQLite `memories` rows (camelCase serde). */
type MemoryRow = {
  id: string;
  scope: string;
  kind: string;
  content: string;
  importance: number;
  evidenceCount: number;
  pinned: boolean;
  status: string;
  createdAt?: string;
  updatedAt: string;
};

function memoryDrafts(memory: MemoryRow): DomainEventDraft[] {
  const bookScoped = memory.scope.startsWith("book:");
  const drafts: DomainEventDraft[] = [
    {
      type: "memory.promoted",
      createdAt: memory.createdAt ?? memory.updatedAt,
      payload: {
        memoryId: memory.id,
        kind: memory.kind,
        scope: bookScoped
          ? "book"
          : ((memory.scope === "global" ? "global" : "user") as "global" | "user"),
        bookId: bookScoped ? memory.scope.slice("book:".length) : undefined,
        content: memory.content,
        importance: memory.importance,
      },
      origin: "agent",
    },
  ];
  if (memory.status === "superseded") {
    drafts.push({
      type: "memory.superseded",
      createdAt: memory.updatedAt,
      payload: { memoryId: memory.id },
      origin: "agent",
    });
  } else if (memory.status === "forgotten") {
    drafts.push({
      type: "memory.forgotten",
      createdAt: memory.updatedAt,
      payload: { memoryId: memory.id, reason: "decay" },
      origin: "agent",
    });
  }
  if (memory.pinned) {
    drafts.push({
      type: "memory.feedback",
      createdAt: memory.updatedAt,
      payload: { memoryId: memory.id, signal: "pin" },
    });
  }
  return drafts;
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
  const [covered, coveredConversations, coveredMemories] = await Promise.all([
    listEventAggregateIds([...CREATION_TYPES]),
    listEventAggregateIds(["aiConversation.started"]),
    listEventAggregateIds(["memory.promoted"]),
  ]);
  const [books, collections, annotations, chatRows, memories] = await Promise.all([
    invoke<BookRow[]>("library_load"),
    invoke<CollectionRow[]>("library_list_collections"),
    invoke<AnnotationRow[]>("annotations_list"),
    invoke<AiMessageRow[]>("ai_chat_load_all"),
    invoke<MemoryRow[]>("memories_list_all"),
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
  const byConversation = new Map<string, AiMessageRow[]>();
  for (const row of chatRows) {
    const list = byConversation.get(row.conversationId);
    if (list) list.push(row);
    else byConversation.set(row.conversationId, [row]);
  }
  for (const [conversationId, rows] of byConversation) {
    if (coveredConversations.has(conversationId)) continue;
    drafts.push(...conversationDrafts(conversationId, rows));
  }
  for (const memory of memories) {
    if (coveredMemories.has(memory.id)) continue;
    drafts.push(...memoryDrafts(memory));
  }

  if (drafts.length === 0) return;
  await appendDomainEvents(drafts);
  console.info(`[event-genesis] backfilled ${drafts.length} events for pre-event-era rows`);
}
