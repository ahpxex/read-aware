import { AppError, ERR_AI_MEMORY_DISABLED } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { policyCall, type LivePolicy } from "../runtime/policy-call";

export type MemoryBuildPolicy = LivePolicy;

const unrestricted: LivePolicy = { enabled: () => true, subscribe: () => () => {} };

export async function runMemoryBuild<T>(
  deps: Pick<RuntimeDeps, "memoryPolicy" | "log">,
  work: (operation: MemoryBuildOperation) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const call = policyCall(deps.memoryPolicy ?? unrestricted,
    () => new AppError(ERR_AI_MEMORY_DISABLED, "[ai/memory-disabled] Building memory is disabled."), signal);
  const commits = new Set<Promise<void>>();
  let closed = false;
  const assertAllowed = () => {
    call.assertAllowed();
    if (closed) throw new AppError("memory/cancelled", "Memory operation has finished");
  };
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    assertAllowed();
    const result = await call.wait(fn(...args));
    assertAllowed();
    return result;
  };
  // Reads/inference may be abandoned, but a dispatched mutation owns its receipt
  // until settlement. Abort cannot turn an unknown write outcome into "done".
  const commit: MemoryBuildOperation["commit"] = fn => async (...args) => {
    assertAllowed();
    const pending = fn(...args);
    const settled = pending.then(() => {}, error => {
      if (call.signal.aborted) deps.log?.warn("Memory commit failed while cancellation was draining", error);
    });
    commits.add(settled);
    void settled.then(() => { commits.delete(settled); });
    const result = await pending;
    assertAllowed();
    return result;
  };
  try {
    call.assertAllowed();
    return await call.wait(work({
      signal: call.signal,
      assertAllowed,
      guard,
      commit,
      complete: complete => (model, context, options) => guard(() => complete(model, context, { ...options,
        signal: options?.signal ? AbortSignal.any([options.signal, call.signal]) : call.signal }))(),
      protect: original => ({
        ...original,
        memory: { ...original.memory,
          saveMemory: commit(original.memory.saveMemory),
          reinforceMemory: commit(snapshot => original.memory.reinforceMemory(snapshot, call.signal)),
          applyMemoryChanges: commit((changes, snapshots) => original.memory.applyMemoryChanges(changes, snapshots, call.signal)) },
        conversations: { ...original.conversations, putInsights: commit(original.conversations.putInsights) },
        profile: { ...original.profile, putProfileSummary: commit(original.profile.putProfileSummary) },
        identityConsolidation: {
          snapshot: guard(() => original.identityConsolidation.snapshot(call.signal)),
          commit: commit(input => original.identityConsolidation.commit(input, call.signal)),
        },
        entityRegistry: { ...original.entityRegistry, query: guard(query => original.entityRegistry.query(query, call.signal)) },
        bookMemory: { ...original.bookMemory,
          listDigests: guard(original.bookMemory.listDigests),
          inspectDigest: guard((bookId, index) => original.bookMemory.inspectDigest(bookId, index, call.signal)),
          saveDigest: commit((bookId, digest, revision) => original.bookMemory.saveDigest(bookId, digest, revision, call.signal)) },
        library: { ...original.library, getBook: guard(original.library.getBook), getBookStats: guard(original.library.getBookStats),
          classifyBookIfUnclassified: commit((bookId, flavor) => original.library.classifyBookIfUnclassified(bookId, flavor, call.signal)) },
        bookText: { ...original.bookText, getToc: guard(original.bookText.getToc), getChapterText: guard(original.bookText.getChapterText) },
        extraMemoryCandidates: original.extraMemoryCandidates && guard(original.extraMemoryCandidates),
      }),
    }));
  } finally {
    closed = true;
    try { await Promise.all(commits); }
    finally { call.dispose(); }
  }
}

export interface MemoryBuildOperation {
  signal: AbortSignal;
  assertAllowed(): void;
  guard<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;
  commit<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;
  complete(complete: CompleteFn): CompleteFn;
  protect(deps: RuntimeDeps): RuntimeDeps;
}
