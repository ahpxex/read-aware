import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type BookMergeRequest, type DuplicateBookQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

export function buildBookMergeTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  if (scope.kind !== "global") return [];
  const id = Type.String({ minLength: 1, maxLength: 256 });
  return [{
    name: "list_duplicate_books", label: "Find duplicate books",
    description: "List groups with identical source-file hashes, not similar titles or editions. The deterministic keeper is oldest createdAt then smallest ID. This is a live offset page; reload after changes. No records change. Preview a group before proposing a merge.",
    parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => textResult(await deps.library.listDuplicates(params as DuplicateBookQuery, signal)),
  }, {
    name: "preview_book_merge", label: "Preview duplicate merge",
    description: "Preview the deterministic keeper and duplicate IDs for a same-content group, plus its revision. null means no duplicate group. Shows at most 50 duplicate members with total count; the approval UI shows the full target list. Keeper metadata wins; annotations, reading totals/progress, stars and digests fold according to host rules. Chat transcripts and provenance are not combined into a single thread. Alias assets remain pinned while the keeper exists; this is not disk cleanup. No undo or arbitrary keeper selection.",
    parameters: Type.Object({ bookId: id }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const preview = await deps.library.previewMerge((params as { bookId: string }).bookId, signal);
      return textResult(preview ? { ...preview, merged: preview.merged.slice(0, 50), totalDuplicates: preview.merged.length, truncated: preview.merged.length > 50 } : null);
    },
  }, {
    name: "merge_duplicate_books", label: "Merge duplicate books", executionMode: "sequential",
    description: "Requires a current preview revision and host user approval. Merge the exact same-content group using the host's keeper, never arbitrary books. Membership or displayed metadata changes reject as superseded; preview and obtain fresh approval again. Records/events commit atomically; dispatched writes are not rolled back by later cancellation. Returns committed ID redirects (first 50 and total); resolve_book_reference resolves any old ID later. Existing sync policy applies. Does not merge chat transcripts, open a reader or promise immediate file reclamation.",
    parameters: Type.Object({ bookId: id, expectedRevision: Type.String({ pattern: "^bmg1:[a-f0-9]{64}$" }) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const input = { ...(params as BookMergeRequest) };
      const preview = await deps.library.previewMerge(input.bookId, signal);
      if (!preview || preview.revision !== input.expectedRevision) throw new AppError("ui/superseded", "Preview the changed group again");
      const label = (book: { id: string; title: string }) => `${book.title.slice(0, 160)} (${book.id})`;
      const subject = `${label(preview.keep)}\n←\n${preview.merged.map(label).join("\n")}`;
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "merge-books", subject } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ committed: false }), details };
      const result = await deps.library.mergeDuplicates(input, signal);
      return { ...textResult({ ...result, redirects: result.redirects.slice(0, 50), totalRedirects: result.redirects.length }), details };
    },
  }, {
    name: "resolve_book_reference", label: "Resolve book reference",
    description: "Resolve an old book ID through committed merge aliases to the current living book. Returns null for unknown/deleted targets; does not resurrect, import or open anything.",
    parameters: Type.Object({ bookId: id }, { additionalProperties: false }),
    execute: async (_id, params, signal) => textResult({ bookId: await deps.library.resolveBookId((params as { bookId: string }).bookId, signal) }),
  }];
}
