/**
 * Storage for annotations (highlights, notes, asks): the desktop SQLite
 * `annotations` table (Rust `annotation_*` commands; search is FTS5-backed).
 * Desktop-only — the browser build is a pure UI shell (Storybook feeds
 * components fixture props): reads come back empty so surfaces render their
 * empty states, writes throw instead of pretending to persist.
 */

import { invoke } from "../../../platform/ipc";
import { normalizeAnnotationPageQuery, type AnnotationPageQuery, type EventOrigin } from "@read-aware/core";
import type { Annotation, AnnotationFilters, Ask, Highlight, Note } from "./annotation-types";
import { isTauri } from "../../../platform/environment";
import { commitDomainEvents } from "../../../platform/domain-events";

function assertDesktop(what: string): never | void {
  if (!isTauri()) {
    throw new Error(`${what} is desktop-only — the browser build is a UI shell without storage.`);
  }
}

/** Filter + newest-first sort applied to the SQLite result set. */
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
// `saveAnnotation` is the raw upsert, kept for backup restore only: it writes a
// row the log never described, which genesis reconciliation covers at next
// boot. Every intent-level function below states its change as an event and
// lets `commitDomainEvents` append + apply it in one transaction, then reads
// the stored row back — the projection is derived, never written here.
export async function saveAnnotation(annotation: Annotation): Promise<Annotation> {
  assertDesktop("Saving an annotation");
  await invoke("annotation_put", { annotation });
  return annotation;
}

export async function getAnnotation(id: string): Promise<Annotation | null> {
  if (!isTauri()) return null;
  return (await invoke<Annotation | null>("annotation_get", { id })) ?? null;
}

export async function pageAnnotations(input?: AnnotationPageQuery): Promise<{ items: Annotation[]; nextCursor: string | null; consistency: "live" }> {
  const query = normalizeAnnotationPageQuery(input);
  assertDesktop("Paging annotations");
  return invoke("annotations_page", { input: query });
}

/** Read back a row the store just derived from an event. */
async function requireStored(id: string): Promise<Annotation> {
  const stored = await getAnnotation(id);
  if (!stored) throw new Error(`Annotation ${id} was not persisted`);
  return stored;
}

export async function listAnnotations(filters?: AnnotationFilters): Promise<Annotation[]> {
  if (!isTauri()) return [];
  const query = filters?.searchQuery?.trim();
  if (query) {
    // FTS5-backed (annotations_fts, CJK bigram segmentation — see storage.rs
    // migration v4): word/bigram matching with English prefix support, instead
    // of loading every annotation and substring-scanning.
    const matched = await invoke<Annotation[]>("annotations_search", {
      query,
      bookId: filters?.bookId ?? null,
      kind: filters?.type ?? null,
    });
    // Rust returns relevance (BM25) order; the annotation lists render
    // newest-first, so re-sort here (searchQuery already applied).
    return filterAndSortAnnotations(matched, {
      bookId: filters?.bookId,
      type: filters?.type,
    });
  }
  const all = await invoke<Annotation[]>("annotations_list", { bookId: filters?.bookId ?? null });
  return filterAndSortAnnotations(all, filters);
}

// Highlight operations
export async function createHighlight(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  color: Highlight["color"] = "yellow",
  style: NonNullable<Highlight["style"]> = "highlight",
  origin?: EventOrigin,
): Promise<Highlight> {
  const highlightId = crypto.randomUUID();
  await commitDomainEvents({
    type: "highlight.created",
    payload: {
      highlightId,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      text,
      color,
      style,
    },
    origin,
  });
  return requireStored(highlightId) as Promise<Highlight>;
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
  content: string,
  origin?: EventOrigin,
): Promise<Note> {
  const noteId = crypto.randomUUID();
  await commitDomainEvents({
    type: "note.created",
    payload: {
      noteId,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      quotedText: text || undefined,
      body: content,
    },
    origin,
  });
  return requireStored(noteId) as Promise<Note>;
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
  const askId = crypto.randomUUID();
  await commitDomainEvents({
    type: "ask.recorded",
    payload: {
      askId,
      bookId,
      anchor: cfiRange ?? undefined,
      chapterHref: chapterHref ?? undefined,
      text,
    },
    // Asks are the agent runtime's passive traces — never a direct user write.
    origin: "agent",
  });
  return requireStored(askId) as Promise<Ask>;
}
