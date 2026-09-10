import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeBookReferenceQuery, normalizeBookReferencesQuery, type BookReferenceQuery, type BookReferencesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { assertSpoilerPermission, confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

const referenceParameters = Type.Object({ reference: Type.Object({ bookId: Type.String({ minLength: 1, maxLength: 512 }),
  contentVersion: Type.String({ minLength: 1, maxLength: 256 }), sectionIndex: Type.Integer({ minimum: 0 }), index: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 2, maximum: 12000 })), confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false });

export function buildReferenceTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  function access(bookId: string, raw: unknown) {
    const current = scope.kind === "book" && bookId === scope.bookId, grant = spoilerGranted(raw);
    assertSpoilerPermission(grant, state, current);
    return { current, grant, fence: current && state?.spoilerFence && !grant ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {} };
  }
  return [{
    name: "list_book_references", label: "Book references",
    description: "List links and inline notes in one versioned book section. Get sectionIndex and contentVersion from get_navigation_toc, not read_chapter's chapter index. Returns opaque reference descriptors, bounded labels and nextOffset. Does not read destinations, fetch URLs, or move the reader. Narrative source sections remain behind the reading fence.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), contentVersion: Type.String({ minLength: 1, maxLength: 256 }),
      sectionIndex: Type.Integer({ minimum: 0 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const { confirmSpoiler, ...raw } = params as Omit<BookReferencesQuery, "bookId"> & { bookId?: string; confirmSpoiler?: unknown };
      const query = normalizeBookReferencesQuery({ ...raw, bookId: resolveBookId(scope, raw.bookId), limit: 20 });
      const { current, grant, fence } = access(query.bookId, confirmSpoiler);
      const result = await deps.bookText.listReferences({ ...query, ...fence }, signal);
      if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "read_book_reference", label: "Read book reference",
    description: "Resolve a reference returned by list_book_references and preview bounded plain text without moving the reader. Copy its descriptor unchanged. Both source and internal target must satisfy the narrative reading fence; known links do not bypass it. A resolved location can be passed to open_book. External URLs are only reported, never fetched/opened; blocked/missing/unsupported are explicit. Follow nextOffset for more text.",
    parameters: referenceParameters,
    execute: async (_id, params, signal) => {
      const { confirmSpoiler, ...raw } = params as BookReferenceQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookReferenceQuery(raw);
      const { current, grant, fence } = access(query.reference.bookId, confirmSpoiler);
      const result = await deps.bookText.readReference({ ...query, ...fence }, signal);
      if (state && result.text) state.evidenceTexts.push(result.text);
      if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "show_book_reference", label: "Show book reference",
    description: "Show one bounded reference preview in the open book's native note popup, without navigating. Use only when the user wants to see it. Open that book first. Source and target reading fences still apply. Returns opened only after the host surface commits, or not-opened for external/blocked/missing/unsupported references. Retain the returned ID to close only this thread's preview. Offset/nextOffset can select another preview page.",
    parameters: referenceParameters,
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const { confirmSpoiler, ...raw } = params as BookReferenceQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookReferenceQuery(raw);
      const { current, grant, fence } = access(query.reference.bookId, confirmSpoiler);
      const session = await deps.reader.getSession();
      if (session.status !== "ready" || !session.sessionId) throw new AppError("reader/unavailable", "Open the reference book first");
      const result = await deps.reader.previewReference(threadScopeKey(scope), { ...query, ...fence }, signal, { sessionId: session.sessionId, bookId: query.reference.bookId });
      if (state && result.preview.text) state.evidenceTexts.push(result.preview.text);
      if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "close_book_reference", label: "Close book reference",
    description: "Close only this thread's current native reference preview using the ID returned by show_book_reference. A replaced, dismissed, retired or other actor's preview returns not-current; it cannot close an unrelated native note.",
    parameters: Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => textResult(await deps.reader.closeReferencePreview(threadScopeKey(scope), (params as { id: string }).id, signal)),
  }];
}
