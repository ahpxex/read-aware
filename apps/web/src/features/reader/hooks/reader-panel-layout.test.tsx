import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { getDefaultStore } from "jotai";
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { LocalWriteFailureToasts } from "../../../components/LocalWriteFailureToasts";
import { initI18n } from "../../../i18n";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerPanels } from "../../../services/reader-panels";
import { flushLocalKV, localKV } from "../../../platform/local-store";
import { getReaderPanelLayout, updateReaderPanelLayout } from "../lib/reader-panel-layout";
import { useReaderControls } from "./useReaderControls";
import { useReaderPanels } from "./useReaderPanels";
import { readerPanelAcknowledgementsAtom, readerPanelIntentAtom } from "../state/panel-intent";
import { askAiRequestAtom } from "../../ai/state/chat-intent";

const key = "read-aware-reader-panels";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

if (process.env.PANEL_LAYOUT_CASE === "1") {
  const begin = <T,>(operation: () => Promise<T>): Promise<T> => {
    let promise!: Promise<T>;
    act(() => { promise = operation(); });
    return promise;
  };
  const command = readerPanels.setPanel.bind(readerPanels);
  const requestPanel = (...args: Parameters<typeof command>) => begin(() => command(...args));
  let dom: JSDOM, root: Root, state: ReturnType<typeof useReaderPanels>;
  let globals: Map<string, PropertyDescriptor | undefined>;
  const disk = new Map<string, string>();
  const pending: { value: string; commit(): void; reject(error: unknown): void }[] = [];
  let hold = false, sessionId: string;
  function open(bookId: string) {
    sessionId = readingRuntime.begin(bookId);
    const at = { bookId, contentVersion: "v1", cfi: "start" };
    readingRuntime.attach(sessionId, { navigate: async () => at, step: async () => at }, at);
  }
  function Harness({ bookId, exclusive }: { bookId: string; exclusive: boolean }) {
    const controls = useReaderControls();
    state = useReaderPanels(bookId, controls.visible, exclusive);
    useLayoutEffect(() => readingRuntime.bindControls(sessionId, controls.controls), [bookId, controls.controls]);
    return <><section aria-label="toc" inert={!(controls.visible && state.toc)} /><section aria-label="chat" inert={!(controls.visible && state.chat)} />
      {state.appearance && <div role="dialog">Appearance</div>}{state.annotations && <div role="dialog">Annotations</div>}</>;
  }
  const render = (bookId = "book", exclusive = false) => root.render(<StrictMode><ToastProvider><LocalWriteFailureToasts /><Harness bookId={bookId} exclusive={exclusive} /></ToastProvider></StrictMode>);
  const flush = async () => { await act(async () => { await tick(); }); };
  beforeEach(async () => {
    await initI18n("en");
    dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    globals = new Map(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke(command: string, args: { key: string; value: string }) {
      if (command !== "set_kv") return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const commit = () => { disk.set(args.key, args.value); resolve(); };
        if (hold && args.key === key) pending.push({ value: args.value, commit, reject }); else commit();
      });
    } } });
    hold = false;
    getDefaultStore().set(readerPanelIntentAtom, null);
    getDefaultStore().set(readerPanelAcknowledgementsAtom, { panel: null, ask: null });
    getDefaultStore().set(askAiRequestAtom, null);
    await localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: false, notesOpen: false }, other: { tocOpen: true, notesOpen: true } }));
    open("book"); root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { render(); await tick(); }); hold = true;
  });
  afterEach(async () => {
    hold = false;
    await act(async () => { root.unmount(); readingRuntime.closed(); for (const write of pending.splice(0)) write.commit(); await flushLocalKV(); await tick(); });
    dom.window.close();
    for (const [name, value] of globals) {
      if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
    }
  });

  test("real hook reveals chrome, mirrors optimistic state, then acknowledges durable DOM completion", async () => {
    let settled = false;
    const promise = requestPanel("toc", true).then(value => { settled = true; return value; });
    await flush(); expect(pending).toHaveLength(1); expect(state.toc).toBe(true); expect(settled).toBe(false);
    expect(JSON.parse(disk.get(key)!).book.tocOpen).toBe(false);
    await act(async () => { pending.shift()!.commit(); await tick(); });
    expect((await promise).snapshot.panels.toc).toEqual({ open: true, visible: true });
    expect(dom.window.document.querySelector('[aria-label="toc"]')!.hasAttribute("inert")).toBe(false);
  });
  test("failed native write rolls back and yields one translated notice plus the exact error code", async () => {
    const request = requestPanel("toc", true).catch(error => error); await flush();
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "RAW private database failure" }); await tick(); });
    expect(await request).toMatchObject({ code: "db/locked" }); expect(state.toc).toBe(false);
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(dom.window.document.querySelector('[role="status"]')!.textContent).toContain("Change not saved");
    expect(dom.window.document.body.textContent).not.toContain("RAW private");
    hold = false; const retry = requestPanel("toc", true); await flush(); await retry; expect(state.toc).toBe(true);
  });
  test("new intent cancels the older caller without undoing its already dispatched durable write", async () => {
    const first = requestPanel("toc", true).catch(error => error); await flush();
    const second = requestPanel("chat", true); await flush(); expect(pending).toHaveLength(1);
    expect(await first).toMatchObject({ code: "reader/superseded" });
    await act(async () => { pending.shift()!.commit(); await tick(); });
    expect(pending).toHaveLength(1); expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: true, notesOpen: true });
    await act(async () => { pending.shift()!.commit(); await tick(); }); await second;
    expect(state.chatFocusRequestId).toBe(1); expect(JSON.parse(disk.get(key)!).other).toEqual({ tocOpen: true, notesOpen: true });
  });
  test("new intent reads a failed predecessor's rollback instead of its optimistic sibling field", async () => {
    const first = requestPanel("toc", true).catch(error => error); await flush();
    const second = requestPanel("chat", true); await flush();
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "rejected" }); await tick(); });
    await first; expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: false, notesOpen: true });
    await act(async () => { pending.shift()!.commit(); await tick(); }); await second;
    expect(state.toc).toBe(false); expect(state.chat).toBe(true);
  });
  test("exclusive pane switch uses one durable write and failure restores both fields", async () => {
    hold = false; const first = requestPanel("toc", true); await flush(); await first;
    await act(async () => { render("book", true); }); hold = true;
    const request = requestPanel("chat", true).catch(error => error); await flush();
    expect(pending).toHaveLength(1); expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: false, notesOpen: true });
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "switch failed" }); await tick(); }); await request;
    expect(state.toc).toBe(true); expect(state.chat).toBe(false); expect(state.chatFocusRequestId).toBe(0);
  });
  test("external writes and rollback mirror to React and the public snapshot without write echo", async () => {
    let external!: Promise<unknown>;
    await act(async () => { external = localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: true, notesOpen: true } })).catch(e => e); await tick(); });
    expect(state.toc).toBe(true); expect(readerPanels.snapshot()?.panels.chat.open).toBe(true);
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "external failed" }); await tick(); }); await external;
    expect(state.toc).toBe(false); expect(state.chat).toBe(false); expect(pending).toHaveLength(0);
  });
  test("book replacement cancels queued old-owner writes and never exposes old transient panels", async () => {
    const appearance = requestPanel("appearance", true); await flush(); await appearance; expect(state.appearance).toBe(true);
    const blocker = begin(() => localKV.setItemAsync(key, disk.get(key)!));
    const old = requestPanel("chat", true).catch(error => error); await flush();
    await act(async () => { open("other"); render("other"); await tick(); });
    expect(await old).toMatchObject({ code: "reader/superseded" }); expect(state.appearance).toBe(false);
    expect(state.toc).toBe(true); expect(state.chat).toBe(true); expect(readerPanels.snapshot()?.bookId).toBe("other");
    await act(async () => { pending.shift()!.commit(); await tick(); }); await blocker;
    expect(pending).toHaveLength(0); expect(JSON.parse(disk.get(key)!).book.notesOpen).toBe(false);
  });
  test("transient panels do not persist and hiding chrome closes them without clearing dock preferences", async () => {
    hold = false; const toc = requestPanel("toc", true); await flush(); await toc;
    for (const panel of ["annotations", "appearance"] as const) { const p = requestPanel(panel, true); await flush(); await p; }
    const before = disk.get(key); const hide = begin(() => readingRuntime.setControls(false)); await flush(); await hide;
    expect(state.appearance).toBe(false); expect(state.annotations).toBe(false); expect(state.toc).toBe(true);
    expect(readerPanels.snapshot()?.panels.toc).toEqual({ open: true, visible: false }); expect(disk.get(key)).toBe(before);
  });
  test("same-value requests skip persistence and helper parsing defends malformed legacy values", async () => {
    const same = requestPanel("toc", false); await flush(); await same; expect(pending).toHaveLength(0);
    await expect(updateReaderPanelLayout("book", p => ({ ...p, tocOpen: "yes" as unknown as boolean }))).rejects.toMatchObject({ code: "reader/invalid-target" });
    for (const raw of ["[]", "invalid", "{}"] ) expect(getReaderPanelLayout("toString", raw)).toEqual({ tocOpen: false, notesOpen: false });
  });
  test("simultaneous host writers preserve independent book records", async () => {
    const first = updateReaderPanelLayout("book", p => ({ ...p, tocOpen: true }));
    const second = updateReaderPanelLayout("other", p => ({ ...p, notesOpen: false })); await flush();
    expect(pending).toHaveLength(1);
    await act(async () => { pending.shift()!.commit(); await tick(); }); await first;
    expect(JSON.parse(pending[0].value)).toEqual({ book: { tocOpen: true, notesOpen: false }, other: { tocOpen: true, notesOpen: false } });
    await act(async () => { pending.shift()!.commit(); await tick(); }); await second;
  });
  test("panel and Ask AI intents reveal through one owner and deduplicate without leaking book scope", async () => {
    hold = false;
    const store = getDefaultStore();
    await act(async () => { store.set(readerPanelIntentAtom, { id: "appearance", bookId: "book", panel: "appearance" }); await tick(); });
    await flush(); expect(readerPanels.snapshot()?.panels.appearance).toEqual({ open: true, visible: true });
    const hide = begin(() => readingRuntime.setControls(false)); await flush(); await hide;
    await act(async () => { store.set(askAiRequestAtom, { id: "ask", bookId: "book" }); await tick(); });
    await flush(); expect(readerPanels.snapshot()?.panels.chat).toEqual({ open: true, visible: true });
    expect(state.chatFocusRequestId).toBe(1);
    await act(async () => { store.set(askAiRequestAtom, { id: "ask", bookId: "book" }); render(); await tick(); });
    expect(state.chatFocusRequestId).toBe(1);
    await act(async () => { store.set(readerPanelIntentAtom, { id: "other", bookId: "other", panel: "annotations" }); await tick(); });
    expect(state.annotations).toBe(false); expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
  test("initial intents survive StrictMode effect replay and wait for the ready binding", async () => {
    hold = false;
    await act(async () => { root.unmount(); readingRuntime.closed(); });
    getDefaultStore().set(readerPanelIntentAtom, { id: "before-mount", bookId: "book", panel: "appearance" });
    open("book"); root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { render(); await tick(); }); await flush();
    expect(readerPanels.snapshot()?.panels.appearance).toEqual({ open: true, visible: true });
    await act(async () => { root.unmount(); readingRuntime.closed(); });
    getDefaultStore().set(readerPanelIntentAtom, { id: "before-ready", bookId: "book", panel: "annotations" });
    sessionId = readingRuntime.begin("book"); root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { render(); await tick(); }); expect(readerPanels.snapshot()).toBeNull();
    const at = { bookId: "book", contentVersion: "v1", cfi: "start" };
    await act(async () => { readingRuntime.attach(sessionId, { navigate: async () => at, step: async () => at }, at); await tick(); }); await flush();
    expect(readerPanels.snapshot()?.panels.annotations).toEqual({ open: true, visible: true });
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
  test("a completed panel request is not replayed when the same book is reopened", async () => {
    hold = false;
    await act(async () => { getDefaultStore().set(askAiRequestAtom, { id: "completed-ask", bookId: "book" }); await tick(); }); await flush();
    expect(state.chat).toBe(true);
    const close = requestPanel("chat", false); await flush(); await close;
    await act(async () => { root.unmount(); readingRuntime.closed(); });
    open("book"); root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { render(); await tick(); }); await flush();
    expect(state.chat).toBe(false); expect(state.chatFocusRequestId).toBe(0);
    expect(readerPanels.snapshot()?.controlsVisible).toBe(false);
  });
} else {
  test("isolated shared panel service, persistence and React lifecycle cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, PANEL_LAYOUT_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("13 pass");
  }, 30_000);
}
