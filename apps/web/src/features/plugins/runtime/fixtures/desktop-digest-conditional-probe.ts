import { prepareClassificationPublicProbe, cleanupClassificationPublicProbe } from "./desktop-classification-public-probe";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { commitDomainEvents, onDomainEventBroadcast } from "../../../../platform/domain-events";
import { digestRunProbe } from "../../../../../../../packages/agent/src/testing/digest-run-probe";
import type { ChapterDigest } from "@read-aware/core";

let seed: Awaited<ReturnType<typeof prepareClassificationPublicProbe>> | undefined;
let probe: ReturnType<typeof digestRunProbe> | undefined;
let releaseBroadcast: (() => void) | undefined, broadcasts = 0;
const port = () => buildRuntimeDeps().bookMemory;
export async function prepareDigestConditionalProbe() {
  seed = await prepareClassificationPublicProbe();
  for (const index of [0,1]) await obsoleteDigest(index);
  releaseBroadcast = onDomainEventBroadcast(event => { if (event.type === "book.chapterDigested" && event.payload.bookId === seed?.bookId) broadcasts++; });
  probe = digestRunProbe(buildRuntimeDeps(), seed.bookId, seed.chapters[2]!.hrefs![0]!);
  return seed;
}
export async function obsoleteDigest(index = 0) {
  if (!seed || ![0,1].includes(index)) throw Error("Prepare isolated fixture first");
  await commitDomainEvents({ type: "book.chapterDigested", origin: "agent", payload: { bookId: seed.bookId, chapterIndex: index, chapterHref: seed.chapters[index]!.hrefs?.[0],
    summary: `Old ${index}`, characters: [], relations: [], digestVersion: 1, flavor: "narrative" } });
}
export function beginDigestConditionalPause() { if (!probe) throw Error("Prepare fixture first"); probe.begin(); }
export function digestConditionalStatus() { return { ...probe?.status(), broadcasts }; }
export async function releaseDigestConditionalPause() { await probe?.release(); return digestConditionalStatus(); }
export async function runDigestConditionalPass() { if (!probe) throw Error("Prepare fixture first"); return probe.run("success"); }
export async function writeDigestWinner(mode: "normal" | "mutate" | "cancel" = "normal") {
  if (!seed) throw Error("Prepare fixture first");
  const snapshot = await port().inspectDigest(seed.bookId, 0); if (!snapshot) throw Error("Missing fixture book");
  const digest: ChapterDigest = { chapterIndex: 0, chapterHref: seed.chapters[0]!.hrefs?.[0], summary: "Winner", characters: [{ name: "Winner" }], relations: [], digestVersion: 2, flavor: snapshot.flavor };
  const controller = new AbortController();
  const work = port().saveDigest(seed.bookId, digest, snapshot.revision, controller.signal);
  if (mode === "mutate") { digest.summary = "PRIVATE_MUTATED"; digest.characters[0]!.name = "PRIVATE_MUTATED"; }
  if (mode === "cancel") controller.abort();
  try { await work; return { status: "saved", broadcasts }; }
  catch (error) { return { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null, broadcasts }; }
}
export async function inspectDigestConditionalRows() { if (!seed) throw Error("Prepare fixture first"); return { rows: await port().listDigests(seed.bookId), broadcasts }; }
export async function cleanupDigestConditionalProbe() {
  await probe?.dispose(); probe = undefined; releaseBroadcast?.(); releaseBroadcast = undefined;
  const result = await cleanupClassificationPublicProbe(); seed = undefined; return result;
}
