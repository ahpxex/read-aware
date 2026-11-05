/**
 * Agent adapter for the shared, read-only chapter graph projection.
 * Model consent is checked here; the pure read model never grants spoilers.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, type BookGraphQuery } from "@read-aware/core";
import { MAX_GRAPH_NAMES, normalizeBookGraphQuery, queryBookGraph, type BookGraphBoundary } from "../memory/book-graph";
import { chapterMemoryPolicy } from "../memory/book-memory-policy";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { assertSpoilerPermission, spoilerParameters, spoilerGranted } from "./book-text-tools";
import { isCurrentBookArg, resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";
import { arr, int, opt, str } from "@earendil-works/pi-schema";

export function buildGraphTools(scope: ThreadScope, deps: RuntimeDeps, turnState?: AgentTurnState): AgentTool[] {
  return [
    {
      name: "query_book_graph",
      label: "Query book graph",
      description:
        "Query this edition's distilled chapter memory: characters or concepts, aliases, relationships and zero-based provenance chapter indices. In replies use original chapter titles from get_toc, not these raw indices. FIRST STOP for identity/relationship questions. This graph is a summary, not source text; verify quotations with read_chapter/search_book_text at the provenance chapter. Pass names for profiles, chapterIndex for one chapter, or neither for an overview. bookId defaults to the current book. Missing or withheld digests are not proof that an entity does not occur in the book.",
      ...spoilerParameters(
        scope,
        {
          names: opt(arr(str({ minLength: 1, maxLength: 256 }), { minItems: 1, maxItems: MAX_GRAPH_NAMES })),
          chapterIndex: opt(int({ minimum: 0 })),
          bookId: opt(str()),
        },
        turnState,
        (args) => isCurrentBookArg(scope, args.bookId),
      ),
      execute: async (_id, params) => {
        const raw = params as BookGraphQuery & { bookId?: string; confirmSpoiler?: unknown };
        const query = normalizeBookGraphQuery({
          ...(raw.names !== undefined ? { names: raw.names } : {}),
          ...(raw.chapterIndex !== undefined ? { chapterIndex: raw.chapterIndex } : {}),
        });
        const target = resolveBookId(scope, raw.bookId);
        const ownBook = scope.kind === "book" && target === scope.bookId;
        const confirmSpoiler = spoilerGranted(raw.confirmSpoiler);
        assertSpoilerPermission(confirmSpoiler, turnState, ownBook);
        // A metadata failure cannot disable the fence. Do not catch it as a missing classification.
        const book = await deps.library.getBook(target);
        if (!book) throw new AppError("reader/book-not-found", "Book not found");
        let boundary: BookGraphBoundary = { kind: "all" };
        if (!confirmSpoiler && ownBook) {
          const sampled = turnState?.bookMemoryBoundary;
          const chapterIndex = sampled
            ? sampled.kind === "before"
              ? sampled.chapterIndex
              : undefined
            : (turnState?.spoilerFence?.readerChapterIndex ?? turnState?.spoilerFence?.throughChapterIndex);
          // A turn sampled as all-visible cannot override a later restrictive classification.
          boundary = chapterMemoryPolicy(book, chapterIndex).boundary;
        }
        const digests = await deps.bookMemory.listDigests(target);
        const result = queryBookGraph(digests, query, boundary, book.narrativity);
        if (confirmSpoiler && turnState && ownBook && result.graph !== "empty" && result.graph !== "unavailable")
          turnState.spoilerGranted = true;
        // Only the returned, boundary-filtered projection is answer evidence;
        // never register the underlying unrestricted digest collection.
        if (ownBook) turnState?.evidenceTexts.push(JSON.stringify(result));
        return textResult(result);
      },
    },
  ];
}
