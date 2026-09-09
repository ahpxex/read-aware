import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe, reclassifyMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { chapterMemoryThreadProbe } from "../../../../../../../packages/agent/src/testing/chapter-memory-thread-probe";
import { commitDomainEvents } from "../../../../platform/domain-events";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let thread: ReturnType<typeof chapterMemoryThreadProbe> | undefined;
export async function prepareMemoryPromptProbe() {
  seed = await prepareMemoryDomainProbe(); // Includes the isolated app-data guard.
  await commitDomainEvents({ type: "book.chapterDigested", origin: "agent", payload: {
    bookId: seed.bookId, chapterIndex: 1, chapterHref: seed.chapters[1]!.hrefs?.[0], summary: "Concept-only evidence",
    characters: [{ name: "Concept" }], relations: [], digestVersion: 2, flavor: "expository",
  } });
  thread = chapterMemoryThreadProbe(buildRuntimeDeps(), seed.bookId);
  return seed;
}
export async function memoryPromptTurn(chapterIndex?: number, selectionIndex?: number) {
  if (!seed || !thread) throw Error("Prepare isolated prompt probe first");
  return thread.send({ readingCursor: chapterIndex === undefined ? undefined : { chapter: seed.chapters[chapterIndex]!.hrefs?.[0] },
    attachments: selectionIndex === undefined ? undefined : [{ text: "Synthetic selection", chapter: seed.chapters[selectionIndex]!.hrefs?.[0] }] });
}
export async function reclassifyMemoryPromptProbe(flavor: "narrative" | "expository") {
  if (!seed) throw Error("Prepare isolated prompt probe first");
  await reclassifyMemoryDomainProbe(flavor);
}
export async function cleanupMemoryPromptProbe() {
  await thread?.dispose(); thread = undefined;
  const result = await cleanupMemoryDomainProbe(); seed = undefined; return result;
}
