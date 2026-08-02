import { beforeEach, describe, expect, test } from "bun:test";
import { GLOBAL_CONVERSATION_ID } from "../../lib/conversation-store";
import { clearStoredConversationInsights } from "./conversation-port";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const INSIGHTS_KEY = "read-aware-agent-insights";

beforeEach(() => storage.clear());

describe("conversation insights", () => {
  test("clear removes only the selected thread and the legacy global fallback", () => {
    storage.set(
      INSIGHTS_KEY,
      JSON.stringify({
        [`global:${GLOBAL_CONVERSATION_ID}`]: "current summary",
        global: "legacy summary",
        "book:book-1": "book summary",
      }),
    );

    clearStoredConversationInsights(`global:${GLOBAL_CONVERSATION_ID}`);

    expect(JSON.parse(storage.get(INSIGHTS_KEY) ?? "{}")).toEqual({
      "book:book-1": "book summary",
    });
  });
});
