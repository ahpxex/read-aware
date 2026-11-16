import { afterEach, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { hostTurn } from "../testing/transcript-host";
import { memoryPolicyState } from "../testing/memory-policy";
import { AgentThread } from "./thread";
import { contextPolicyState } from "../testing/reading-context-policy";
import type { ReadingContextPermissions } from "./reading-context-policy";
import { buildConversationTools } from "../tools/conversation-tools";
import { buildReaderTools } from "../tools/reader-tools";
import { createAgentTurnState } from "../tools/turn-state";

const providers: FauxProviderRegistration[] = [];
afterEach(() => {
  for (const p of providers.splice(0)) p.unregister();
});
async function collect(stream: AsyncIterable<unknown>) {
  for await (const _chunk of stream) {
    /* Drain the actual runtime. */
  }
}
function fixture(permissions: ReadingContextPermissions) {
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
  providers.push(faux);
  const policy = contextPolicyState(permissions);
  const { deps, stores } = createInMemoryDeps({ books: [{ id: "b1", title: "Book" }] });
  deps.readingContextPolicy = policy;
  const memory = memoryPolicyState();
  memory.set(false);
  deps.memoryPolicy = memory.policy;
  let searches = 0;
  deps.bookText.getChapterText = async () => "CONTEXT BEFORE SELECTED PRIVATE VIEWPORT";
  deps.bookText.searchText = async () => {
    searches++;
    return [];
  };
  const prompts: string[] = [];
  const capture = (ctx: Context) => {
    prompts.push(JSON.stringify(ctx));
    return fauxAssistantMessage("A typed answer.");
  };
  faux.setResponses([capture, capture, capture]);
  const thread = new AgentThread({
    scope: { kind: "book", bookId: "b1" },
    deps,
    resolveModel: () => faux.getModel() as Model<Api>,
    getApiKey: () => "test",
    completeFn: async () => fauxAssistantMessage('{"new":[],"reinforced":[]}'),
    streamFn: streamSimple,
  });
  const input = {
    text: "Typed question",
    attachments: [{ text: "SELECTED PRIVATE", chapter: "one", anchor: "cfi" }],
    readingCursor: { chapter: "one", chapterIndex: 1, visibleText: "SELECTED PRIVATE VIEWPORT" },
  };
  return { faux, policy, memory, deps, stores, thread, input, prompts, searches: () => searches };
}

test("all four policies constrain actual prompt assembly; the host transcript keeps local attachments", async () => {
  for (const selection of [true, false])
    for (const surrounding of [true, false]) {
      const f = fixture({ selection, surrounding });
      await collect(hostTurn(f.stores.turns, f.thread, f.input));
      await f.thread.flushBackgroundWork();
      expect(f.prompts[0]!.includes("SELECTED PRIVATE")).toBe(selection);
      // This host cannot place the reader's location, so the viewport text is the only current material.
      expect(f.prompts[0]!.includes("VIEWPORT")).toBe(selection && surrounding);
      expect(f.prompts[0]).not.toContain("position: paragraph");
      // Nothing is retrieved on the model's behalf: book text reaches it only through its own tool calls.
      expect(f.prompts[0]).not.toContain("<grounding_context>");
      expect(f.searches()).toBe(0);
      expect(f.stores.turns.get("book:b1")?.[0]?.attachments?.[0]?.text).toBe("SELECTED PRIVATE");
      expect(f.policy.listeners()).toBe(0);
      f.thread.dispose();
    }
});

test("a located position reaches the model as coordinates under the same policies, never as text", async () => {
  const text = "CONTEXT BEFORE SELECTED PRIVATE VIEWPORT";
  for (const selection of [true, false])
    for (const surrounding of [true, false]) {
      const f = fixture({ selection, surrounding });
      const located: string[] = [];
      f.deps.bookText.locate = async (_bookId, target) => {
        located.push(target.cfi);
        const start = text.indexOf(target.cfi === "cfi" ? "SELECTED PRIVATE" : "BEFORE");
        const end = target.cfi === "cfi" ? start + "SELECTED PRIVATE".length : text.length;
        return { start: { chapterIndex: 1, offset: start }, end: { chapterIndex: 1, offset: end } };
      };
      // The model asks for the text at each coordinate; what comes back shows what it can reach.
      const results: string[] = [];
      const last = (ctx: Context) => JSON.stringify(ctx.messages[ctx.messages.length - 1]);
      f.faux.setResponses([
        (ctx: Context) => {
          f.prompts.push(last(ctx));
          return fauxAssistantMessage([fauxToolCall("read_chapter", { around: "selection", context: 0 })], {
            stopReason: "toolUse",
          });
        },
        (ctx: Context) => {
          results.push(last(ctx));
          return fauxAssistantMessage([fauxToolCall("read_chapter", { around: "position", context: 0 })], {
            stopReason: "toolUse",
          });
        },
        (ctx: Context) => {
          results.push(last(ctx));
          return fauxAssistantMessage("A typed answer.");
        },
      ]);
      const turn = { ...f.input, readingCursor: { ...f.input.readingCursor, anchor: "viewport" } };
      await collect(hostTurn(f.stores.turns, f.thread, turn));
      await f.thread.flushBackgroundWork();
      const prompt = f.prompts[0]!;
      // The host's own sample is always located: the reading boundary does not depend on what the model may see.
      expect(located.sort()).toEqual(["cfi", "viewport"]);
      expect(prompt.includes("position: paragraph 0 sentence 0, of 1 paragraphs")).toBe(selection && surrounding);
      expect(prompt.includes("selection: paragraph 0 sentence 0")).toBe(selection && surrounding);
      expect(prompt).not.toContain("VIEWPORT");
      expect(prompt).not.toContain("visible_text");
      expect(prompt).not.toContain("CONTEXT BEFORE");
      // read_chapter(around=…) reaches only what the cursor disclosed: with nearby paragraphs
      // withheld, the selection's own words still arrive in the message, but not its surroundings.
      expect(results[0]!.includes("SELECTED PRIVATE")).toBe(selection && surrounding);
      expect(results[0]!.includes("withheld by the reader's privacy settings")).toBe(!(selection && surrounding));
      expect(results[1]!.includes("CONTEXT BEFORE")).toBe(selection && surrounding);
      expect(results[1]!.includes("withheld by the reader's privacy settings")).toBe(!(selection && surrounding));
      f.thread.dispose();
    }
});

test("a withheld position does not open the reader's own chapter of a narrative book", async () => {
  const text = "CONTEXT BEFORE SELECTED PRIVATE VIEWPORT. UNREAD REMAINDER.";
  for (const disclosed of [true, false]) {
    const f = fixture({ selection: true, surrounding: disclosed });
    const book = (await f.deps.library.getBook("b1"))!;
    f.deps.library.getBook = async () => ({ ...book, status: "reading", narrativity: "narrative", spoilerSensitive: true });
    f.deps.bookText.getChapterText = async () => text;
    f.deps.bookText.locate = async () => ({
      start: { chapterIndex: 1, offset: 0 },
      end: { chapterIndex: 1, offset: text.indexOf(" UNREAD") },
    });
    let result = "";
    f.faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("read_chapter", { chapterIndex: 1 })], { stopReason: "toolUse" }),
      (ctx: Context) => {
        result = JSON.stringify(ctx.messages[ctx.messages.length - 1]);
        return fauxAssistantMessage("A typed answer.");
      },
    ]);
    await collect(
      hostTurn(f.stores.turns, f.thread, { text: "Typed question", readingCursor: { chapterIndex: 1, anchor: "viewport" } }),
    );
    await f.thread.flushBackgroundWork();
    // Reading up to the reader's page would hand over the surrounding text and where the reader is.
    expect(result.includes("CONTEXT BEFORE")).toBe(disclosed);
    expect(result.includes("readerPosition")).toBe(disclosed);
    expect(result.includes("beyond the reader's position or viewport boundary")).toBe(!disclosed);
    expect(result).not.toContain("UNREAD REMAINDER");
    f.thread.dispose();
  }
});

