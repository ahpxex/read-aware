import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";
import type { ReadingLocation } from "@read-aware/core";

export function buildReaderTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  const openBook: AgentTool = {
    name: "open_book",
    label: "Open book",
    description:
      "Open a shelf book in the reader. Optionally jump to an annotation, chapter index, CFI anchor, chapter href, or fraction (0 to 1). Pass contentVersion when reusing a reported location. bookId defaults to the current book. Returns actual completion.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
      annotationId: Type.Optional(Type.String()),
      chapterIndex: Type.Optional(Type.Number()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
      fraction: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      contentVersion: Type.Optional(Type.String()),
      location: Type.Optional(Type.Object({
        bookId: Type.String(), contentVersion: Type.String(), cfi: Type.Optional(Type.String()), href: Type.Optional(Type.String()), fraction: Type.Optional(Type.Number()),
        textQuote: Type.Optional(Type.Object({ exact: Type.String(), prefix: Type.Optional(Type.String()), suffix: Type.Optional(Type.String()) })),
      }, { description: "Copy the complete location returned by get_navigation_toc or find_book_locations." })),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const { bookId, annotationId, chapterIndex, anchor, chapterHref, fraction, contentVersion, location } = params as {
        bookId?: string;
        annotationId?: string;
        chapterIndex?: number;
        anchor?: string;
        chapterHref?: string;
        fraction?: number;
        contentVersion?: string;
        location?: ReadingLocation;
      };
      if (location && (annotationId || chapterIndex !== undefined || anchor || chapterHref || fraction !== undefined || contentVersion
        || bookId && bookId !== location.bookId)) throw new Error("Use location or individual locator fields, not conflicting targets");
      const target = resolveBookId(scope, bookId ?? location?.bookId);
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
        if (!targetAnchor && !targetHref) throw new Error("This annotation has no navigable location");
      } else if (chapterIndex !== undefined) {
        const chapter = (await deps.bookText.getToc(target)).find(
          (entry) => entry.index === chapterIndex,
        );
        if (!chapter) throw new Error(`chapter ${chapterIndex} not found in ${target}`);
        targetHref = chapter.hrefs?.[0];
        if (!targetHref) throw new Error(`chapter ${chapterIndex} has no navigable location`);
      }

      const receipt = location ? await deps.reader.goTo({ ...location, bookId: target }, signal) : targetAnchor || targetHref || fraction !== undefined || contentVersion
        ? await deps.reader.goTo({ bookId: target, cfi: targetAnchor, href: targetHref, fraction, contentVersion }, signal)
        : await deps.reader.openBook(target, signal);
      return textResult({
        opened: true,
        ...receipt,
        bookId: target,
        title: book.title,
        anchor: targetAnchor,
        chapterHref: targetHref,
      });
    },
  };

  const session: AgentTool = {
    name: "get_reading_session", label: "Reading session",
    description: "Read the actual active reader status, versioned location, visible text and navigation history availability. A book-scoped turn does not expose another book's viewport.",
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await deps.reader.getSession();
      if (scope.kind === "book" && snapshot.bookId !== scope.bookId) return textResult({ status: "not-active", bookId: scope.bookId });
      return textResult(state?.spoilerFence && !state.spoilerPermissionGranted
        ? { ...snapshot, visibleText: "", textAccess: "Use the turn's original reading_cursor.visible_text; navigation does not grant spoiler access." } : snapshot);
    },
  };
  const control: AgentTool = {
    name: "navigate_reading", label: "Navigate reading",
    description: "Move back/forward through explicit reading jumps, turn to the next/previous page, or close the reader. Returns actual completion, not dispatch acknowledgement. Use open_book for a specific book or location.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("back"), Type.Literal("forward"), Type.Literal("next"), Type.Literal("previous"), Type.Literal("close")]) }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const current = await deps.reader.getSession();
      if (scope.kind === "book" && current.bookId !== scope.bookId) throw new Error("This book is not the active reader");
      const { action } = params as { action: "back" | "forward" | "next" | "previous" | "close" };
      const guard = { sessionId: current.sessionId ?? undefined, ...(scope.kind === "book" ? { bookId: scope.bookId } : {}) };
      if (action === "close") { await deps.reader.close(signal, guard); return textResult({ status: "completed", closed: true }); }
      const result = action === "back" ? await deps.reader.back(signal, guard) : action === "forward"
        ? await deps.reader.forward(signal, guard) : await deps.reader.step(action, signal, guard);
      return textResult(result);
    },
  };
  return [openBook, session, control];
}
