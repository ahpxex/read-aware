import { expect, test } from "bun:test";
import { modelRequestView } from "./transcript";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Api, JsonObject, Model } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import { createInMemoryDeps } from "../testing/fixtures";
import { hostTurn } from "../testing/transcript-host";
import { AgentThread } from "./thread";
import { contextPolicyState } from "../testing/reading-context-policy";

const collect = async (stream: AsyncIterable<ThreadChunk>) => {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};
const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const failure = () =>
  fauxAssistantMessage("INCOMPLETE DRAFT", { stopReason: "error", errorMessage: "Connection error." });

for (const kind of ["book", "global"] as const)
  test(`${kind}: retry keeps completed tools, image IDs and presentation without replaying side effects`, async () => {
    const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const { deps, stores } = createInMemoryDeps({ books: [{ id: "book", title: "Book", status: "finished" }] });
    let searches = 0;
    let writes = 0;
    const createNote = deps.annotations.createNote;
    deps.annotations.createNote = async (...args) => {
      writes++;
      return createNote(...args);
    };
    deps.web = {
      configured: () => true,
      search: async (input) => {
        searches++;
        return {
          provider: "fixture",
          query: input.query,
          sources: [],
          retrievedAt: "now",
          images: [
            { url: "https://images.example.org/a.png", sourceUrl: "https://example.org/a", title: "A" },
            { url: "https://images.example.org/b.png", sourceUrl: "https://example.org/b", title: "B" },
          ],
        };
      },
      fetch: async () => {
        throw new Error("unused");
      },
    };
    let recoveredContext = "";
    faux.setResponses([
      call("get_host_capabilities", { catalog: "tools", query: "create_annotation" }),
      call("create_annotation", { kind: "note", bookId: "book", body: "Keep this note once." }),
      call("web_search", { query: "diagrams", includeImages: true }),
      call("present_web_images", { images: [{ id: "web-image-1", caption: "A" }] }),
      failure(),
      failure(),
      (context) => {
        recoveredContext = JSON.stringify(context.messages);
        return call("present_web_images", {
          images: [
            { id: "web-image-1", caption: "A" },
            { id: "web-image-2", caption: "B" },
          ],
        });
      },
      fauxAssistantMessage("Both diagrams."),
    ]);
    const thread = new AgentThread({
      scope: kind === "book" ? { kind, bookId: "book" } : { kind, threadId: "retry" },
      deps,
      resolveModel: () => faux.getModel() as Model<Api>,
      getApiKey: () => "fixture",
      streamFn: streamSimple,
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
    });
    try {
      const input = { text: "Find diagrams", turnId: "user-1" };
      await expect(collect(hostTurn(stores.turns, thread, input))).rejects.toMatchObject({ code: "ai/network" });
      await expect(collect(hostTurn(stores.turns, thread, { ...input, retry: true }))).rejects.toMatchObject({
        code: "ai/network",
      });
      const chunks = await collect(hostTurn(stores.turns, thread, { ...input, retry: true }));
      expect(searches).toBe(1);
      expect(writes).toBe(1);
      expect(recoveredContext).toContain("web_search");
      expect(recoveredContext).not.toContain("INCOMPLETE DRAFT");
      expect(recoveredContext).not.toContain("Connection error");
      const images = chunks.flatMap((c) =>
        c.type === "reference" && c.reference.kind === "web-images" ? c.reference.images : [],
      );
      expect(images.map((i) => i.caption)).toEqual(["A", "B"]);
      expect(
        chunks
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(""),
      ).toBe("Both diagrams.");
      expect((stores.turns.get(thread.key) ?? []).map((t) => t.role)).toEqual(["user", "assistant"]);
    } finally {
      thread.dispose();
      await thread.flushBackgroundWork();
      faux.unregister();
    }
  });

test("tightening reading permissions discards the failed request context before retry", async () => {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
  const { deps } = createInMemoryDeps();
  const policy = contextPolicyState({ selection: true, surrounding: true });
  deps.readingContextPolicy = policy;
  let captured = "";
  faux.setResponses([
    failure(),
    (context) => {
      captured = JSON.stringify(context);
      return fauxAssistantMessage("Safe answer.");
    },
  ]);
  const thread = new AgentThread({
    scope: { kind: "global", threadId: "privacy" },
    deps,
    resolveModel: () => faux.getModel() as Model<Api>,
    getApiKey: () => "fixture",
    streamFn: streamSimple,
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
  });
  try {
    const input = { text: "Explain", turnId: "private-question", attachments: [{ text: "PRIVATE_SELECTION" }] };
    await expect(collect(thread.sendTurn(input))).rejects.toThrow();
    policy.set({ selection: false, surrounding: false });
    await collect(thread.sendTurn({ ...input, retry: true }));
    expect(captured).not.toContain("PRIVATE_SELECTION");
    expect(captured).not.toContain("INCOMPLETE DRAFT");
  } finally {
    thread.dispose();
    await thread.flushBackgroundWork();
    faux.unregister();
  }
});

for (const action of ["new-message", "regenerate", "invalidate", "context-change"] as const)
  test(`retry checkpoint is not reused after ${action}`, async () => {
    const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const { deps } = createInMemoryDeps();
    let captured = "";
    faux.setResponses([
      failure(),
      (context) => {
        captured = JSON.stringify(modelRequestView(context).messages);
        return fauxAssistantMessage("Fresh answer.");
      },
    ]);
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "retry" },
      deps,
      resolveModel: () => faux.getModel() as Model<Api>,
      getApiKey: () => "fixture",
      streamFn: streamSimple,
      completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
    });
    try {
      await expect(collect(thread.sendTurn({ text: "old question", turnId: "old" }))).rejects.toThrow();
      if (action === "invalidate") thread.invalidateAgent();
      await collect(
        thread.sendTurn({
          text: action === "new-message" ? "new question" : "old question",
          turnId: "old",
          retry: action !== "new-message",
          reset: action === "regenerate",
          ...(action === "context-change" ? { readingCursor: { chapter: "changed.xhtml" } } : {}),
        }),
      );
      expect(captured).not.toContain("INCOMPLETE DRAFT");
      expect(JSON.parse(captured)).toHaveLength(1);
    } finally {
      thread.dispose();
      await thread.flushBackgroundWork();
      faux.unregister();
    }
  });
