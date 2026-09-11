import { expect, test } from "bun:test";
import type { PluginCommand, PluginContext, PluginDetailView, PluginFormView, PluginListView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { profileView } from "../src/profile";
import { conversationSummary, conversationSummaries } from "../src/conversation-summaries";
import { textPage } from "../src/context-pagination";
import { contextWords } from "../src/context-strings";
import { booksView } from "../src/views";

const revision = `profile2:${"a".repeat(64)}`;
function fixture() {
  let summary: string | undefined = "Original profile", version = revision, insights: string | null = "Stored conversation summary";
  let readFailure = false, writeFailure = false, count = 41;
  const calls: unknown[] = [], writes: unknown[] = [];
  const ctx = { locale: "en", domains: {
    memory: { queries: { profile: async (q: { offset?: number; limit?: number; expectedRevision?: string } = {}) => {
      calls.push(q);
      if (readFailure) throw Object.assign(Error("private storage failure"), { code: "db/error" });
      if (q.expectedRevision && q.expectedRevision !== version) throw Object.assign(Error("stale"), { code: "memory/conflict" });
      const start = q.offset ?? 0, end = Math.min((summary ?? "").length, start + (q.limit ?? 4000));
      return { text: (summary ?? "").slice(start, end), exists: summary !== undefined, offset: start,
        nextOffset: end < (summary ?? "").length ? end : null, totalLength: (summary ?? "").length, revision: version,
        format: "plain-text", persistence: "event-log" };
    } }, commands: { updateProfile: async (input: { summary: string; expectedRevision: string }) => {
      if (input.expectedRevision !== version) throw Object.assign(Error("stale"), { code: "memory/conflict" });
      if (writeFailure) throw Object.assign(Error("disk"), { code: "db/error" });
      writes.push(input); const changed = summary !== input.summary; summary = input.summary;
      return { changed, revision: version, persistence: "event-log" };
    } } },
    conversations: { queries: {
      listThreads: async () => Array.from({ length: count }, (_, i) => ({ id: `t${i}`, title: `Thread ${i}` })),
      getInsights: async (target: unknown) => { calls.push(target); if (readFailure) throw Object.assign(Error("disk"), { code: "db/error" }); return insights; },
    } },
    library: { queries: { books: { list: async () => [{ id: "book", title: "Book" }] } } },
    reading: { commands: {} },
  } } as unknown as PluginContext;
  return { ctx, calls, writes, setSummary: (s: string | undefined) => { summary = s; },
    setVersion: () => { version = `profile2:${"b".repeat(64)}`; },
    setInsights: (s: string | null) => { insights = s; }, failRead: () => { readFailure = true; },
    failWrite: () => { writeFailure = true; }, setCount: (n: number) => { count = n; } };
}
async function action(view: PluginDetailView, id: string) { return (await view.actions!.find(a => a.id === id)!.run())!; }
const detail = (result: PluginViewResult) => result!.view as PluginDetailView;
async function editor(f: ReturnType<typeof fixture>) {
  return (await action(await profileView(f.ctx), "edit")).view as PluginFormView;
}

test("profile distinguishes absent and empty; read-only and oversized profiles cannot be edited", async () => {
  const f = fixture(); f.setSummary(undefined);
  expect((await profileView(f.ctx)).content[0]).toEqual({ kind: "text", text: "No profile yet" });
  f.setSummary(""); expect((await profileView(f.ctx)).content[0]).toEqual({ kind: "text", text: "Empty profile" });
  f.setSummary("x".repeat(16001)); expect((await profileView(f.ctx)).actions!.some(a => a.id === "edit")).toBe(false);
  f.setSummary("text"); f.ctx.domains.memory!.commands = undefined;
  expect((await profileView(f.ctx)).actions!.some(a => a.id === "edit")).toBe(false);
});

test("profile pagination pins the displayed version and supports fresh restart", async () => {
  const f = fixture(); f.setSummary("x".repeat(8001));
  const first = await profileView(f.ctx), second = detail(await action(first, "next"));
  expect(f.calls[f.calls.length - 1]).toEqual({ offset: 4000, limit: 4000, expectedRevision: revision });
  await action(second, "previous"); expect(f.calls[f.calls.length - 1]).toEqual({ offset: 0, limit: 4000, expectedRevision: revision });
  f.setVersion(); await expect(action(second, "next")).rejects.toMatchObject({ code: "memory/conflict" });
  await action(second, "refresh"); expect(f.calls[f.calls.length - 1]).toEqual({ offset: 0, limit: 4000, expectedRevision: undefined });
});

test("edit loads the full profile at the displayed revision, not just the first page", async () => {
  const f = fixture(); f.setSummary("x".repeat(9000));
  const form = await editor(f);
  expect(f.calls[f.calls.length - 1]).toEqual({ limit: 16000, expectedRevision: revision });
  expect(form.fields[0]).toHaveProperty("value", "x".repeat(9000));
  expect(await form.onSubmit({ summary: "x".repeat(16001), confirm: true })).toHaveProperty("fieldErrors.summary");
  expect(await form.onSubmit({ summary: "changed", confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(f.writes).toHaveLength(0);
});

test("confirmed blank clears the profile; write success does not depend on a subsequent read", async () => {
  const f = fixture(), form = await editor(f); f.failRead();
  expect(detail(await form.onSubmit({ summary: "", confirm: true })).content[0]).toEqual({ kind: "text", text: "Profile saved" });
  expect(f.writes).toEqual([{ summary: "", expectedRevision: revision }]);
  expect(f.calls).toHaveLength(2);
});

test("conflicts and database failures leave the original edit form and revision intact", async () => {
  const f = fixture(), form = await editor(f); f.setVersion();
  await expect(form.onSubmit({ summary: "changed", confirm: true })).rejects.toMatchObject({ code: "memory/conflict" });
  expect(form.fields[0]).toHaveProperty("value", "Original profile"); expect(f.writes).toHaveLength(0);
  const g = fixture(), other = await editor(g); g.failWrite();
  await expect(other.onSubmit({ summary: "changed", confirm: true })).rejects.toMatchObject({ code: "db/error" });
  expect(g.writes).toHaveLength(0);
});

test("profile read and edit-open conflicts propagate instead of empty states", async () => {
  const f = fixture(), view = await profileView(f.ctx); f.setVersion();
  await expect(action(view, "edit")).rejects.toMatchObject({ code: "memory/conflict" });
  f.failRead(); await expect(profileView(f.ctx)).rejects.toMatchObject({ code: "db/error" });
});

test("summary paging freezes one plain-text snapshot and preserves surrogate pairs", async () => {
  const f = fixture(); const text = "a".repeat(3999) + "\ud83d\ude00" + "<b>literal</b>";
  f.setInsights(text); const first = await conversationSummary(f.ctx, { kind: "global", id: "t" }, "Thread");
  f.setInsights("New summary"); const second = detail(await action(first, "next"));
  expect(first.content[0]).toEqual({ kind: "text", text: "a".repeat(3999) });
  expect(second.content[0]).toEqual({ kind: "text", text: "\ud83d\ude00<b>literal</b>" });
  expect(detail(await action(second, "previous")).content[0]).toEqual(first.content[0]);
  expect(f.calls).toHaveLength(1);
  expect(detail(await action(second, "refresh")).content[0]).toEqual({ kind: "text", text: "New summary" });
  expect(textPage("abc", 0)).toEqual({ text: "abc", nextOffset: null });
});

test("summary absence and failure are distinct and only explicit targets are read", async () => {
  const f = fixture(); f.setInsights(null);
  expect((await conversationSummary(f.ctx, { kind: "book", id: "book" }, "Book")).content[0]).toEqual({ kind: "text", text: "No stored summary" });
  f.setInsights(""); expect((await conversationSummary(f.ctx, { kind: "global", id: "t" }, "Thread")).content[0]).toEqual({ kind: "text", text: "Empty summary" });
  expect(f.calls).toEqual([{ kind: "book", id: "book" }, { kind: "global", id: "t" }]);
  f.failRead(); await expect(conversationSummary(f.ctx, { kind: "book", id: "book" }, "Book")).rejects.toMatchObject({ code: "db/error" });
});

test("thread pages clamp on deletion; book details route to their own summary", async () => {
  const f = fixture(), first = await conversationSummaries(f.ctx);
  expect(first.items).toHaveLength(40);
  const last = (await first.pagination!.onNext!())!.view as PluginListView;
  expect(last.items.map(i => i.id)).toEqual(["t40"]);
  await last.items[0]!.onSelect!(); expect(f.calls[f.calls.length - 1]).toEqual({ kind: "global", id: "t40" });
  f.setCount(0); expect((await conversationSummaries(f.ctx, 99)).items).toHaveLength(0);
  const book = (await (await booksView(f.ctx)).items[0]!.onSelect!())!.view as PluginListView;
  await book.items.find(i => i.id === "summary")!.onSelect!(); expect(f.calls[f.calls.length - 1]).toEqual({ kind: "book", id: "book" });
});

test("compiled command composes profile and summaries without writing or invoking inference", async () => {
  const f = fixture(); let run: (() => Promise<PluginViewResult>) | undefined;
  f.ctx.contributions = { commands: { register: (command: PluginCommand) => { run = command.run as typeof run; return { dispose() {} }; } },
    headerActions: { register: () => ({ dispose() {} }) } } as unknown as PluginContext["contributions"];
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  const root = (await run!())!.view as PluginListView;
  expect(root.items.map(i => i.id)).toEqual(["profile", "user", "global", "books", "conversations"]);
  const profile = (await root.items[0]!.onSelect!())!.view as PluginDetailView;
  expect(profile.content[0]).toEqual({ kind: "text", text: "Original profile" });
  const threads = (await root.items[4]!.onSelect!())!.view as PluginListView;
  await threads.items[0]!.onSelect!(); expect(f.calls[f.calls.length - 1]).toEqual({ kind: "global", id: "t0" });
  expect(f.writes).toHaveLength(0);
});

test("new vocabulary has explicit Chinese and complete English fallback", () => {
  expect(Object.keys(contextWords("zh-Hans"))).toEqual(Object.keys(contextWords("en")));
  for (const locale of ["zh-Hans", "en", "zh-Hant", "ja", "fr", "de", "es", "ru"]) {
    expect(Object.values(contextWords(locale)).every(Boolean)).toBe(true);
  }
});
