import { expect, test } from "bun:test";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { identityProfileContext, type IdentityConsolidationSnapshot } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { AgentThread } from "./thread";
import type { ThreadScope } from "../thread-scope";

test.each(["book", "global"] as const)("%s thread refreshes derived profile each turn without erasing conversation or curated context", async kind => {
  const provider = registerFauxProvider({ tokensPerSecond: 100_000 }), prompts: string[] = [], lengths: number[] = [];
  provider.setResponses(Array.from({ length: 4 }, () => context => {
    prompts.push(context.systemPrompt ?? ""); lengths.push(context.messages.length);
    return fauxAssistantMessage("Response.");
  }));
  const { deps } = createInMemoryDeps();
  deps.memoryPolicy = { enabled: () => false, subscribe: () => () => {} };
  const revision = `mem1:${"a".repeat(64)}`;
  const snapshot: IdentityConsolidationSnapshot = { revision: `icg1:${"a".repeat(64)}`, entitiesRevision: `entities1:${"a".repeat(64)}`,
    profile: { summary: "Reader-curated claim", revision: `profile2:${"a".repeat(64)}` }, sources: [{ memory: seedMemory({ id: "a", scope: "user", content: "Evidence" }), revision }], settled: true,
    derived: { version: 1, summary: "Derived-only claim", sources: [{ memoryId: "a", revision }], entityEvidence: [] } };
  deps.profile.getProfileContext = async () => identityProfileContext({ profile: snapshot.profile, derived: snapshot.derived,
    sourceConditions: snapshot.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })) });
  // Explicit summary retrieval is not the context read and must not be used here.
  deps.profile.getProfileSummary = async () => { throw Error("Wrong profile read"); };
  const scope: ThreadScope = kind === "book" ? { kind, bookId: "b1" } : { kind, threadId: "profile-context" };
  const thread = new AgentThread({ scope, deps, resolveModel: () => provider.getModel(), getApiKey: () => "test", streamFn: streamSimple,
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}') });
  const turn = async () => {
    for await (const _ of thread.sendTurn({ text: "Continue", readingCursor: { chapter: "Stable chapter", chapterIndex: 0 } })) { /* drain */ }
    await thread.flushBackgroundWork();
  };
  try {
    await turn();
    snapshot.sources[0]!.revision = `mem1:${"b".repeat(64)}`;
    await turn();
    snapshot.derived = { version: 1, summary: "Freshly consolidated claim", sources: [{ memoryId: "a", revision: snapshot.sources[0]!.revision }], entityEvidence: [] };
    await turn();
    snapshot.derived = { version: 999, summary: "Malformed claim" };
    await turn();
    expect(prompts[0]).toContain("Derived-only claim");
    expect(prompts[0]).toContain("takes precedence");
    expect(prompts[1]).not.toContain("Derived-only claim");
    expect(prompts[2]).toContain("Freshly consolidated claim");
    expect(prompts[3]).not.toContain("Freshly consolidated claim");
    expect(prompts[3]).not.toContain("Malformed claim");
    for (const prompt of prompts) expect(prompt).toContain("Reader-curated claim");
    expect(lengths).toEqual([1, 3, 5, 7]);
  } finally { thread.dispose(); provider.unregister(); }
});

test("inferred context alone does not suppress the first-session interview", async () => {
  const provider = registerFauxProvider({ tokensPerSecond: 100_000 });
  let prompt = "";
  provider.setResponses([context => { prompt = context.systemPrompt ?? ""; return fauxAssistantMessage("Hello"); }]);
  const { deps } = createInMemoryDeps();
  deps.profile.getProfileContext = async () => ({ curated: null, derivedStatus: "current",
    consolidated: { version: 1, summary: "Generated insight", sources: [{ memoryId: "a", revision: `mem1:${"a".repeat(64)}` }], entityEvidence: [] } });
  const thread = new AgentThread({ scope: { kind: "global", threadId: "interview" }, deps, resolveModel: () => provider.getModel(), getApiKey: () => "test", streamFn: streamSimple,
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}') });
  try {
    for await (const _ of thread.sendTurn({ text: "Hello" })) { /* drain */ }
    await thread.flushBackgroundWork();
    expect(prompt).toContain("Generated insight");
    expect(prompt).toContain("first session");
  } finally { thread.dispose(); provider.unregister(); }
});
