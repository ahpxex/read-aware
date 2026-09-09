import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { runMemoryBuild } from "../../../../../../../packages/agent/src/memory/build-policy";
import { digestBookTick, type DigestBookTickInput } from "../../../../../../../packages/agent/src/memory/graph-upkeep";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let release: (() => void) | undefined, receipt: string | undefined;
const controllers = new Map<string, AbortController>(), work = new Map<string, Promise<void>>();
const states: Record<string, unknown> = {}, calls: Array<{ actor: string; chapter: number }> = [];
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : null;

export async function prepareDigestQueueProbe() {
  seed = await prepareMemoryDomainProbe();
  for (const index of [0,1]) await commitDomainEvents({ type: "book.chapterDigested", origin: "agent", payload: {
    bookId: seed.bookId, chapterIndex: index, chapterHref: seed.chapters[index]!.hrefs![0], summary: `Old ${index}`,
    characters: [], relations: [], digestVersion: 1, flavor: "narrative",
  } });
  return seed;
}

function start(actor: string, holdReceipt: boolean) {
  if (!seed || work.has(actor)) throw Error("Prepare fixture and use a new actor name");
  const book = seed, deps = buildRuntimeDeps(), controller = new AbortController(); controllers.set(actor, controller);
  states[actor] = { status: "pending" };
  if (holdReceipt) {
    const save = deps.bookMemory.saveDigest, gate = new Promise<void>(resolve => { release = resolve; });
    deps.bookMemory.saveDigest = async (...args) => {
      let failed = false, failure: unknown;
      try { await save(...args); receipt = "committed"; }
      catch (error) { failed = true; failure = error; receipt = "failed"; }
      await gate;
      if (failed) throw failure;
    };
  }
  const complete: DigestBookTickInput["complete"] = async (_model, context) => {
    const chapter = Number(JSON.stringify(context.messages).match(/Chapter #(\d+)/)?.[1]);
    calls.push({ actor, chapter });
    return { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: Date.now(), stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ summary: `Queued chapter ${chapter}`, characters: [{ name: `Queued${chapter}` }], relations: [] }) }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  };
  work.set(actor, runMemoryBuild(deps, operation => digestBookTick({ deps: operation.protect(deps), bookId: book.bookId,
    throughChapterHref: book.chapters[2]!.hrefs![0], maxChapters: holdReceipt ? 1 : Number.MAX_SAFE_INTEGER,
    model: { id: "fixture" } as DigestBookTickInput["model"], complete: operation.complete(complete), signal: operation.signal,
  }), controller.signal).then(report => { states[actor] = { status: "done", report }; }, error => { states[actor] = { status: "failed", code: code(error) }; }));
}
export function beginDigestQueueLeader() { start("leader", true); return digestQueueStatus(); }
export function beginDigestQueueFollowers() { start("follower", false); start("cancelled", false); controllers.get("cancelled")!.abort(); return digestQueueStatus(); }
export function cancelDigestQueueLeader() { controllers.get("leader")!.abort(); return digestQueueStatus(); }
export function digestQueueStatus() { return { receipt, calls: [...calls], states: structuredClone(states) }; }
export async function releaseDigestQueueLeader() { release?.(); await Promise.all(work.values()); return digestQueueStatus(); }
export async function retryDigestQueue() { start("retry", false); await work.get("retry"); return digestQueueStatus(); }
export async function cleanupDigestQueueProbe() {
  for (const controller of controllers.values()) controller.abort();
  await releaseDigestQueueLeader(); work.clear(); controllers.clear(); release = undefined;
  const clean = await cleanupMemoryDomainProbe(); seed = undefined; return clean;
}
