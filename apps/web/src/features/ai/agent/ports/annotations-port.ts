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
