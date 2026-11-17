import { requires } from "./tool-availability";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  AppError,
  normalizeBookReferenceQuery,
  normalizeBookReferencesQuery,
  type BookReferenceQuery,
  type BookReferencesQuery,
} from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { resolveBookId } from "./current-book";
import { readingFence } from "./spoiler-access";
import { textResult } from "./tool-result";
import { int, obj, opt, str } from "@earendil-works/pi-schema";

const referenceParameters = obj({
  reference: obj({
    bookId: str({ minLength: 1, maxLength: 512 }),
    contentVersion: str({ minLength: 1, maxLength: 256 }),
    sectionIndex: int({ minimum: 0 }),
    index: int({ minimum: 0 }),
  }),
  offset: opt(int({ minimum: 0 })),
  limit: opt(int({ minimum: 2, maximum: 12000 })),
});

export function buildReferenceTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  /** The fence a call on `bookId` carries to the host. */
  function access(bookId: string) {
    const fence = readingFence(scope, state, bookId);
    return fence ? { throughChapterIndex: fence.throughChapterIndex } : {};
  }
  return [
    {
      name: "list_book_references",
      label: "Book references",
      description:
        "List links and inline notes in one versioned book section. Get sectionIndex and contentVersion from get_toc(view=navigation), not read_chapter's chapter index. Returns opaque reference descriptors, bounded labels and nextOffset. Does not read destinations, fetch URLs, or move the reader. Narrative source sections remain behind the reading fence.",
      parameters: obj({
        bookId: opt(str()),
        contentVersion: str({ minLength: 1, maxLength: 256 }),
        sectionIndex: int({ minimum: 0 }),
        offset: opt(int({ minimum: 0 })),
      }),
      execute: async (_id, params, signal) => {
        const raw = params as Omit<BookReferencesQuery, "bookId"> & { bookId?: string };
        const query = normalizeBookReferencesQuery({ ...raw, bookId: resolveBookId(scope, raw.bookId), limit: 20 });
        const fence = access(query.bookId);
        const result = await deps.bookText.listReferences({ ...query, ...fence }, signal);
        return textResult(result);
      },
    },
    {
      name: "read_book_reference",
      label: "Read book reference",
      description:
        "Resolve a reference returned by query_book_references(request.operation=list) and preview bounded plain text without moving the reader. Copy its descriptor unchanged. Both source and internal target must satisfy the narrative reading fence; known links do not bypass it. A resolved location can be passed to open_book. External URLs are only reported, never fetched/opened; blocked/missing/unsupported are explicit. Supports PDF link annotations and text notes; an internal PDF link previews the destination page text, without guessing its exact rectangle. Named actions, attachments and scripts are blocked. Follow nextOffset for more text; oversized source sections fail with library/content-budget-exceeded instead of being silently truncated.",
      parameters: referenceParameters,
      execute: async (_id, params, signal) => {
        const query = normalizeBookReferenceQuery(params as BookReferenceQuery);
        const fence = access(query.reference.bookId);
        const result = await deps.bookText.readReference({ ...query, ...fence }, signal);
        return textResult(result);
      },
    },
    requires(
      {
        name: "show_book_reference",
        label: "Show book reference",
        description:
          "Show one bounded reference preview in the open book's native note popup, without navigating. Use only when the user wants to see it. Open that book first. Source and target reading fences still apply. Returns opened only after the host surface commits, or not-opened for external/blocked/missing/unsupported references. Retain the returned ID to close only this thread's preview. Offset/nextOffset can select another preview page.",
        parameters: referenceParameters,
        executionMode: "sequential",
        execute: async (_id, params, signal) => {
          const query = normalizeBookReferenceQuery(params as BookReferenceQuery);
          const fence = access(query.reference.bookId);
          const session = await deps.reader.getSession();
          if (session.status !== "ready" || !session.sessionId)
            throw new AppError("reader/unavailable", "Open the reference book first");
          const result = await deps.reader.previewReference(threadScopeKey(scope), { ...query, ...fence }, signal, {
            sessionId: session.sessionId,
            bookId: query.reference.bookId,
          });
          return textResult(result);
        },
      },
      { kind: "reader" },
    ),
    {
      name: "close_book_reference",
      label: "Close book reference",
      description:
        "Close only this thread's current native reference preview using the ID returned by control_book_reference(request.operation=show). A replaced, dismissed, retired or other actor's preview returns not-current; it cannot close an unrelated native note.",
      parameters: obj({ id: str({ minLength: 1, maxLength: 256 }) }),
      executionMode: "sequential",
      execute: async (_id, params, signal) =>
        textResult(
          await deps.reader.closeReferencePreview(threadScopeKey(scope), (params as { id: string }).id, signal),
        ),
    },
  ];
}
