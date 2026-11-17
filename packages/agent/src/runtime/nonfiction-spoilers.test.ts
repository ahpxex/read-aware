import { expect, test } from "bun:test";
import { getCurrentSystemPrompt, type Api, type Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { AgentThread } from "./thread";

test("an unclassified book stays protected for its first reply and opens once the background verdict lands", async () => {
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
  // Classification is reading policy, independent of optional memory building.
  const memory = memoryPolicyState();
  memory.set(false);
  deps.memoryPolicy = memory.policy;
  let classifications = 0;
  const prompts: string[] = [];
  const results: string[] = [];
  faux.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })]);
    },
    (context) => {
      results.push(JSON.stringify(context.messages[context.messages.length - 1]));
      return fauxAssistantMessage("That part is later in the book.");
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })]);
    },
    (context) => {
      results.push(JSON.stringify(context.messages[context.messages.length - 1]));
      return fauxAssistantMessage("The 1992 journey accelerated reform.");
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
  });
  try {
    const cursor = { chapterIndex: 0, visibleText: "A childhood in the village." };
    for await (const _ of thread.sendTurn({ text: "What changed in 1992? Check the book.", readingCursor: cursor })) {
      /* drain */
    }
    // The first reply did not wait for the classifier: it ran behind the fence.
    expect(prompts[0]).toContain("request_spoiler_access");
    expect(results[0]).not.toContain("The 1992 journey");
    await thread.flushBackgroundWork();
    // Classification is reading policy: it runs with memory building switched off.
    expect(classifications).toBe(1);
    expect(stores.books[0]!.spoilerSensitive).toBe(false);
    for await (const _ of thread.sendTurn({ text: "What changed in 1992? Check the book.", readingCursor: cursor })) {
      /* drain */
    }
    expect(prompts[1]).toContain("Later reform evidence");
    expect(prompts[1]).toContain("This book has no plot-spoiler boundary");
    expect(results[1]).toContain("The 1992 journey accelerated reform.");
  } finally {
    thread.dispose();
    await thread.flushBackgroundWork();
    faux.unregister();
  }
});

test("a book the classifier cannot place keeps the fence, the spoiler card and the prompt rules together", async () => {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 }),
    model = faux.getModel() as Model<Api>;
  const { deps } = createInMemoryDeps({
    books: [{ id: "u", title: "Untitled manuscript", status: "reading" }],
    chapters: {
      u: [
        { title: "One", text: "Opening scene." },
        { title: "Two", text: "The twist is revealed." },
      ],
    },
  });
  let prompt = "";
  let result = "";
  faux.setResponses([
    (context) => {
      prompt = getCurrentSystemPrompt(context.messages);
      return fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })]);
    },
    (context) => {
      result = JSON.stringify(context.messages[context.messages.length - 1]);
      return fauxAssistantMessage("That comes later.");
    },
  ]);
  const thread = new AgentThread({
    scope: { kind: "book", bookId: "u" },
    deps,
    resolveModel: () => model,
    getApiKey: () => "fixture",
    streamFn: streamSimple,
    // An unsure verdict is not recorded: the book stays unclassified.
    completeFn: async () =>
      fauxAssistantMessage('{"narrativity":"narrative","spoilerSensitive":true,"confidence":0.2}'),
  });
  try {
    for await (const _ of thread.sendTurn({
      text: "What happens next?",
      readingCursor: { chapterIndex: 0, visibleText: "Opening scene." },
    })) {
      /* drain */
    }
    expect(prompt).toContain("request_spoiler_access");
    expect(result).not.toContain("The twist is revealed.");
    expect(result).toContain("request_spoiler_access");
  } finally {
    thread.dispose();
    await thread.flushBackgroundWork();
    faux.unregister();
  }
});
