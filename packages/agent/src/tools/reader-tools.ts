import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

export function buildReaderTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const openBook: AgentTool = {
    name: "open_book",
    label: "Open book",
    description:
      "Open a shelf book in the reader. Optionally jump to an annotation, chapter index, CFI anchor, or chapter href. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
      annotationId: Type.Optional(Type.String()),
      chapterIndex: Type.Optional(Type.Number()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookId, annotationId, chapterIndex, anchor, chapterHref } = params as {
        bookId?: string;
        annotationId?: string;
        chapterIndex?: number;
        anchor?: string;
        chapterHref?: string;
      };
      const target = resolveBookId(scope, bookId);
      const book = await deps.library.getBook(target);
      if (!book) throw new Error(`unknown book: ${target}`);

      let targetAnchor = anchor;
      let targetHref = chapterHref;
      if (annotationId) {
        const annotation = (await deps.annotations.listAnnotations({ bookId: target })).find(
          (entry) => entry.id === annotationId,
        );
        if (!annotation) throw new Error(`annotation not found in ${target}: ${annotationId}`);
        targetAnchor = annotation.anchor;
        targetHref = annotation.chapterHref;
      } else if (chapterIndex !== undefined) {
        const chapter = (await deps.bookText.getToc(target)).find(
          (entry) => entry.index === chapterIndex,
        );
        if (!chapter) throw new Error(`chapter ${chapterIndex} not found in ${target}`);
        targetHref = chapter.hrefs?.[0];
        if (!targetHref) throw new Error(`chapter ${chapterIndex} has no navigable location`);
      }

      if (targetAnchor || targetHref) {
        deps.reader.goTo({ bookId: target, anchor: targetAnchor, chapterHref: targetHref });
      } else {
        deps.reader.openBook(target);
      }
      return textResult({
        opened: true,
        bookId: target,
        title: book.title,
        anchor: targetAnchor,
        chapterHref: targetHref,
      });
    },
  };

  return [openBook];
}
