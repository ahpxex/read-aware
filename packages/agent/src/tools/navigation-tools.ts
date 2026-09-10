import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeBookRangeQuery, normalizeBookNavigationTargetsQuery, type BookRangeQuery, type BookNavigationTargetsQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { assertSpoilerPermission, confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";
import { bookRangeSchema } from "./book-range-schema";

export function buildNavigationTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  return [{
    name: "list_book_navigation_targets", label: "Book navigation targets",
    description: "List up to 20 versioned source sections (kind=sections) or book-provided page labels (kind=pages). Get contentVersion from get_navigation_toc first; continue with nextOffset. Source index is zero-based reading order, not TOC ordinal or extracted chapter number. Sections include non-linear notes; PDF/comics use one source section per page. Pages are only an existing page-list, never invented printed numbers or screen page counts. Optional label matches the exact source page label, preserving duplicates; an available empty result means no match, absent means no page-list. Null location is not navigable. Copy a returned location to open_book. Reads navigation metadata only, not passage text, and does not grant spoiler access.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), contentVersion: Type.String({ minLength: 1, maxLength: 256 }),
      kind: Type.Union([Type.Literal("sections"), Type.Literal("pages")]), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      label: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as Omit<BookNavigationTargetsQuery, "bookId"> & { bookId?: string };
      const query = normalizeBookNavigationTargetsQuery({ ...input, bookId: resolveBookId(scope, input.bookId), limit: 20 });
      const result = await deps.bookText.listNavigationTargets(query, signal);
      signal?.throwIfAborted();
      return textResult(result);
    },
  }, {
    name: "get_navigation_toc", label: "Navigation contents",
    description: "Read the hierarchical navigation TOC with versioned locations. Ordinal is 1-based TOC order, NOT printed chapter numbering or read_chapter's extracted chapterIndex. Pass a returned location directly to open_book. A null location means a non-navigable heading.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()) }),
    execute: async (_id, params, signal) => textResult(await deps.bookText.getNavigationToc(resolveBookId(scope, (params as { bookId?: string }).bookId), signal)),
  }, {
    name: "find_book_locations", label: "Find book locations",
    description: "Find exact text matches and return versioned locations suitable for open_book. Unlike search_book_text this does not use token fallback. Pagination is bounded by matches and scanned sections; follow nextCursor to continue, including when a batch has no hits. Narrative searches stay behind the reading fence unless the reader explicitly grants spoilers.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()), query: Type.String({ minLength: 1, maxLength: 500 }),
      matchCase: Type.Optional(Type.Boolean()), wholeWords: Type.Optional(Type.Boolean()),
      cursor: Type.Optional(Type.String()), contentVersion: Type.Optional(Type.String()), confirmSpoiler: confirmSpoilerSchema,
    }),
    execute: async (_id, params, signal) => {
      const raw = params as { bookId?: string; query: string; matchCase?: boolean; wholeWords?: boolean; cursor?: string; contentVersion?: string; confirmSpoiler?: unknown };
      const bookId = resolveBookId(scope, raw.bookId);
      const confirmSpoiler = spoilerGranted(raw.confirmSpoiler);
      assertSpoilerPermission(confirmSpoiler, state, scope.kind === "book" && bookId === scope.bookId);
      const result = await deps.bookText.searchLocations({ bookId, query: raw.query, matchCase: raw.matchCase, wholeWords: raw.wholeWords,
        cursor: raw.cursor, contentVersion: raw.contentVersion, limit: 12,
        ...(scope.kind === "book" && bookId === scope.bookId && state?.spoilerFence && !confirmSpoiler ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {}),
      }, signal);
      state?.evidenceTexts.push(...result.hits.map(hit => hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post));
      if (state && confirmSpoiler && scope.kind === "book" && bookId === scope.bookId) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "read_book_range", label: "Read a book range",
    description: "Read a versioned range returned by find_book_locations, without opening or moving the reader. Do not invent or rewrite its bookId, contentVersion or CFI. Returns bounded text, same-section context and nextOffset for continuation. A stale/missing range requires a fresh search. The current narrative book's original reading fence still applies, even to a known range.",
    parameters: Type.Object({
      range: bookRangeSchema,
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 2, maximum: 12000 })),
      contextChars: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })), confirmSpoiler: confirmSpoilerSchema,
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const { confirmSpoiler: rawGrant, ...input } = params as BookRangeQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookRangeQuery(input);
      const current = scope.kind === "book" && query.range.bookId === scope.bookId;
      const grant = spoilerGranted(rawGrant);
      assertSpoilerPermission(grant, state, current);
      const page = await deps.bookText.readRange({ ...query,
        ...(current && state?.spoilerFence && !grant ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {}),
      }, signal);
      state?.evidenceTexts.push(...[page.context.before, page.text, page.context.after].filter(Boolean));
      if (state && grant && current) state.spoilerGranted = true;
      return textResult(page);
    },
  }];
}
