import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginFormView, PluginHeaderAction, PluginListView, PluginModule, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { conversationControls } from "../src/conversation-controls";
import { conversationSummaries } from "../src/conversation-summaries";
import { turnRequestsView } from "../src/turn-requests";
import { ConversationTurnRequests } from "../../../apps/web/src/domain/conversation-turn-requests";

const target = { kind: "global" as const, id: "thread-test" };
function fixture() {
  const runtime = { revision: 1, selectedGlobalThreadId: target.id, sessions: [{ ...target, sessionId: "session", loading: false, streaming: false, messageCount: 2 }] };
  const requests = new ConversationTurnRequests(() => {});
  let sends = 0, drafts = 0, retries = 0, disposed = 0;
  const generation = {};
  const unbind = requests.bind(target, { state: () => ({ loading: false, ready: true, generation, canRetry: true }),
    send: () => { sends++; return true; }, draft: () => { drafts++; return true; }, retry: () => { retries++; return true; } });
  const writes: unknown[] = [], frames: PluginView[] = [];
  let handler: (state: typeof runtime) => unknown = () => {};
  const ctx = { locale: "en", domains: { conversations: {
    queries: { runtime: async () => runtime, listThreads: async () => [{ id: target.id, title: "Thread" }],
      turnRequests: async () => requests.list("plugin:memory-desk") },
    commands: {
      requestTurn: async (request: Parameters<ConversationTurnRequests["request"]>[1]) => requests.request("plugin:memory-desk", request),
      cancelTurnRequest: async (id: string) => requests.cancel("plugin:memory-desk", id),
      createThread: async () => { writes.push("create"); return { target: { kind: "global", id: "thread-new" }, status: "completed", draft: true }; },
      selectThread: async (id: string) => { writes.push({ select: id }); return { target: { kind: "global", id }, status: "completed" }; },
      stop: async (t: typeof target) => { writes.push({ stop: t }); return { target: t, status: "completed" }; },
      clear: async (t: typeof target) => { writes.push({ clear: t }); return { target: t, status: "completed" }; },
    }, events: { observeRuntime: (next: typeof handler) => { handler = next; return { dispose() { disposed++; } }; } },
  } }, services: { ui: { publishView: async (_channel: unknown, update: { view: PluginView }) => { frames.push(update.view); } } } } as unknown as PluginContext;
  return { ctx, runtime, requests, writes, frames, update: () => handler(runtime), disposeCount: () => disposed,
    counts: () => ({ sends, drafts, retries }), cleanup: unbind };
}
const detail = (v: PluginView) => v as PluginDetailView;
async function action(view: PluginView, id: string) { return (await detail(view).actions!.find(a => a.id === id)!.run())!; }
const view = (r: PluginViewResult) => r!.view!;

test("draft/send/retry are real host proposals; closing the plugin does not approve or fake completion", async () => {
  const f = fixture();
  try {
    const controls = await conversationControls(f.ctx, target, "Thread");
    for (const operation of ["draft", "send", "retry"] as const) {
      const form = view(await action(controls, operation)) as PluginFormView;
      expect(await form.onSubmit(operation === "retry" ? { confirm: false } : { text: " " })).toHaveProperty("fieldErrors");
      if (operation !== "retry") expect(await form.onSubmit({ text: "a".repeat(65537) })).toHaveProperty("fieldErrors.text");
      const before = f.counts();
      expect(await form.onSubmit(operation === "retry" ? { confirm: true } : { text: "Question" })).toEqual({ close: true, toast: "Awaiting host confirmation" });
      expect(f.counts()).toEqual(before);
      const pending = f.requests.pending(target.id)!;
      expect(pending.action).toBe(operation);
      if (operation === "retry") expect(pending.text).toBeUndefined();
      f.requests.accept(pending.id);
    }
    expect(f.counts()).toEqual({ sends: 1, drafts: 1, retries: 1 });
    expect(f.writes).toHaveLength(0);
  } finally { f.cleanup(); }
});

test("request failures retain the form, and active runtime changes update action availability", async () => {
  const f = fixture();
  try {
    const controls = await conversationControls(f.ctx, target, "Thread");
    const form = view(await action(controls, "send")) as PluginFormView;
    const subscription = await controls.live!.subscribe({ id: "live" });
    f.runtime.sessions[0]!.streaming = true; await f.update();
    expect(detail(f.frames[0]!).actions!.some(a => a.id === "send")).toBe(false);
    f.runtime.sessions = []; await f.update();
    expect(JSON.stringify(f.frames[1])).toContain("Not mounted");
    subscription.dispose(); await f.update(); expect(f.frames).toHaveLength(2); expect(f.disposeCount()).toBe(1);
    f.cleanup(); await expect(form.onSubmit({ text: "Question" })).rejects.toMatchObject({ code: "ui/unavailable" });
    expect(f.counts()).toEqual({ sends: 0, drafts: 0, retries: 0 });
  } finally { f.cleanup(); }
});