test("tightening between turns rebuilds cached context and filters hydrated selections", async () => {
  const f = fixture({ selection: true, surrounding: true });
  await collect(hostTurn(f.stores.turns, f.thread, f.input));
  await f.thread.flushBackgroundWork();
  f.policy.set({ selection: false, surrounding: false });
  await collect(
    hostTurn(f.stores.turns, f.thread, { text: "A new typed question", readingCursor: f.input.readingCursor }),
  );
  await f.thread.flushBackgroundWork();
  expect(f.prompts[1]).not.toContain("SELECTED PRIVATE");
  expect(f.prompts[1]).not.toContain("VIEWPORT");
  expect(f.prompts[1]).toContain("Typed question");
  f.thread.dispose();
});

test("mid-request off/on rejects late output; the next request can run", async () => {
  const f = fixture({ selection: true, surrounding: true });
  f.faux.setResponses([
    () => {
      f.policy.set({ selection: false, surrounding: true });
      f.policy.set({ selection: true, surrounding: true });
      return fauxAssistantMessage("LATE OUTPUT");
    },
    fauxAssistantMessage("Recovered"),
  ]);
  await expect(collect(hostTurn(f.stores.turns, f.thread, f.input))).rejects.toMatchObject({
    code: "ai/context-changed",
  });
  await collect(hostTurn(f.stores.turns, f.thread, { text: "New request" }));
  await f.thread.flushBackgroundWork();
  expect(JSON.stringify(f.stores.turns.get("book:b1"))).not.toContain("LATE OUTPUT");
  f.thread.dispose();
});

