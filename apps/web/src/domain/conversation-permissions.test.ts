import { afterEach, expect, test } from "bun:test";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";
import { conversationCommands, conversationSnapshot, conversationTurnRequests } from "./conversation-control";
import { selectGlobalThread } from "../features/ai/state/global-thread";
import { saveConversation, clearConversation } from "../features/ai/lib/conversation-store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function actor(permissions: PluginPermission[]) {
  const runtime = buildPluginContext({ id: "conversation-permissions", name: "Conversations", version: "1.0.0", schemaVersion: 1,
    requires: {}, permissions }, "0.5.4", []);
  runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop()); return runtime;
}
test("conversation reads, runtime observations and controls follow separate grants and retirement", async () => {
  expect(actor([]).context.domains.conversations).toBeUndefined();
  const read = actor(["conversations:read"]).context.domains.conversations!;
  expect(read.queries.runtime).toBeFunction(); expect(read.commands).toBeUndefined();
  expect(read.queries.turnRequests).toBeFunction();
  const snapshots: unknown[] = [], off = read.events.observeRuntime(snapshot => snapshots.push(snapshot));
  expect(snapshots).toHaveLength(1); off.dispose();
  const runtime = actor(["conversations:write"]), write = runtime.context.domains.conversations!;
  expect(write.commands?.createThread).toBeFunction(); expect(write.commands?.clear).toBeFunction();
  await expect(write.commands!.selectThread("not-a-global-thread")).rejects.toMatchObject({ code: "ui/invalid-target" });
  runtime.lifecycle.stop(); expect(() => write.commands!.createThread()).toThrow();
  expect(() => write.commands!.stop({ kind: "book", id: "b1" })).toThrow();
});

test("plugin turn proposals only expose actor-owned outcomes and retirement cancels pending confirmation", async () => {
  const target = { kind: "book" as const, id: "bound-book" }, generation = {};
  let sends = 0;
  cleanups.push(conversationTurnRequests.bind(target, {
    state: () => ({ loading: false, ready: true, generation, canRetry: true }),
    draft: () => true, send: () => { sends++; return true; }, retry: () => true,
  }));
  const runtime = actor(["conversations:write"]), domain = runtime.context.domains.conversations!;
  const request = await domain.commands!.requestTurn({ target, action: "send", text: "Please review before sending" });
  expect(request.status).toBe("pending"); expect(sends).toBe(0);
  expect((await domain.queries.turnRequests()).at(-1)).toMatchObject({ id: request.id, status: "pending" });
  expect(conversationTurnRequests.list("plugin:foreign")).toEqual([]);
  runtime.lifecycle.stop();
  expect(conversationTurnRequests.list("plugin:conversation-permissions").at(-1)?.status).toBe("cancelled");
  expect(() => conversationTurnRequests.accept(request.id)).toThrow(); expect(sends).toBe(0);
});

test("global drafts select durably, existing threads can be selected, and failed selection keeps the predecessor", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw Error("storage unavailable"); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const commands = conversationCommands("user");
  let firstId: string | undefined;
  try {
    const first = await commands.createThread(); firstId = first.target.id;
    expect(first.draft).toBe(true); expect(conversationSnapshot().selectedGlobalThreadId).toBe(firstId);
    expect(JSON.parse(values.get("read-aware-active-global-thread")!)).toBe(firstId);
    await saveConversation(firstId, [{ id: "u", role: "user", content: "test", createdAt: "2026-09-10T00:00:00Z" }]);
    const second = await commands.createThread(); expect(second.target.id).not.toBe(firstId);
    await commands.selectThread(firstId); expect(conversationSnapshot().selectedGlobalThreadId).toBe(firstId);
    fail = true;
    await expect(commands.createThread()).rejects.toThrow("storage unavailable");
    expect(conversationSnapshot().selectedGlobalThreadId).toBe(firstId);
  } finally {
    fail = false; if (firstId) await clearConversation(firstId);
    await selectGlobalThread("__global__");
    if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
