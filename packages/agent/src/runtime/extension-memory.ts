import { errorCode, type MemoryCandidateOutcome } from "@read-aware/core";
import type { MemoryBuildOperation } from "../memory/build-policy";
import type { ExternalMemoryCandidate, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeExternalMemoryCandidates } from "./extension-context";

export async function persistExtensionMemory(input: {
  scope: ThreadScope;
  sourceThreadKey: string;
  candidates: ExternalMemoryCandidate[];
  memory: RuntimeDeps["memory"];
  operation: MemoryBuildOperation;
  log: RuntimeDeps["log"];
}): Promise<void> {
  if (!input.candidates.length) return;
  const report = (candidate: ExternalMemoryCandidate, outcome: MemoryCandidateOutcome) => {
    try { candidate.report?.(outcome); }
    catch (error) { input.log?.warn("Plugin memory outcome callback failed", error); }
  };
  let accepted = input.candidates;
  const settled = new Set<ExternalMemoryCandidate>();
  const settle = (candidate: ExternalMemoryCandidate, outcome: MemoryCandidateOutcome) => {
    if (settled.has(candidate)) return;
    settled.add(candidate);
    report(candidate, outcome);
  };
  const save = input.operation.commit(async (candidate: ExternalMemoryCandidate) => {
    try {
      // Report the actual write before the policy guard can discard its return
      // value on cancellation. A committed write is not a cancelled write.
      await input.memory.saveMemory({ scope: candidate.scope, kind: candidate.kind, content: candidate.content,
        origin: "plugin", sourceThreadKey: input.sourceThreadKey });
      settle(candidate, { status: "saved" });
    } catch (error) {
      settle(candidate, { status: "failed", errorCode: errorCode(error) ?? "ipc/unknown" });
      throw error;
    }
  });
  try {
    // Prompt retrieval is truncated. Deduplicate against current active memory,
    // including extraction writes from this turn, without consulting other books.
    const visibleScopes = new Set(["user", "global", ...(input.scope.kind === "book" ? [`book:${input.scope.bookId}`] : [])]);
    const existing = await input.operation.guard(() => input.memory.listMemories())();
    accepted = normalizeExternalMemoryCandidates({ ...input,
      existing: existing.filter(memory => visibleScopes.has(memory.scope)),
      onReject: (candidate, reason) => report(candidate, { status: "rejected", reason }),
    });
    for (const candidate of accepted) {
      input.operation.assertAllowed();
      if (candidate.available && !candidate.available()) {
        settle(candidate, { status: "skipped", reason: "provider-unavailable" });
        continue;
      }
      await save(candidate);
    }
  } finally {
    for (const candidate of accepted) if (!settled.has(candidate)) {
      settle(candidate, { status: "skipped", reason: input.operation.signal.aborted ? "cancelled" : "prior-failure" });
    }
  }
}
