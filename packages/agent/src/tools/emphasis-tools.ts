import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeReadingEmphasisRef, normalizeReadingEmphasisWrite, type ReadingEmphasisWrite } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { bookRangeSchema } from "./book-range-schema";
import { textResult } from "./tool-result";

export function buildEmphasisTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "manage_reading_emphasis", label: "Temporary reading marks",
    description: "List, put or remove the core Agent's temporary reading marks, separate from saved annotations and plugin-owned marks. Put copies 1-64 versioned ranges from search or range reads; it never navigates or selects text. Omit id/revision to create, supply both observed values to replace or remove. Marks survive page changes but end with the reader renderer; attached counts document attachments, not on-screen visibility. Returns metadata only, never extra passage or spoiler access. Query list after reopening or a conflict. Use for an explicit visual reading request.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("put"), Type.Literal("remove")]),
      id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
      ranges: Type.Optional(Type.Array(bookRangeSchema, { minItems: 1, maxItems: 64 })),
      style: Type.Optional(Type.Union([Type.Literal("highlight"), Type.Literal("underline")])),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new AppError("reader/invalid-target", "Invalid emphasis command");
      const { action, ...input } = params as ReadingEmphasisWrite & { action: string };
      if (action === "list") {
        if (Object.keys(input).length) throw new AppError("reader/invalid-target", "List takes no mutation fields");
        const result = await deps.reader.listEmphasis();
        return textResult(scope.kind === "book" ? result.filter(mark => mark.bookId === scope.bookId) : result);
      }
      const write = action === "put" ? normalizeReadingEmphasisWrite(input) : undefined;
      const ref = action === "remove" ? normalizeReadingEmphasisRef(input) : undefined;
      if (!write && !ref) throw new AppError("reader/invalid-target", "Unknown emphasis command");
      const current = await deps.reader.getSession(); signal?.throwIfAborted();
      if (!current.sessionId || !current.bookId || current.status !== "ready") throw new AppError("reader/unavailable", "No ready reader");
      if (scope.kind === "book" && current.bookId !== scope.bookId || write && write.ranges[0].bookId !== current.bookId) throw new AppError("reader/out-of-scope", "The emphasis book is not active");
      const guard = { sessionId: current.sessionId, bookId: current.bookId };
      return textResult(write ? await deps.reader.putEmphasis(write, signal, guard) : await deps.reader.removeEmphasis(ref!, signal, guard));
    },
  }];
}
