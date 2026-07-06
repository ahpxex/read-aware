/**
 * Storage for annotations (highlights, notes).
 *
 * Resolves by `isTauri()`: desktop → native SQLite (Rust `annotation_*`
 * commands); browser (vite dev / Storybook) → the existing IndexedDB code, kept
 * byte-for-byte.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Annotation, AnnotationFilters, Ask, Highlight, Note } from "./annotation-types";
import { isTauri } from "../../../platform/environment";
import { emitDomainEvents } from "../../../platform/domain-events";

const DB_NAME = "read-aware-annotations";
const DB_VERSION = 1;
const ANNOTATIONS_STORE = "annotations";

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openAnnotationsDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        const store = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: "id" });
        store.createIndex("bookId", "bookId", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("bookId_type", ["bookId", "type"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open the annotations database."));
  });

  return dbPromise;
}

/** Filter + newest-first sort applied to the SQLite result set (desktop path). */
function filterAndSortAnnotations(
  annotations: Annotation[],
  filters?: AnnotationFilters,
): Annotation[] {
  let result = annotations;
  if (filters?.bookId) result = result.filter((a) => a.bookId === filters.bookId);
  if (filters?.type) result = result.filter((a) => a.type === filters.type);
  if (filters?.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    result = result.filter(
      (a) =>
        a.text.toLowerCase().includes(query) ||
        ("content" in a && a.content?.toLowerCase().includes(query)),
    );
  }
  return [...result].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// Generic annotation operations.
//
// `saveAnnotation` is the raw upsert (also used by backup restore, which emits
// no events — genesis reconciliation covers restored rows at next boot). The
// intent-level functions below (`createHighlight`, `recolorHighlight`,
// `createNote`, `updateNote`, `createAsk`, `deleteAnnotation`) are the seams
// that dual-write the domain-event log; new call sites should use those.
export async function saveAnnotation(annotation: Annotation): Promise<Annotation> {
  if (isTauri()) {
    await invoke("annotation_put", { annotation });
    return annotation;
  }
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readwrite");
  transaction.objectStore(ANNOTATIONS_STORE).put(annotation);
  await waitForTransaction(transaction);
  return annotation;
}

export async function getAnnotation(id: string): Promise<Annotation | null> {
  if (isTauri()) {
    return (await invoke<Annotation | null>("annotation_get", { id })) ?? null;
  }
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readonly");
  const result = await requestToPromise(
    transaction.objectStore(ANNOTATIONS_STORE).get(id) as IDBRequest<Annotation | undefined>,
  );
  await waitForTransaction(transaction);
  return result ?? null;
}

export async function deleteAnnotation(id: string): Promise<void> {
  // Read-before-delete so the removal event carries the right variant.
  const existing = await getAnnotation(id);
  if (existing?.type === "highlight") {
    emitDomainEvents({ type: "highlight.removed", payload: { highlightId: id } });
  } else if (existing?.type === "note") {
    emitDomainEvents({ type: "note.removed", payload: { noteId: id } });
  } else if (existing?.type === "ask") {
    emitDomainEvents({ type: "ask.removed", payload: { askId: id } });
  }
  if (isTauri()) {
    await invoke("annotation_delete", { id });
    return;
  }
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readwrite");
  transaction.objectStore(ANNOTATIONS_STORE).delete(id);
  await waitForTransaction(transaction);
}

export async function listAnnotations(filters?: AnnotationFilters): Promise<Annotation[]> {
  if (isTauri()) {
    const all = await invoke<Annotation[]>("annotations_list");
    return filterAndSortAnnotations(all, filters);
  }

  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readonly");
  const store = transaction.objectStore(ANNOTATIONS_STORE);

  let annotations: Annotation[];

  if (filters?.bookId && filters?.type) {
    const index = store.index("bookId_type");
    annotations = await requestToPromise(index.getAll([filters.bookId, filters.type]) as IDBRequest<Annotation[]>);
  } else if (filters?.bookId) {
    const index = store.index("bookId");
    annotations = await requestToPromise(index.getAll(filters.bookId) as IDBRequest<Annotation[]>);
  } else if (filters?.type) {
    const index = store.index("type");
    annotations = await requestToPromise(index.getAll(filters.type) as IDBRequest<Annotation[]>);
  } else {
    annotations = await requestToPromise(store.getAll() as IDBRequest<Annotation[]>);
  }

  await waitForTransaction(transaction);

  // Apply search filter in memory
  if (filters?.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    annotations = annotations.filter((a) =>
      a.text.toLowerCase().includes(query) ||
      ("content" in a && a.content?.toLowerCase().includes(query))
    );
  }

  // Sort by creation time, newest first
  return annotations.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Highlight operations
export async function createHighlight(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  color: Highlight["color"] = "yellow",
  style: NonNullable<Highlight["style"]> = "highlight"
): Promise<Highlight> {
  const now = new Date().toISOString();
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    bookId,
    type: "highlight",
    cfiRange,
    chapterHref,
    text,
    color,
    style,
    createdAt: now,
    updatedAt: now,
  };
  emitDomainEvents({
    type: "highlight.created",
    payload: {
      highlightId: highlight.id,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      text,
      color,
      style,
    },
  });
  return saveAnnotation(highlight) as Promise<Highlight>;
}

/** Recolor / restyle an existing highlight (the reader's mark menu). */
export async function recolorHighlight(
  highlight: Highlight,
  color: Highlight["color"],
): Promise<Highlight> {
  const updated: Highlight = {
    ...highlight,
    color,
    updatedAt: new Date().toISOString(),
  };
  emitDomainEvents({
    type: "highlight.recolored",
    payload: { highlightId: highlight.id, color, style: highlight.style },
  });
  return saveAnnotation(updated) as Promise<Highlight>;
}

export async function listHighlights(bookId?: string): Promise<Highlight[]> {
  const annotations = await listAnnotations({ bookId, type: "highlight" });
  return annotations as Highlight[];
}

// Note operations
export async function createNote(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  content: string
): Promise<Note> {
  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    bookId,
    type: "note",
    cfiRange,
    chapterHref,
    text,
    content,
    createdAt: now,
    updatedAt: now,
  };
  emitDomainEvents({
    type: "note.created",
    payload: {
      noteId: note.id,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      quotedText: text || undefined,
      body: content,
    },
  });
  return saveAnnotation(note) as Promise<Note>;
}

export async function updateNote(id: string, content: string): Promise<Note | null> {
  const note = await getAnnotation(id);
  if (!note || note.type !== "note") return null;

  const updated: Note = {
    ...note,
    content,
    updatedAt: new Date().toISOString(),
  };
  emitDomainEvents({ type: "note.updated", payload: { noteId: id, body: content } });
  return saveAnnotation(updated) as Promise<Note>;
}

export async function listNotes(bookId?: string): Promise<Note[]> {
  const annotations = await listAnnotations({ bookId, type: "note" });
  return annotations as Note[];
}

// Ask operations (passive traces of the book thread; written by the agent runtime)
export async function createAsk(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
): Promise<Ask> {
  const now = new Date().toISOString();
  const ask: Ask = {
    id: crypto.randomUUID(),
    bookId,
    type: "ask",
    cfiRange,
    chapterHref,
    text,
    createdAt: now,
    updatedAt: now,
  };
  emitDomainEvents({
    type: "ask.recorded",
    payload: {
      askId: ask.id,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      text,
    },
  });
  return saveAnnotation(ask) as Promise<Ask>;
}
