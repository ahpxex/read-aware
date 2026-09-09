import { AppError, ERR_AI_MEMORY_DISABLED } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { policyCall, type LivePolicy } from "../runtime/policy-call";

export type MemoryBuildPolicy = LivePolicy;

const unrestricted: LivePolicy = { enabled: () => true, subscribe: () => () => {} };

export async function runMemoryBuild<T>(
  deps: Pick<RuntimeDeps, "memoryPolicy">,
  work: (operation: MemoryBuildOperation) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const call = policyCall(deps.memoryPolicy ?? unrestricted,
    () => new AppError(ERR_AI_MEMORY_DISABLED, "[ai/memory-disabled] Building memory is disabled."), signal);
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    call.assertAllowed();
    const result = await call.wait(fn(...args));
    call.assertAllowed();
    return result;
  };
  try {
    call.assertAllowed();
    return await call.wait(work({
      signal: call.signal,
      assertAllowed: call.assertAllowed,
      guard,
      complete: complete => (model, context) => guard(() => complete(model, context, { signal: call.signal }))(),
      protect: original => ({
        ...original,
        memory: { ...original.memory,
          saveMemory: guard(original.memory.saveMemory),
          reinforceMemory: guard(original.memory.reinforceMemory),
          applyMemoryChanges: guard(original.memory.applyMemoryChanges) },
        conversations: { ...original.conversations, putInsights: guard(original.conversations.putInsights) },
        profile: { ...original.profile, putProfileSummary: guard(original.profile.putProfileSummary) },
        bookMemory: { ...original.bookMemory, saveDigest: guard(original.bookMemory.saveDigest) },
        library: { ...original.library, setBookNarrativity: guard(original.library.setBookNarrativity) },
        extraMemoryCandidates: original.extraMemoryCandidates && guard(original.extraMemoryCandidates),
      }),
    }));
  } finally { call.dispose(); }
}

interface MemoryBuildOperation {
  signal: AbortSignal;
  assertAllowed(): void;
  guard<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;
  complete(complete: CompleteFn): CompleteFn;
  protect(deps: RuntimeDeps): RuntimeDeps;
}
