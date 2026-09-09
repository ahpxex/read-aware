import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { AgentThread, type SendTurnInput } from "./thread";

function fixture() {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 }), model = faux.getModel() as Model<Api>;
  const prompts: string[] = [], messageCounts: number[] = [];
  faux.setResponses(Array.from({ length: 8 }, () => context => {
    prompts.push(context.systemPrompt ?? ""); messageCounts.push(context.messages.length); return fauxAssistantMessage("Ready.");
  }));
  const { deps, stores } = createInMemoryDeps({ books: [{ id: "b", title: "Policy book", status: "reading", narrativity: "narrative" }],
    chapters: { b: [0, 1, 2].map(index => ({ title: `Chapter ${index}`, text: `Chapter ${index} material.`, hrefs: [`ch${index}`] })) },
    chapterDigests: { b: [
      { chapterIndex: 0, summary: "Narrative evidence", characters: [], relations: [], digestVersion: 2, flavor: "narrative" },
      { chapterIndex: 1, summary: "Expository evidence", characters: [], relations: [], digestVersion: 2, flavor: "expository" },
      { chapterIndex: 2, summary: "Future narrative", characters: [], relations: [], digestVersion: 2, flavor: "narrative" },
    ] } });
  const policy = memoryPolicyState(); policy.set(false); deps.memoryPolicy = policy.policy;
  const thread = new AgentThread({ scope: { kind: "book", bookId: "b" }, deps, resolveModel: () => model, getApiKey: () => "fixture",
    completeFn: async () => fauxAssistantMessage("{}"), streamFn: streamSimple });
  return { deps, stores, prompts, messageCounts,
    send: async (input: Partial<SendTurnInput> = {}) => { for await (const _ of thread.sendTurn({ text: "Continue", ...input })) { /* drain */ } },
    close: async () => { thread.dispose(); await thread.flushBackgroundWork(); faux.unregister(); } };
}
test("same-chapter classification changes replace stale digests without discarding conversation history", async () => {
  const f = fixture();
  try {
    await f.send({ readingCursor: { chapter: "ch1" } });
    f.stores.books[0]!.narrativity = "expository";
    await f.send({ readingCursor: { chapter: "ch1" } });
    f.stores.books[0]!.narrativity = "narrative";
    await f.send({ readingCursor: { chapter: "ch1" } });
    expect(f.prompts[0]).toContain("Narrative evidence"); expect(f.prompts[0]).not.toContain("Expository evidence");
    expect(f.prompts[1]).toContain("Expository evidence"); expect(f.prompts[1]).not.toContain("Narrative evidence");
    expect(f.prompts[2]).toContain("Narrative evidence"); expect(f.prompts[2]).not.toContain("Expository evidence");
    expect(f.messageCounts).toEqual([1, 3, 5]);
  } finally { await f.close(); }
});
test("index-only movement, lost cursor and finished-to-reading changes invalidate the memory boundary", async () => {
  const f = fixture();
  try {
    await f.send({ readingCursor: { chapterIndex: 2 } });
    await f.send({ readingCursor: { chapterIndex: 0 } });
    expect(f.prompts[0]).toContain("Narrative evidence"); expect(f.prompts[1]).not.toContain("Narrative evidence");
    f.stores.books[0]!.status = "finished";
    await f.send({ readingCursor: { chapterIndex: 0 } });
    expect(f.prompts[2]).toContain("Future narrative");
    f.stores.books[0]!.status = "reading";
    await f.send({ readingCursor: { chapterIndex: 0 } });
    expect(f.prompts[3]).not.toContain("Future narrative");
    await f.send({ readingCursor: { chapterIndex: 2 } });
    await f.send();
    expect(f.prompts[5]).not.toContain("Narrative evidence");
    expect(f.messageCounts).toEqual([1, 3, 5, 7, 9, 11]);
  } finally { await f.close(); }
});
test("future selection is a conversation signal, not authority to widen chapter memory", async () => {
  const f = fixture();
  try {
    await f.send({ readingCursor: { chapter: "ch0" }, attachments: [{ text: "Selection", chapter: "ch2" }] });
    expect(f.prompts[0]).not.toContain("Narrative evidence"); expect(f.prompts[0]).not.toContain("Future narrative");
    expect(f.prompts[0]).toContain('chapter #0 ("Chapter 0")');
  } finally { await f.close(); }
});
test("a degraded digest read retries on the next same-chapter turn instead of freezing the omission", async () => {
  const f = fixture(), read = f.deps.bookMemory.listDigests;
  try {
    f.deps.bookMemory.listDigests = async () => { throw Error("Failed digest projection"); };
    await f.send({ readingCursor: { chapter: "ch1" } });
    f.deps.bookMemory.listDigests = read;
    await f.send({ readingCursor: { chapter: "ch1" } });
    expect(f.prompts[0]).not.toContain("Narrative evidence"); expect(f.prompts[1]).toContain("Narrative evidence");
    expect(f.messageCounts).toEqual([1, 3]);
  } finally { await f.close(); }
});
