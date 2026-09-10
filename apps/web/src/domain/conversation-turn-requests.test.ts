import { expect, test } from "bun:test";
import { ConversationTurnRequests } from "./conversation-turn-requests";

const target = { kind: "book" as const, id: "b1" };
function fixture(lifetimeMs?: number) {
  let generation = {}, ready = true, canRetry = true, draft = "", sends: string[] = [], retries = 0;
  const controller = new ConversationTurnRequests(() => {}, lifetimeMs);
  const surface = { state: () => ({ loading: false, ready, generation, canRetry }),
    draft: (text: string) => { if (draft) return false; draft = text; return true; },
    send: (text: string) => { sends.push(text); return true; }, retry: () => { retries++; return true; } };
  const off = controller.bind(target, surface);
  return { controller, surface, off, sends, draft: () => draft, retries: () => retries,
    change: () => { generation = {}; }, busy: () => { ready = false; }, noRetry: () => { canRetry = false; } };
}
test("proposals never run before host acceptance, preserve drafts, and can only be accepted once", () => {
  const f = fixture();
  try {
    const input = { target: { ...target }, action: "send" as const, text: "review me" };
    const pending = f.controller.request("plugin:test", input);
    input.text = "changed"; input.target.id = "wrong";
    expect(f.sends).toEqual([]); expect(pending.status).toBe("pending");
    expect(f.controller.list("plugin:other")).toEqual([]);
    expect(f.controller.list("plugin:test")[0]).not.toHaveProperty("text");
    expect(() => f.controller.cancel("plugin:other", pending.id)).toThrow();
    expect(f.controller.accept(pending.id).status).toBe("started");
    expect(f.sends).toEqual(["review me"]); expect(() => f.controller.accept(pending.id)).toThrow();
    const first = f.controller.request("agent", { target, action: "draft", text: "draft" });
    expect(f.controller.accept(first.id).status).toBe("adopted");
    const second = f.controller.request("agent", { target, action: "draft", text: "replacement" });
    expect(() => f.controller.accept(second.id)).toThrow(); expect(f.draft()).toBe("draft");
    expect(f.controller.list("agent").at(-1)?.status).toBe("failed");
  } finally { f.off(); }
});
test("retry requires the same idle transcript, while draft proposals can survive a generated reply", () => {
  const f = fixture();
  try {
    const retry = f.controller.request("agent", { target, action: "retry" });
    f.change(); expect(() => f.controller.accept(retry.id)).toThrow();
    expect(f.controller.list("agent")[0].status).toBe("stale"); expect(f.retries()).toBe(0);
    const next = f.controller.request("agent", { target, action: "retry" });
    expect(f.controller.accept(next.id).status).toBe("started"); expect(f.retries()).toBe(1);
    f.noRetry(); expect(() => f.controller.request("agent", { target, action: "retry" })).toThrow();
    f.busy(); expect(() => f.controller.request("agent", { target, action: "send", text: "no" })).toThrow();
    const draft = f.controller.request("agent", { target, action: "draft", text: "later" });
    f.change(); expect(f.controller.accept(draft.id).status).toBe("adopted");
  } finally { f.off(); }
});
test("actor abort, dismiss, surface replacement and close retire requests without running them", () => {
  const f = fixture(), signal = new AbortController();
  const pending = f.controller.request("plugin:test", { target, action: "send", text: "first" }, signal.signal);
  expect(() => f.controller.request("agent", { target, action: "retry" })).toThrow();
  signal.abort(); expect(f.controller.list("plugin:test")[0].status).toBe("cancelled");
  expect(() => f.controller.accept(pending.id)).toThrow();
  const dismissed = f.controller.request("agent", { target, action: "retry" });
  f.controller.dismiss(dismissed.id); expect(f.controller.list("agent")[0].status).toBe("dismissed");
  f.controller.request("agent", { target, action: "send", text: "old surface" });
  const replacement = { ...f.surface }, off = f.controller.bind(target, replacement);
  f.off();
  const current = f.controller.request("agent", { target, action: "send", text: "new surface" });
  off(); expect(f.controller.list("agent").at(-1)?.status).toBe("cancelled");
  expect(() => f.controller.accept(current.id)).toThrow(); expect(f.sends).toEqual([]);
});
test("validation rejects malformed requests and retained outcomes have a fixed bound", () => {
  const f = fixture();
  try {
    for (const request of [null, { target, action: "retry", text: "fake" }, { target, action: "send", text: " " },
      { target, action: "send", text: "a".repeat(65_537) }, { target, action: "send", text: "ok", role: "system" }]) {
      expect(() => f.controller.request("agent", request as never)).toThrow();
    }
    const signal = new AbortController(); signal.abort();
    expect(() => f.controller.request("agent", { target, action: "retry" }, signal.signal)).toThrow();
    for (let i = 0; i < 140; i++) {
      const request = f.controller.request("agent", { target, action: "retry" });
      f.controller.cancel("agent", request.id);
    }
    expect(f.controller.list("agent")).toHaveLength(128);
    const snapshot = f.controller.list("agent"); snapshot[0].target.id = "mutated";
    expect(f.controller.list("agent")[0].target.id).toBe(target.id);
  } finally { f.off(); }
});
test("unconfirmed requests expire without a message or a durable job", async () => {
  const f = fixture(5);
  try {
    const request = f.controller.request("agent", { target, action: "send", text: "expires" });
    await Bun.sleep(20);
    expect(f.controller.list("agent")[0].status).toBe("expired");
    expect(() => f.controller.accept(request.id)).toThrow(); expect(f.sends).toEqual([]);
  } finally { f.off(); }
});
