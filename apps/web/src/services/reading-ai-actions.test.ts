import { expect, test } from "bun:test";
import { AppError, READING_AI_ACTIONS, type ReadingAiContext, type ReadingAiAction, type BookRangePage } from "@read-aware/core";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReadingAiActions } from "./reading-ai-actions";
import { readingAiPrompt } from "../features/ai/lib/reading-ai-prompts";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(timeout = 1000) {
  const session = new ReadingSessionController(() => {}).snapshot();
  Object.assign(session, { status: "ready", bookId: "book", sessionId: "session", sourceRevision: "source", location: { bookId: "book", contentVersion: "v1", href: "one.xhtml" },
    selection: { id: "selection", text: "Complete selected passage", textLength: 25, range: { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2:0,/4/2:25)" } } });
  session.selection!.textLength = session.selection!.text.length;
  const preferences = { features: { explainSelection: true, defineTerm: true, translate: true, summarizeChapter: true, askConversation: false },
    sendHighlightedText: true, sendSurroundingContext: true, localOnly: false };
  const listeners = new Set<() => void>(), reads: unknown[] = [], opened: string[] = [];
  const controls = { beforeOpen: async () => {}, beforeChapter: async () => {}, chapterIndex: 2 as number | undefined,
    page: async (offset: number): Promise<BookRangePage> => ({ range: session.selection!.range!, offset, sectionIndex: 0, totalLength: 8,
      text: offset ? "5678" : "1234", nextOffset: offset ? null : 4, context: { before: "", after: "" } }) };
  const service = new ReadingAiActions({ preferences: () => preferences, snapshot: () => session,
    readRange: async query => { reads.push(query); return controls.page(query.offset ?? 0); },
    chapter: async (bookId, href) => { reads.push({ bookId, href }); await controls.beforeChapter(); return controls.chapterIndex; },
    prompt: (action, index) => readingAiPrompt("en", action, index),
    openChat: async (bookId, sessionId) => { opened.push(`${bookId}:${sessionId}`); await controls.beforeOpen(); },
    observe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  }, timeout);
  return { service, controls, preferences, session, reads, opened, listeners, changed: () => { for (const listener of listeners) listener(); } };
}

test("all four actions preserve intent and exact captured target, independent of conversational Q&A", async () => {
  const f = fixture(), received: ReadingAiContext[] = [];
  const stop = f.service.bind("book", { send: context => { received.push(context); return "started"; } });
  for (const action of READING_AI_ACTIONS) {
    expect(await f.service.run(action)).toEqual({ status: "started", action, bookId: "book" });
    const context = received.at(-1)!;
    expect(context.action).toBe(action);
    if (action === "summarizeChapter") { expect(context.prompt).toContain("chapter 3"); expect(context.selection).toBeUndefined(); }
    else expect(context.selection).toEqual({ text: f.session.selection!.text, cfiRange: f.session.selection!.range!.cfi, chapterHref: "one.xhtml" });
    expect(f.listeners.size).toBe(0);
  }
  expect(new Set(received.map(context => context.prompt)).size).toBe(4); expect(f.opened).toHaveLength(4); stop();
  const inBook = await f.service.run("explainSelection", "book");
  expect(inBook).toMatchObject({ status: "context", context: { action: "explainSelection" } });
  expect(received).toHaveLength(4);
  await expect(f.service.run("explainSelection", "other")).rejects.toMatchObject({ code: "reader/superseded" });
});

test("disabled features and privacy gates reject retained invocations before reads or opening chat", async () => {
  const f = fixture();
  for (const action of READING_AI_ACTIONS) {
    f.preferences.features[action] = false;
    expect(f.service.enabled()).not.toContain(action);
    await expect(f.service.run(action, "book")).rejects.toMatchObject({ code: "ui/unavailable" });
    f.preferences.features[action] = true;
  }
  f.preferences.localOnly = true; await expect(f.service.run("translate")).rejects.toMatchObject({ code: "ai/local-only" });
  f.preferences.localOnly = false; f.preferences.sendHighlightedText = false;
  for (const action of ["explainSelection", "defineTerm", "translate"] as ReadingAiAction[]) await expect(f.service.run(action)).rejects.toMatchObject({ code: "ai/context-withheld" });
  f.preferences.sendSurroundingContext = false; await expect(f.service.run("summarizeChapter")).rejects.toMatchObject({ code: "ai/context-withheld" });
  await expect(f.service.run("invented" as ReadingAiAction)).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(f.reads).toHaveLength(0); expect(f.opened).toHaveLength(0); expect(f.listeners.size).toBe(0);
});

test("complete selection pages are assembled, never silently replaced by a preview or mixed range", async () => {
  const f = fixture(); f.session.selection!.text = "12"; f.session.selection!.textLength = 8;
  expect(await f.service.run("translate", "book")).toMatchObject({ context: { selection: { text: "12345678" } } });
  expect(f.reads).toHaveLength(2);
  const good = f.controls.page;
  for (const patch of [{ nextOffset: 0 }, { range: { bookId: "foreign", contentVersion: "v1", cfi: "other" } }, { totalLength: 40_000 }, { offset: 5 }, { nextOffset: null }]) {
    f.controls.page = async offset => ({ ...await good(offset), ...patch });
    await expect(f.service.run("translate", "book")).rejects.toMatchObject({ code: "reader/invalid-target" });
  }
  f.session.selection!.range = null;
  await expect(f.service.run("translate", "book")).rejects.toMatchObject({ code: "reader/invalid-target" });
  f.session.selection!.textLength = 40_000;
  await expect(f.service.run("translate", "book")).rejects.toMatchObject({ code: "reader/invalid-target" });
  expect(f.opened).toHaveLength(1);
});

test("source, selection, chapter and off/on changes during asynchronous preparation permanently invalidate that invocation", async () => {
  for (const kind of ["source", "selection", "chapter", "feature", "privacy"]) {
    const f = fixture(), gate = deferred(), entered = deferred();
    f.controls.beforeOpen = async () => { entered.resolve(); await gate.promise; };
    const pending = f.service.run(kind === "chapter" ? "summarizeChapter" : "explainSelection", "book");
    await entered.promise;
    if (kind === "source") f.session.sourceRevision = "changed";
    if (kind === "selection") f.session.selection!.id = "changed";
    if (kind === "chapter") f.session.location!.href = "next.xhtml";
    if (kind === "feature") f.preferences.features.explainSelection = false;
    if (kind === "privacy") f.preferences.sendHighlightedText = false;
    f.changed(); f.preferences.features.explainSelection = true; f.preferences.sendHighlightedText = true; f.changed();
    gate.resolve(); await expect(pending).rejects.toBeDefined(); expect(f.listeners.size).toBe(0);
  }
});

test("loading waits for the mounted chat; busy, retirement, timeout and cancellation never send later", async () => {
  const f = fixture(30), received: ReadingAiContext[] = []; let state: "loading" | "busy" | "started" = "loading";
  let stop = f.service.bind("book", { send: context => { if (state === "started") received.push(context); return state; } });
  const pending = f.service.run("defineTerm"); await Bun.sleep(1);
  await expect(f.service.run("translate")).rejects.toMatchObject({ code: "ui/unavailable" });
  state = "started"; f.service.flush("book"); expect(await pending).toMatchObject({ status: "started" });
  expect(received).toHaveLength(1);
  state = "busy"; await expect(f.service.run("translate")).rejects.toMatchObject({ code: "ui/unavailable" });
  state = "loading"; const controller = new AbortController(), cancelled = f.service.run("translate", undefined, controller.signal);
  await Bun.sleep(1); controller.abort(); await expect(cancelled).rejects.toBeDefined();
  state = "started"; f.service.flush("book"); expect(received).toHaveLength(1);
  state = "loading"; const retired = f.service.run("translate"); await Bun.sleep(1); stop();
  await expect(retired).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(f.service.run("translate")).rejects.toMatchObject({ code: "ui/unavailable" });
  stop = f.service.bind("book", { send: () => { throw new AppError("db/locked", "private"); } });
  await expect(f.service.run("translate")).rejects.toMatchObject({ code: "db/locked" }); stop();
  expect(f.listeners.size).toBe(0);
});

test("reentrant delivery is at most once and a real accepted send wins over cancellation inside its callback", async () => {
  const f = fixture(), controller = new AbortController(); let calls = 0;
  const stop = f.service.bind("book", { send: () => { calls++; f.service.flush("book"); controller.abort(); return "started"; } });
  try { expect(await f.service.run("translate", undefined, controller.signal)).toMatchObject({ status: "started" }); expect(calls).toBe(1); }
  finally { stop(); }
});

test("localized intents cover every supported locale and keep extracted chapter numbering explicit", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "es", "fr", "ru"]) {
    for (const action of READING_AI_ACTIONS) expect(readingAiPrompt(locale, action, 6)).toBeTruthy();
    expect(readingAiPrompt(locale, "summarizeChapter", 6)).toContain("7");
  }
  expect(readingAiPrompt("fr-FR", "translate")).toBe(readingAiPrompt("fr", "translate"));
});
