import { expect, test } from "bun:test";
import { getCurrentSystemPrompt, type Api, type Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { AgentThread } from "./thread";

test("legacy factual narrative is classified before its first answer; later text and graph are available without a grant", async () => {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 }),
    model = faux.getModel() as Model<Api>;
  const { deps, stores } = createInMemoryDeps({
    books: [{ id: "b", title: "A factual political biography", narrativity: "narrative", status: "reading" }],
    chapters: {
      b: [
        { title: "Early years", text: "A childhood in the village." },
        { title: "Later reforms", text: "The 1992 journey accelerated reform." },
      ],
    },
    chapterDigests: {
      b: [
        {
          chapterIndex: 1,
          flavor: "narrative",
          summary: "Later reform evidence",
          characters: [],
          relations: [],
          digestVersion: 2,
        },
      ],
    },
  });
  // Classification is book metadata, independent of optional memory building.
  const memory = memoryPolicyState();
  memory.set(false);
  deps.memoryPolicy = memory.policy;
  let classifications = 0,
    repairs = 0;
  const prompts: string[] = [];
  faux.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })]);
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain("The 1992 journey accelerated reform.");
      return fauxAssistantMessage("The 1992 journey accelerated reform.");
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage("Later reforms.");
    },
  ]);
  const thread = new AgentThread({
    scope: { kind: "book", bookId: "b" },
    deps,
    resolveModel: () => model,
    getApiKey: () => "fixture",
    streamFn: streamSimple,
    completeFn: async () => {
      classifications++;
      return fauxAssistantMessage('{"narrativity":"narrative","spoilerSensitive":false,"confidence":0.98}');
    },
    repairCompleteFn: async () => {
      repairs++;
      return fauxAssistantMessage("Should not repair factual history.");
    },
  });
  try {
    const chunks = [];
    for await (const chunk of thread.sendTurn({
      text: "What changed in 1992? Check the book.",
      readingCursor: { chapterIndex: 0, visibleText: "A childhood in the village." },
    }))
      chunks.push(chunk);
    for await (const _ of thread.sendTurn({ text: "Thanks." })) {
      /* drain */
    }
    expect(stores.books[0]!.narrativity).toBe("narrative");
    expect(stores.books[0]!.spoilerSensitive).toBe(false);
    expect(classifications).toBe(1);
    expect(repairs).toBe(0);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("The 1992 journey accelerated reform.");
    for (const prompt of prompts) {
      expect(prompt).toContain("Later reform evidence");
      expect(prompt).not.toContain("first-sentence caution");
      expect(prompt).toContain("This book has no plot-spoiler boundary");
    }
  } finally {
    thread.dispose();
    await thread.flushBackgroundWork();
    faux.unregister();
  }
});
