/**
 * Annotations domain — highlights, notes, and asks over annotation-db.
 * Commands enforce the verb's invariants once, for every actor: kind checks
 * before mutation, list invalidation after, origin threading throughout.
 * `createAsk` is actor-guarded: asks are the agent runtime's passive traces,
 * so only the "agent" origin may record them.
 */
import { getDefaultStore } from "jotai";
import { AppError } from "@read-aware/core";
import type {
  AnnotationItem,
  AnnotationSnapshot,
  AnnotationMutation,
  AnnotationCommitResult,
  AnnotationPage,
  AnnotationPageQuery,
  AnnotationObservation,
  AnnotationObservationQuery,
  AskItem,
  EventOrigin,
  HighlightColor,
  HighlightItem,
  HighlightStyle,
  NoteItem,
} from "@read-aware/core";
import {
  createAsk,
  createHighlight,
  createNote,
  deleteAnnotation,
  getAnnotation,
  listAnnotations,
  pageAnnotations,
  recolorHighlight,
  updateNote,
} from "../features/annotations/lib/annotation-db";
import type { Annotation } from "../features/annotations/lib/annotation-types";
import { inspectAnnotation, commitAnnotationMutations } from "../features/annotations/lib/annotation-mutations";
import { annotationsRevisionAtom } from "../features/annotations/state/annotations-revision";
import { ANNOTATION_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";
import { AnnotationObserver } from "./annotation-observer";
import { createLogger } from "../platform/logger";

const log = createLogger("annotation-observation");
const observer = new AnnotationObserver({
  schedule: work => { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report: error => log.warn("Annotation observation failed", error),
});

export function toAnnotationItem(annotation: Annotation): AnnotationItem {
  const anchor = annotation.cfiRange ?? undefined;
  const chapterHref = annotation.chapterHref ?? undefined;
  if (annotation.type === "highlight") {
    return {
      kind: "highlight",
      id: annotation.id,
      bookId: annotation.bookId,
      text: annotation.text,
      anchor,
      chapterHref,
      color: annotation.color ?? "yellow",
      style: annotation.style ?? "highlight",
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  if (annotation.type === "note") {
    return {
      kind: "note",
      id: annotation.id,
      bookId: annotation.bookId,
      quotedText: annotation.text || undefined,
      body: annotation.content ?? "",
      anchor,
      chapterHref,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  return {
    kind: "ask",
    id: annotation.id,
    bookId: annotation.bookId,
    text: annotation.text,
    anchor,
    chapterHref,
    createdAt: annotation.createdAt,
  };
}

/** Reader/context annotation lists re-read on this revision counter. */
function bumpAnnotationsRevision(): void {
  const store = getDefaultStore();
  store.set(annotationsRevisionAtom, store.get(annotationsRevisionAtom) + 1);
}

export type AnnotationQueries = {
  inspect(annotationId: string): Promise<AnnotationSnapshot | null>;
  page(input?: AnnotationPageQuery): Promise<AnnotationPage>;
  /** Missing IDs return null; storage failures remain failures. */
  get(annotationId: string): Promise<AnnotationItem | null>;
  list(filter?: {
    bookId?: string;
    kind?: "highlight" | "note" | "ask";
    query?: string;
  }): Promise<AnnotationItem[]>;
};

export type AnnotationCommands = {
  applyChanges(changes: AnnotationMutation[], signal?: AbortSignal): Promise<AnnotationCommitResult>;
  createHighlight(input: {
    bookId: string;
    text: string;
    anchor?: string | null;
    chapterHref?: string | null;
    color?: HighlightColor;
    style?: HighlightStyle;
  }): Promise<HighlightItem>;
  recolorHighlight(highlightId: string, color: HighlightColor): Promise<void>;
  removeHighlight(highlightId: string): Promise<void>;
  createNote(input: {
    bookId: string;
    body: string;
    quotedText?: string;
    anchor?: string | null;
    chapterHref?: string | null;
  }): Promise<NoteItem>;
  updateNote(noteId: string, body: string): Promise<void>;
  removeNote(noteId: string): Promise<void>;
  /** Agent-only verb: record a passive trace of a book-thread question. */
  createAsk(input: {
    bookId: string;
    text: string;
    anchor?: string | null;
    chapterHref?: string | null;
  }): Promise<AskItem>;
  /**
   * Remove an ask trace. Any actor may erase (the user owns their traces);
   * only the agent may record.
   */
  removeAsk(askId: string): Promise<void>;
};

export type AnnotationsDomain = {
  queries: AnnotationQueries;
  commands: AnnotationCommands;
  events: {
    subscribe: DomainEventSubscribe<(typeof ANNOTATION_EVENTS)[number]>;
    observe(query: AnnotationObservationQuery, handler: (event: AnnotationObservation) => unknown): () => void;
  };
};

export function createAnnotationsDomain(origin: EventOrigin, lifetime?: AbortSignal): AnnotationsDomain {
  const annotationId = (id: string) => {
    if (typeof id !== "string" || !id.trim()) throw new AppError("annotations/invalid-input", "A non-empty annotation ID is required");
    return id;
  };
  const requireHighlight = async (id: string) => {
    const existing = await getAnnotation(annotationId(id));
    if (!existing || existing.type !== "highlight") {
      throw new AppError("annotations/not-found", `highlight not found: ${id}`);
    }
    return existing;
  };
  const requireNote = async (id: string) => {
    const existing = await getAnnotation(annotationId(id));
    if (!existing || existing.type !== "note") {
      throw new AppError("annotations/not-found", `note not found: ${id}`);
    }
    return existing;
  };

  const queries: AnnotationQueries = {
    inspect: async (id) => {
      const snapshot = await inspectAnnotation(id);
      return snapshot ? { ...snapshot, annotation: toAnnotationItem(snapshot.annotation) } : null;
    },
    page: async (input) => {
      const page = await pageAnnotations(input);
      return { ...page, items: page.items.map(toAnnotationItem) };
    },
    get: async (id) => {
      const annotation = await getAnnotation(annotationId(id));
      return annotation ? toAnnotationItem(annotation) : null;
    },
    list: async (filter) =>
      (
        await listAnnotations({
          bookId: filter?.bookId ? String(filter.bookId) : undefined,
          type: filter?.kind,
          searchQuery: filter?.query,
        })
      ).map(toAnnotationItem),
  };

  const commands: AnnotationCommands = {
    applyChanges: async (changes, signal) => {
      const result = await commitAnnotationMutations(changes, origin, signal);
      bumpAnnotationsRevision();
      return result;
    },
    createHighlight: async (input) => {
      if (input.style !== undefined && input.style !== "highlight" && input.style !== "underline") {
        throw new AppError("annotations/invalid-input", "Unknown highlight style");
      }
      const highlight = await createHighlight(
        String(input.bookId),
        input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.text),
        input.color ?? "yellow",
        input.style ?? "highlight",
        origin,
      );
      bumpAnnotationsRevision();
      return toAnnotationItem(highlight) as HighlightItem;
    },
    recolorHighlight: async (highlightId, color) => {
      const existing = await requireHighlight(highlightId);
      await recolorHighlight(existing, color, origin);
      bumpAnnotationsRevision();
    },
    removeHighlight: async (highlightId) => {
      await requireHighlight(highlightId);
      await deleteAnnotation(String(highlightId), origin);
      bumpAnnotationsRevision();
    },
    createNote: async (input) => {
      const note = await createNote(
        String(input.bookId),
        input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.quotedText ?? ""),
        String(input.body),
        origin,
      );
      bumpAnnotationsRevision();
      return toAnnotationItem(note) as NoteItem;
    },
    updateNote: async (noteId, body) => {
      await requireNote(noteId);
      await updateNote(String(noteId), String(body), origin);
      bumpAnnotationsRevision();
    },
    removeNote: async (noteId) => {
      await requireNote(noteId);
      await deleteAnnotation(String(noteId), origin);
      bumpAnnotationsRevision();
    },
    createAsk: async (input) => {
      if (origin !== "agent") {
        throw new AppError("annotations/forbidden", "ask.recorded is an agent-only verb");
      }
      const ask = await createAsk(
        String(input.bookId),
        input.anchor ?? null,
        input.chapterHref ?? null,
        String(input.text),
      );
      bumpAnnotationsRevision();
      return toAnnotationItem(ask) as AskItem;
    },
    removeAsk: async (askId) => {
      const existing = await getAnnotation(annotationId(askId));
      if (!existing || existing.type !== "ask") {
        throw new AppError("annotations/not-found", `ask not found: ${askId}`);
      }
      await deleteAnnotation(String(askId), origin);
      bumpAnnotationsRevision();
    },
  };

  return {
    queries,
    commands,
    events: { subscribe: domainSubscribe(ANNOTATION_EVENTS, origin),
      observe: (query, handler) => observer.observe(query, async accepted => accepted.kind === "page"
        ? { kind: "page", page: await queries.page(accepted.query) }
        : { kind: "inspect", snapshot: await queries.inspect(accepted.annotationId) }, handler, lifetime) },
  };
}