test("preparation failure releases busy state rather than wedging the thread", async () => {
  const f = fixture({ selection: false, surrounding: false });
  const read = f.deps.library.getBook;
  f.deps.library.getBook = async () => {
    throw Error("read failed");
  };
  await expect(collect(f.thread.sendTurn(f.input))).rejects.toThrow("read failed");
  f.deps.library.getBook = read;
  await collect(f.thread.sendTurn(f.input));
  await f.thread.flushBackgroundWork();
  expect(f.prompts).toHaveLength(1);
  f.thread.dispose();
});

test("history tools neither return nor match withheld selection attachments", async () => {
  const f = fixture({ selection: false, surrounding: true });
  f.stores.turns.set("book:b1", [
    { role: "user", content: "Typed question", createdAt: "now", attachments: f.input.attachments },
  ]);
  const tools = buildConversationTools({ kind: "book", bookId: "b1" }, f.deps);
  const recent = await tools.find((t) => t.name === "get_recent_turns")!.execute("recent", {});
  expect(JSON.stringify(recent)).toContain("Typed question");
  expect(JSON.stringify(recent)).not.toContain("SELECTED PRIVATE");
  const search = await tools
    .find((t) => t.name === "search_conversation")!
    .execute("search", { queries: ["SELECTED PRIVATE"] });
  expect(search.content).toEqual([{ type: "text", text: "[]" }]);
  f.thread.dispose();
});

test("revocation during preparation releases the turn before a hung read finishes", async () => {
  const f = fixture({ selection: true, surrounding: true });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const getBook = f.deps.library.getBook;
  f.deps.library.getBook = async (id) => {
    enter();
    await held;
    return getBook(id);
  };
  const running = collect(f.thread.sendTurn(f.input));
  await entered;
  f.policy.set({ selection: false, surrounding: true });
  await expect(running).rejects.toMatchObject({ code: "ai/context-changed" });
  expect(f.prompts).toHaveLength(0);
  f.deps.library.getBook = getBook;
  await collect(f.thread.sendTurn({ text: "New request" }));
  release();
  await f.thread.flushBackgroundWork();
  expect(f.prompts).toHaveLength(1);
  expect(f.policy.listeners()).toBe(0);
  f.thread.dispose();
});

