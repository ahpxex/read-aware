/**
 * AnnotationsPort — a thin adapter over the shared domain layer (origin
 * "agent"). Reads return the canonical AnnotationItem union unchanged;
 * recordAsk goes through the domain's agent-only createAsk verb, which owns
 * the origin stamp and the list invalidation.
 */
import type { AnnotationsPort } from "@read-aware/agent";
import { createAnnotationsDomain } from "../../../../domain";

export function createAnnotationsPort(): AnnotationsPort {
  const annotations = createAnnotationsDomain("agent");
  return {
    listAnnotations: async (filter) =>
      annotations.list({
        bookId: filter?.bookId ? String(filter.bookId) : undefined,
        query: filter?.query,
      }),
    createHighlight: async ({ bookId, text, anchor, chapter, color }) =>
      annotations.createHighlight({
        bookId: String(bookId),
        text,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
        color,
      }),
    recolorHighlight: (highlightId, color) =>
      annotations.recolorHighlight(String(highlightId), color),
    createNote: async ({ bookId, body, quotedText, anchor, chapter }) =>
      annotations.createNote({
        bookId: String(bookId),
        body,
        quotedText,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      }),
    updateNote: (noteId, body) => annotations.updateNote(String(noteId), body),
    removeAnnotation: async (annotationId) => {
      const target = (await annotations.list()).find(
        (annotation) => annotation.id === String(annotationId),
      );
      if (!target) throw new Error(`annotation not found: ${annotationId}`);
      if (target.kind === "highlight") {
        await annotations.removeHighlight(String(annotationId));
      } else if (target.kind === "note") {
        await annotations.removeNote(String(annotationId));
      } else {
        await annotations.removeAsk(String(annotationId));
      }
    },
    recordAsk: async ({ bookId, question, anchor, chapter }) => {
      await annotations.createAsk({
        bookId: String(bookId),
        text: question,
        anchor: anchor ?? null,
        chapterHref: chapter ?? null,
      });
    },
  };
}
