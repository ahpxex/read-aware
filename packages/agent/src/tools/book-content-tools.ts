import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildBookContentTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_book_content_state", label: "Check book source",
    description: "Read source availability and an opaque sourceRevision without parsing, downloading or invoking a content provider. A registered virtual provider is not proof its content is cached, reachable or readable; its contentVersion is null because no load occurs. Compare sourceRevision with get_reading_session.sourceRevision ONLY for the same ready book: different tokens mean a known source/provider change, equal tokens do not prove an unannounced remote change did not happen. Reading state requires its separate query; this returns no private provider keys, paths, URLs or bytes. Book threads are restricted to their own book. Use navigate_reading(reload) only on an explicit user request, since it restarts reading at the beginning.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const bookId = (params as { bookId?: string }).bookId ?? (scope.kind === "book" ? scope.bookId : "");
      if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256) throw new AppError("ui/invalid-target", "Book ID required");
      if (scope.kind === "book" && bookId !== scope.bookId) throw new AppError("memory/forbidden", "Content state belongs to another book");
      const result = await deps.library.getContentState(bookId, signal);
      signal?.throwIfAborted();
      return textResult(result);
    },
  }];
}
