import { errorCode, type MemoryCandidateOutcome } from "@read-aware/core";
import type { MemoryBuildOperation } from "../memory/build-policy";
import type { ExternalMemoryCandidate, MemoryRecord, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeExternalMemoryCandidates } from "./extension-context";

export async function persistExtensionMemory(input: {
  scope: ThreadScope;
  sourceThreadKey: string;
  candidates: ExternalMemoryCandidate[];
  existing: MemoryRecord[];
  memory: RuntimeDeps["memory"];
  operation: MemoryBuildOperation;
  log: RuntimeDeps["log"];
}): Promise<void> {
  const report = (candidate: ExternalMemoryCandidate, outcome: MemoryCandidateOutcome) => {
    try { candidate.report?.(outcome); }
    catch (error) { input.log?.warn("Plugin memory outcome callback failed", error); }
  };
  const accepted = normalizeExternalMemoryCandidates({ ...input,
    onReject: (candidate, reason) => report(candidate, { status: "rejected", reason }),
  });
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
