import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { installFileGlobals, memoryStorage } from "../../../../../tests/helpers/file-globals";
import { localKV } from "../../../../platform/local-store";
import {
  clearConversation,
  GLOBAL_CONVERSATION_ID,
  listGlobalThreads,
  saveConversation,
} from "../../lib/conversation-store";
import { clearStoredConversationInsights, createConversationPort } from "./conversation-port";

const storage = new Map<string, string>();
installFileGlobals({ localStorage: memoryStorage(storage) });

const INSIGHTS_KEY = "read-aware-agent-insights";

beforeEach(() => storage.clear());
afterEach(() => {
  writeSpy?.mockRestore();
});
let writeSpy: ReturnType<typeof spyOn<typeof localKV, "setItemAsync">> | undefined;

describe("conversation insights", () => {
  test("clear removes only the selected thread and the legacy global fallback", async () => {
    storage.set(
      INSIGHTS_KEY,
      JSON.stringify({
        [`global:${GLOBAL_CONVERSATION_ID}`]: "current summary",
        global: "legacy summary",
        "book:book-1": "book summary",
      }),
    );

    await clearStoredConversationInsights(`global:${GLOBAL_CONVERSATION_ID}`);

    expect(JSON.parse(storage.get(INSIGHTS_KEY) ?? "{}")).toEqual({
      "book:book-1": "book summary",
    });
  });

  test("summary writes wait for persistence and propagate its failure", async () => {
    let reject!: (error: Error) => void;
    writeSpy = spyOn(localKV, "setItemAsync").mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    let settled = false;
    const pending = createConversationPort().putInsights("book:one", "pending summary");
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writeSpy).toHaveBeenCalledWith(INSIGHTS_KEY, JSON.stringify({ "book:one": "pending summary" }), "agent");
    reject(new Error("persistence rejected"));
    await expect(pending).rejects.toThrow("persistence rejected");
  });

  test("clearing insights propagates persistence failure rather than acknowledging deletion", async () => {
    storage.set(INSIGHTS_KEY, JSON.stringify({ "book:one": "retained" }));
    writeSpy = spyOn(localKV, "setItemAsync").mockRejectedValue(new Error("persistence rejected"));
    await expect(createConversationPort().clearInsights!("book:one")).rejects.toThrow("persistence rejected");
    expect(await createConversationPort().getInsights("book:one")).toBe("retained");
  });
});

describe("thread titles", () => {
  const message = (id: string, role: "user" | "assistant", content: string, extra: object = {}) => ({
    id,
    role,
    content,
    createdAt: "2026-11-16T10:00:00.000Z",
    ...extra,
  });

  test("an untitled global thread is offered with its first question; once titled it is not offered again", async () => {
    const port = createConversationPort();
    await saveConversation("thread-port-a", [
      message("a0", "user", "", { attachments: [{ kind: "image", cacheKey: "k", name: "photo" }] }),
      message("a1", "user", "What is Pale Fire about?"),
      message("a2", "assistant", "A poem and its commentary."),
    ]);
    await saveConversation("book-port", [message("k1", "user", "A question about the book")]);

    const offered = (await port.untitledThreads({ limit: 10 })).filter((t) => t.threadKey === "global:thread-port-a");
    expect(offered).toEqual([
      {
        threadKey: "global:thread-port-a",
        messageId: "a1",
        userText: "What is Pale Fire about?",
        assistantText: "A poem and its commentary.",
      },
    ]);
    expect((await port.untitledThreads({ limit: 10 })).some((t) => t.threadKey.startsWith("book:"))).toBe(false);

    await port.titleThread("global:thread-port-a", "Pale Fire", "a1");
    expect((await listGlobalThreads()).find((t) => t.id === "thread-port-a")?.title).toBe("Pale Fire");
    expect(await port.untitledThreads({ limit: 10, threadKey: "global:thread-port-a" })).toEqual([]);

    // A clear forgets the title with the transcript.
    await clearConversation("thread-port-a");
    await saveConversation("thread-port-a", [message("n1", "user", "Something new")]);
    expect(await port.untitledThreads({ limit: 10, threadKey: "global:thread-port-a" })).toEqual([
      { threadKey: "global:thread-port-a", messageId: "n1", userText: "Something new", assistantText: undefined },
    ]);
  });

  test("a title for a book thread, a blank title or a missing source message is refused", async () => {
    const port = createConversationPort();
    await saveConversation("thread-port-b", [message("b1", "user", "Hello")]);
    await expect(port.titleThread("book:b1", "Title", "b1")).rejects.toThrow();
    await expect(port.titleThread("global:thread-port-b", "   ", "b1")).rejects.toThrow();
    await port.titleThread("global:thread-port-b", "Late", "gone");
    expect((await listGlobalThreads()).find((t) => t.id === "thread-port-b")?.title).toBeUndefined();
  });
});
