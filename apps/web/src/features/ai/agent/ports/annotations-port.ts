/**
 * AnnotationsPort — a thin adapter over the shared domain layer (origin
 * "agent"). Reads return the canonical AnnotationItem union unchanged;
 * recordAsk goes through the domain's agent-only createAsk verb, which owns
 * the origin stamp and the list invalidation.
 */
import type { AnnotationsPort } from "@read-aware/agent";
import { AppError } from "@read-aware/core";
import { createDomainApi } from "../../../../domain";

export function createAnnotationsPort(): AnnotationsPort {
  const annotations = createDomainApi("agent").annotations;
  return {
    getAnnotation: (id) => annotations.queries.get(id),
    listAnnotations: async (filter) =>
      annotations.queries.list({
        bookId: filter?.bookId ? String(filter.bookId) : undefined,
        query: filter?.query,
        kind: filter?.kind,
      }),
    createHighlight: async ({ bookId, text, anchor, chapter, color, style }) =>
      annotations.commands.createHighlight({
        bookId: String(bookId),
        text,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
        color,
        style,
      }),
    recolorHighlight: (highlightId, color) =>
      annotations.commands.recolorHighlight(String(highlightId), color),
    createNote: async ({ bookId, body, quotedText, anchor, chapter }) =>
      annotations.commands.createNote({
        bookId: String(bookId),
        body,
        quotedText,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      }),
    updateNote: (noteId, body) =>
      annotations.commands.updateNote(String(noteId), body),
    removeAnnotation: async (annotationId) => {
      const target = await annotations.queries.get(annotationId);
      if (!target) throw new AppError("annotations/not-found", `annotation not found: ${annotationId}`);
      if (target.kind === "highlight") {
        await annotations.commands.removeHighlight(String(annotationId));
      } else if (target.kind === "note") {
        await annotations.commands.removeNote(String(annotationId));
      } else {
        await annotations.commands.removeAsk(String(annotationId));
      }
    },
    recordAsk: async ({ bookId, question, anchor, chapter }) => {
      await annotations.commands.createAsk({
        bookId: String(bookId),
        text: question,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      });
    },
  };
}
