import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeBookClassification, validateClassificationBookId, type DigestFlavor } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

export function buildBookClassificationTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return { name: "classify_book", label: "Book classification", executionMode: "sequential",
    description: "Inspect or explicitly change a book's narrative/expository classification. Inspect first and pass that exact revision; every change requires user approval. Narrative uses chapter spoiler boundaries; expository does not. Classification affects future graph/prompt assembly, does not instantly rebuild digests, cancel in-flight work or erase past answers. Never reclassify just to bypass a spoiler fence. Book threads may only manage the current book; global threads require a discovered book ID. Conflicts require fresh inspection and renewed approval, never blind retry. Manual correction is allowed when automatic memory building is disabled.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("inspect"), Type.Literal("classify")]), bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      narrativity: Type.Optional(Type.Union([Type.Literal("narrative"), Type.Literal("expository")])), expectedRevision: Type.Optional(Type.String()) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new AppError("memory/invalid-input", "Expected a classification request");
      const raw = params as { action: string; bookId?: string; narrativity?: DigestFlavor; expectedRevision?: string };
      const bookId = raw.bookId ?? (scope.kind === "book" ? scope.bookId : "");
      validateClassificationBookId(bookId);
      if (scope.kind === "book" && scope.bookId !== bookId) throw new AppError("memory/forbidden", "Classification belongs to another book");
      if (!["inspect", "classify"].includes(raw.action) || Object.keys(raw).some(key => !["action", "bookId", ...(raw.action === "classify" ? ["narrativity", "expectedRevision"] : [])].includes(key))) throw new AppError("memory/invalid-input", "Invalid classification action");
      const change = raw.action === "inspect" ? null : normalizeBookClassification({ bookId, narrativity: raw.narrativity!, expectedRevision: raw.expectedRevision! });
      const snapshot = await deps.bookClassification.inspect(bookId, signal);
      if (!snapshot) throw new AppError("reader/book-not-found", "Book not found");
      if (!change) return textResult(snapshot);
      if (snapshot.revision !== change.expectedRevision) throw new AppError("memory/conflict", "Inspect current classification before changing it");
      const book = await deps.library.getBook(bookId);
      if (!book) throw new AppError("reader/book-not-found", "Book not found");
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "classify-book", subject: `${book.title}\n${bookId}\n${snapshot.narrativity ?? "unclassified"} -> ${change.narrativity}` } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ changed: false }), details };
      return { ...textResult(await deps.bookClassification.change(change, signal)), details };
    },
  };
}
