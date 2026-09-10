import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildEnrichmentTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const bookId = (params: unknown) => {
    const id = (params as { bookId?: string }).bookId ?? (scope.kind === "book" ? scope.bookId : "");
    if (typeof id !== "string" || !id.trim() || id.length > 256) throw new AppError("ui/invalid-target", "Book ID required");
    if (scope.kind === "book" && id !== scope.bookId) throw new AppError("memory/forbidden", "Enrichment belongs to another book");
    return id;
  };
  const parameters = Type.Object({ bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false });
  return [{
    name: "get_book_enrichment", label: "Check book assets", parameters,
    description: "Read local cover status (unchecked/none/ready and whether its bytes are local), source availability, missing/filename-derived metadata eligibility and the latest process-local background enrichment attempt. metadataPending is a retry heuristic, not proof better metadata exists. Does not read book text, extract, download or generate anything. Job history is bounded and resets on restart; idle is not evidence the book was never processed. Book threads are restricted to the current book.",
    execute: async (_id, params, signal) => textResult(await deps.library.getEnrichment(bookId(params), signal)),
  }, {
    name: "retry_book_enrichment", label: "Retry book assets", parameters, executionMode: "sequential",
    description: "On the user's request, retry an unchecked cover or missing/filename-derived metadata using the host's existing local background queue. Does not request downloads, ready/absent cover replacement, or forced custom title/author replacement. No new model call. queued/already-running are acceptance, not completion; query get_book_enrichment later for completed/skipped/failed and stable errors. Cancellation before acceptance prevents queueing; after acceptance this shared host work may finish. Library changes follow existing sync settings. Book threads are restricted to the current book.",
    execute: async (_id, params, signal) => textResult(await deps.library.retryEnrichment(bookId(params), signal)),
  }];
}