test("clear requires confirmation, freezes the displayed target and propagates failure", async () => {
  const f = fixture(), input = { ...target };
  try {
    const controls = await conversationControls(f.ctx, input, "Thread"), form = view(await action(controls, "clear")) as PluginFormView;
    expect(form.fields[0]).toMatchObject({ description: "global:thread-test", value: false });
    expect(await form.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm"); expect(f.writes).toHaveLength(0);
    input.id = "thread-other";
    await form.onSubmit({ confirm: true }); expect(f.writes).toEqual([{ clear: target }]);
    f.ctx.domains.conversations!.commands!.clear = async () => { throw Object.assign(Error("disk failure"), { code: "db/error" }); };
    await expect(form.onSubmit({ confirm: true })).rejects.toMatchObject({ code: "db/error" });
  } finally { f.cleanup(); }
});

test("stop waits for its actual receipt and success does not depend on another runtime read", async () => {
  const f = fixture();
  try {
    const controls = await conversationControls(f.ctx, target, "Thread");
    let release!: () => void, settled = false;
    f.ctx.domains.conversations!.commands!.stop = async () => {
      await new Promise<void>(resolve => { release = resolve; }); return { target, status: "completed" };
    };
    f.ctx.domains.conversations!.queries.runtime = async () => { throw Error("later read failed"); };
    const pending = action(controls, "stop").then(r => { settled = true; return r; });
    await Promise.resolve(); expect(settled).toBe(false); release();
    expect(detail(view(await pending)).content[0]).toEqual({ kind: "text", text: "Stop completed" });
  } finally { f.cleanup(); }
});

test("cancelling an already accepted request reports started, never cancelled", async () => {
  const f = fixture();
  try {
    const request = f.requests.request("plugin:memory-desk", { action: "send", target, text: "Question" });
    const list = await turnRequestsView(f.ctx, target);
    const current = view(await list.items[0]!.onSelect!());
    f.requests.accept(request.id);
    const result = detail(view(await action(current, "cancel")));
    expect(JSON.stringify(result.content)).toContain("Turn started");
    expect(result.actions!.some(a => a.id === "cancel")).toBe(false);
    expect(f.counts().sends).toBe(1);
  } finally { f.cleanup(); }
});

test("new/select use returned identities and do not navigate or claim a transcript was created", async () => {
  const f = fixture();
  try {
    const list = await conversationSummaries(f.ctx);
    const fresh = detail(view(await action(list, "new")));
    expect(fresh.content[0]).toEqual({ kind: "text", text: "New draft selected" });
    expect(JSON.stringify(fresh.content)).toContain("global:thread-new");
    const controls = await conversationControls(f.ctx, target, "Thread");
    await action(controls, "select"); expect(f.writes).toEqual(["create", { select: "thread-test" }]);
    f.ctx.domains.conversations!.commands = undefined;
    expect(detail(await conversationControls(f.ctx, target, "Thread")).actions!.map(a => a.id)).toEqual(["refresh", "requests"]);
    expect((await conversationSummaries(f.ctx)).actions!.some(a => a.id === "new")).toBe(false);
  } finally { f.cleanup(); }
});

test("retained requests are paged, scoped and do not fetch transcript text", async () => {
  const f = fixture();
  try {
    f.ctx.domains.conversations!.queries.turnRequests = async () => Array.from({ length: 43 }, (_, i) => ({
      id: String(i), target: i === 42 ? { kind: "book", id: "book" } : target, action: "send", status: "expired", createdAt: i,
    }));
    const first = await turnRequestsView(f.ctx, target); expect(first.items).toHaveLength(40);
    const last = view(await first.pagination!.onNext!()) as PluginListView; expect(last.items).toHaveLength(2);
    expect(last.items.map(i => i.id)).toEqual(["1", "0"]);
    f.ctx.domains.conversations!.queries.turnRequests = async () => [];
    expect((await turnRequestsView(f.ctx, target, 9)).items).toHaveLength(0);
  } finally { f.cleanup(); }
});

test("compiled command routes from summaries to a host-owned pending send", async () => {
  const f = fixture();
  try {
    let run!: () => Promise<PluginViewResult>;
    const headers: PluginHeaderAction[] = [];
    Object.assign(f.ctx.domains, { memory: {}, library: {}, reading: { commands: {} } });
    Object.assign(f.ctx, { contributions: { commands: { register: (c: { run: typeof run }) => { run = c.run; return { dispose() {} }; } },
      headerActions: { register: (header: PluginHeaderAction) => { headers.push(header); return { dispose() {} }; } } } });
    const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
    await plugin.activate(f.ctx);
    expect(headers.map(h => h.surface)).toEqual(["shelf", "reader", "agent"]);
    const headerView = await headers[2]!.view({ thread: target });
    expect(JSON.stringify(detail(headerView).content)).toContain("global:thread-test");
    const root = view(await run()) as PluginListView;
    const summaries = view(await root.items.find(i => i.id === "conversations")!.onSelect!());
    const controls = view(await action(summaries, "current"));
    const form = view(await action(controls, "send")) as PluginFormView;
    expect(await form.onSubmit({ text: "Compiled request" })).toEqual({ close: true, toast: "Awaiting host confirmation" });
    expect(f.requests.pending(target.id)?.text).toBe("Compiled request");
    expect(f.counts().sends).toBe(0);
  } finally { f.cleanup(); }
});