test("history and viewport tools retain this turn's grants when settings expand", async () => {
  const f = fixture({ selection: false, surrounding: false });
  f.stores.turns.set("book:b1", [
    { role: "user", content: "Typed question", createdAt: "now", attachments: f.input.attachments },
  ]);
  const state = createAgentTurnState();
  state.readingContextPermissions = f.policy.snapshot();
  f.policy.set({ selection: true, surrounding: true });
  const tools = buildConversationTools({ kind: "book", bookId: "b1" }, f.deps, state);
  const recent = await tools.find((t) => t.name === "get_recent_turns")!.execute("recent", {});
  expect(JSON.stringify(recent)).not.toContain("SELECTED PRIVATE");
  const original = await f.deps.reader.getSession();
  f.deps.reader.getSession = async () => ({ ...original, bookId: "b1", visibleText: "SELECTED PRIVATE VIEWPORT" });
  const reader = buildReaderTools({ kind: "book", bookId: "b1" }, f.deps, state);
  const session = await reader.find((t) => t.name === "get_reading_session")!.execute("session", {});
  expect(JSON.stringify(session)).not.toContain("SELECTED PRIVATE");
  expect(JSON.stringify(session)).toContain("privacy settings");
  f.thread.dispose();
});

test("reading grant revocation cancels in-flight candidates and queued memory jobs", async () => {
  const f = fixture({ selection: true, surrounding: true });
  f.memory.set(true);
  f.stores.insights.set("book:b1", "existing");
  let enter!: () => void,
    release!: () => void,
    calls = 0;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.deps.extraMemoryCandidates = async () => {
    calls++;
    if (calls === 1) {
      enter();
      await held;
    }
    return [{ scope: "book:b1", kind: "insight", content: "A cancelled candidate" }];
  };
  await collect(f.thread.sendTurn(f.input));
  await entered;
  await collect(f.thread.sendTurn({ text: "Queued request" }));
  expect(f.policy.listeners()).toBe(2);
  f.policy.set({ selection: false, surrounding: true });
  f.policy.set({ selection: true, surrounding: true });
  await f.thread.flushBackgroundWork();
  release();
  await Promise.resolve();
  expect(calls).toBe(1);
  expect(f.stores.memories).toHaveLength(0);
  expect(f.stores.insights.get("book:b1")).toBe("existing");
  expect(f.policy.listeners()).toBe(0);
  f.thread.dispose();
});

test("global hydration and legacy adoption omit withheld attachments from model inputs", async () => {
  const f = fixture({ selection: false, surrounding: true });
  f.memory.set(true);
  f.stores.turns.set("global:privacy-test", [
    { role: "user", content: "Legacy typed question", createdAt: "now", attachments: f.input.attachments },
    { role: "assistant", content: "Legacy typed answer", createdAt: "now" },
  ]);
  const background: string[] = [];
  const thread = new AgentThread({
    scope: { kind: "global", threadId: "privacy-test" },
    deps: f.deps,
    resolveModel: () => f.faux.getModel() as Model<Api>,
    getApiKey: () => "test",
    streamFn: streamSimple,
    completeFn: async (_model, context) => {
      background.push(JSON.stringify(context));
      return fauxAssistantMessage('{"new":[],"reinforced":[]}');
    },
  });
  await collect(thread.sendTurn({ text: "New typed question" }));
  await thread.flushBackgroundWork();
  expect(f.prompts[0]).toContain("Legacy typed question");
  expect(f.prompts[0]).not.toContain("SELECTED PRIVATE");
  expect(background.some((input) => input.includes("Legacy typed question"))).toBe(true);
  expect(background.every((input) => !input.includes("SELECTED PRIVATE"))).toBe(true);
  expect(f.stores.turns.get("global:privacy-test")?.[0]?.attachments).toEqual(f.input.attachments);
  expect(f.policy.listeners()).toBe(0);
  thread.dispose();
  f.thread.dispose();
});

test("disposing during preparation aborts the turn and prevents a late model start", async () => {
  const f = fixture({ selection: true, surrounding: true });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = f.deps.library.getBook;
  f.deps.library.getBook = async (id) => {
    enter();
    await held;
    return read(id);
  };
  const running = collect(f.thread.sendTurn(f.input));
  await entered;
  f.thread.dispose();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  release();
  await Promise.resolve();
  expect(f.prompts).toHaveLength(0);
  expect(f.policy.listeners()).toBe(0);
});
