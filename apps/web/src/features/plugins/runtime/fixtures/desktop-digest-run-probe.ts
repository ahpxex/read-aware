import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { digestRunProbe } from "../../../../../../../packages/agent/src/testing/digest-run-probe";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let probe: ReturnType<typeof digestRunProbe> | undefined;
export async function prepareDigestRunProbe() {
  seed = await prepareMemoryDomainProbe();
  for (const index of [0, 1]) await makeDigestObsolete(index);
  probe = digestRunProbe(buildRuntimeDeps(), seed.bookId, seed.chapters[2]!.hrefs![0]!);
  return seed;
}
export async function makeDigestObsolete(index = 0) {
  if (!seed || ![0, 1].includes(index)) throw Error("Prepare isolated digest probe first");
  await commitDomainEvents({ type: "book.chapterDigested", origin: "agent", payload: { bookId: seed.bookId, chapterIndex: index,
    chapterHref: seed.chapters[index]!.hrefs?.[0], summary: `Old chapter ${index}`, characters: [], relations: [], digestVersion: 1, flavor: "narrative" } });
}
export function runDigestProbe(mode: "fail-first" | "success") { if (!probe) throw Error("Prepare probe first"); return probe.run(mode); }
export function beginDigestCancelProbe() { if (!probe) throw Error("Prepare probe first"); probe.begin(); }
export function digestCancelStatus() { return probe?.status(); }
export function cancelDigestProbe() { probe?.cancel(); }
export async function releaseDigestProbe() { return probe?.release(); }
export async function cleanupDigestRunProbe() { await probe?.dispose(); probe = undefined; const result = await cleanupMemoryDomainProbe(); seed = undefined; return result; }
