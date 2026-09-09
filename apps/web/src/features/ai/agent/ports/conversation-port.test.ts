import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { localKV } from "../../../../platform/local-store";
import { GLOBAL_CONVERSATION_ID } from "../../lib/conversation-store";
import { clearStoredConversationInsights, createConversationPort } from "./conversation-port";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const INSIGHTS_KEY = "read-aware-agent-insights";

beforeEach(() => storage.clear());
afterEach(() => { writeSpy?.mockRestore(); });
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
    writeSpy = spyOn(localKV, "setItemAsync").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    let settled = false;
    const pending = createConversationPort().putInsights("book:one", "pending summary");
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writeSpy).toHaveBeenCalledWith(INSIGHTS_KEY, JSON.stringify({ "book:one": "pending summary" }));
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
