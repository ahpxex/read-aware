import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { runMemoryBuild } from "../../../../packages/agent/src/memory/build-policy";
import { memoryPolicyState } from "../../../../packages/agent/src/testing/memory-policy";
import { onDomainEventBroadcast } from "../../src/platform/domain-events";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let release: (() => void) | undefined, task: Promise<void> | undefined;
let policy = memoryPolicyState(), broadcasts = 0, disposeBroadcast: (() => void) | undefined;
let status = "idle", receipt = "pending", errorCode: string | undefined;
let warnings: unknown[] = [];
const code = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";

export async function prepareMemoryDrainProbe() {
  seed = await prepareMemoryDomainProbe();
  disposeBroadcast = onDomainEventBroadcast(event => { if (event.type === "book.chapterDigested" && event.payload.bookId === seed?.bookId) broadcasts++; });
  return seed;
}

/** Hold delivery of a real native write's receipt, not the SQLite transaction itself. */
export async function beginMemoryDrain() {
  if (!seed || task) throw Error("Prepare isolated probe and finish prior pass");
  policy = memoryPolicyState(); status = "running"; receipt = "pending"; errorCode = undefined; warnings = [];
  const deps = buildRuntimeDeps(), save = deps.bookMemory.saveDigest;
  const snapshot = await deps.bookMemory.inspectDigest(seed.bookId, 0);
  if (!snapshot) throw Error("Missing owned book");
  const gate = new Promise<void>(resolve => { release = resolve; });
  deps.memoryPolicy = policy.policy;
  deps.log = { warn: (message, error) => { warnings.push({ message, code: code(error) }); }, error() {} };
  deps.bookMemory.saveDigest = async (...args) => {
    let failed = false, failure: unknown;
    try { await save(...args); receipt = "committed"; }
    catch (error) { failed = true; failure = error; receipt = "failed"; }
    await gate;
    if (failed) throw failure;
  };
  task = runMemoryBuild(deps, operation => operation.protect(deps).bookMemory.saveDigest(seed!.bookId, {
    chapterIndex: 0, chapterHref: seed!.chapters[0]!.hrefs![0], digestVersion: 2, flavor: snapshot.flavor,
    summary: "Drained native receipt", characters: [{ name: "Drained" }], relations: [],
  }, snapshot.revision)).then(() => { status = "completed"; }, error => { status = "cancelled-or-failed"; errorCode = code(error); });
  return memoryDrainStatus();
}
export function memoryDrainStatus() { return { status, receipt, errorCode, broadcasts, policySubscriptions: policy.count(), warnings }; }
export function cancelMemoryDrain() { policy.set(false); status = "cancelling"; return memoryDrainStatus(); }
export async function releaseMemoryDrain() { release?.(); await task; task = undefined; release = undefined; return memoryDrainStatus(); }
export async function cleanupMemoryDrainProbe() {
  policy.set(false); await releaseMemoryDrain(); disposeBroadcast?.(); disposeBroadcast = undefined;
  const result = await cleanupMemoryDomainProbe(); seed = undefined; return result;
}
