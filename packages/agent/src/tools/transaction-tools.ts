import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, normalizeAtomicOperations } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";
import { arr, obj, str, unknown } from "@earendil-works/pi-schema";

export function buildTransactionTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const port = deps.transactions?.(scope);
  if (!port) return [];
  const identity = obj({ id: str({ minLength: 1, maxLength: 128 }) });
  return [
    {
      name: "preview_atomic_transaction",
      label: "Preview transaction",
      description:
        "Preview local changes that must commit together. Operations: {kind:'book.metadata',bookId,patch:{title?,author?}} or {kind:'settings',changes:[{path,value,target?}]}. Book conversations may only target their book and its settings. No file/network/plugin callback operations. Does not write. Inspect the returned preview; commit requires user approval. Previews expire in five minutes.",
      parameters: obj({ operations: arr(unknown(), { minItems: 1, maxItems: 100 }) }),
      execute: async (_id, raw, signal) =>
        textResult(await port.preview(normalizeAtomicOperations((raw as { operations: unknown }).operations), signal)),
    },
    {
      name: "preview_transaction_undo",
      label: "Preview undo",
      description:
        "Prepare a new conditional transaction reversing a committed receipt owned by this conversation. Later edits cause conflict, not overwrite. This does not undo anything until commit_atomic_transaction is approved. Redo requires a new semantic operation.",
      parameters: identity,
      execute: async (_id, raw, signal) => textResult(await port.previewUndo((raw as { id: string }).id, signal)),
    },
    {
      name: "get_transaction_receipt",
      label: "Transaction receipt",
      description:
        "Check whether this conversation's transaction committed. Use after a lost response or cancellation before retrying; an absent receipt alone does not cancel a still-running call.",
      parameters: identity,
      execute: async (_id, raw, signal) => textResult(await port.receipt((raw as { id: string }).id, signal)),
    },
    {
      name: "commit_atomic_transaction",
      label: "Commit transaction",
      executionMode: "sequential",
      description:
        "Ask the user to approve the host's exact frozen preview, then commit it once. Works for forward and undo previews. Never invent an ID, claim a preview was committed, or automatically rebase/retry a conflict. Query the receipt if the response is unknown.",
      parameters: identity,
      execute: async (toolCallId, raw, signal, onUpdate) => {
        signal?.throwIfAborted();
        const id = (raw as { id: string }).id,
          preview = await port.inspectPreview(id);
        if (!preview) throw new AppError("transaction/preview-expired", "Prepare a fresh transaction preview");
        const subject = JSON.stringify(preview, null, 2);
        if (subject.length > 16384)
          throw new AppError("transaction/invalid-operation", "Preview is too large to approve; use a smaller batch");
        const answer = await requestUserInteraction({
          deps,
          toolCallId,
          threadKey: threadScopeKey(scope),
          signal,
          onUpdate,
          request: { kind: "permission", action: "atomic-transaction", subject },
        });
        if (answer.answer.cancelled || answer.answer.optionId !== "approve")
          return textResult({ committed: false, reason: "declined" });
        return textResult(await port.commit(id, signal));
      },
    },
  ];
}
