/**
 * Annotations domain — highlights, notes, and asks over annotation-db.
 * Commands enforce the verb's invariants once, for every actor: kind checks
 * before mutation, list invalidation after, origin threading throughout.
 * `createAsk` is actor-guarded: asks are the agent runtime's passive traces,
 * so only the "agent" origin may record them.
 */
import { getDefaultStore } from "jotai";
import type {
  AnnotationItem,
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
  recolorHighlight,
  updateNote,
} from "../features/annotations/lib/annotation-db";
import type { Annotation } from "../features/annotations/lib/annotation-types";
import { annotationsRevisionAtom } from "../features/annotations/state/annotations-revision";
import { ANNOTATION_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

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

export type AnnotationsDomain = {
  list(filter?: {
    bookId?: string;
    kind?: "highlight" | "note" | "ask";
    query?: string;
  }): Promise<AnnotationItem[]>;
  on: DomainEventSubscribe<(typeof ANNOTATION_EVENTS)[number]>;
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
};

export function createAnnotationsDomain(origin: EventOrigin): AnnotationsDomain {
  const requireHighlight = async (id: string) => {
    const existing = await getAnnotation(String(id));
    if (!existing || existing.type !== "highlight") {
      throw new Error(`highlight not found: ${id}`);
    }
    return existing;
  };
  const requireNote = async (id: string) => {
    const existing = await getAnnotation(String(id));
    if (!existing || existing.type !== "note") {
      throw new Error(`note not found: ${id}`);
    }
    return existing;
  };

  return {
    list: async (filter) =>
      (
        await listAnnotations({
          bookId: filter?.bookId ? String(filter.bookId) : undefined,
          type: filter?.kind,
          searchQuery: filter?.query,
        })
      ).map(toAnnotationItem),
    on: domainSubscribe(ANNOTATION_EVENTS, origin),
    createHighlight: async (input) => {
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
        throw new Error("ask.recorded is an agent-only verb");
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
  };
}
