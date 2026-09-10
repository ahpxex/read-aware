import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeBookReferenceQuery, normalizeBookReferencesQuery, type BookReferenceQuery, type BookReferencesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { assertSpoilerPermission, confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

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
    parameters: Type.Object({ reference: Type.Object({ bookId: Type.String({ minLength: 1, maxLength: 512 }),
      contentVersion: Type.String({ minLength: 1, maxLength: 256 }), sectionIndex: Type.Integer({ minimum: 0 }), index: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 2, maximum: 12000 })), confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const { confirmSpoiler, ...raw } = params as BookReferenceQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookReferenceQuery(raw);
      const { current, grant, fence } = access(query.reference.bookId, confirmSpoiler);
      const result = await deps.bookText.readReference({ ...query, ...fence }, signal);
      if (state && result.text) state.evidenceTexts.push(result.text);
      if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }];
}
