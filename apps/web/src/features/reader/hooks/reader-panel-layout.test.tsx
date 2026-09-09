import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { LocalWriteFailureToasts } from "../../../components/LocalWriteFailureToasts";
import { initI18n } from "../../../i18n";
import { flushLocalKV, localKV } from "../../../platform/local-store";
import { getReaderPanelLayout, updateReaderPanelLayout } from "../lib/reader-panel-layout";
import { useReaderPanelLayout } from "./useReaderPanelLayout";

const key = "read-aware-reader-panels";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

if (process.env.PANEL_LAYOUT_CASE === "1") {
  let dom: JSDOM, root: Root, state: ReturnType<typeof useReaderPanelLayout>;
  let globals: Map<string, PropertyDescriptor | undefined>;
  const disk = new Map<string, string>();
  const pending: { value: string; commit(): void; reject(error: unknown): void }[] = [];
  let hold = false;
  function Harness({ bookId }: { bookId: string }) {
    state = useReaderPanelLayout(bookId);
    return <><section aria-label="toc" inert={!state.tocOpen} /><section aria-label="chat" inert={!state.notesOpen} /></>;
  }
  const render = (bookId = "book") => root.render(<StrictMode><ToastProvider><LocalWriteFailureToasts /><Harness bookId={bookId} /></ToastProvider></StrictMode>);
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
    await localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: false, notesOpen: false }, other: { tocOpen: true, notesOpen: true } }));
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { render(); await tick(); });
    hold = true;
  });
  afterEach(async () => {
    hold = false;
    await act(async () => {
      root.unmount();
      for (const write of pending.splice(0)) write.commit();
      await flushLocalKV(); await tick();
    });
    dom.window.close();
    for (const [name, value] of globals) {
      if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
    }
  });

  test("real hook mirrors an optimistic change but waits for durability before its success continuation", async () => {
    let settled = false; let request!: ReturnType<typeof state.setTocOpen>;
    await act(async () => { request = state.setTocOpen(true).then(value => { settled = true; return value; }); await tick(); });
    expect(state.tocOpen).toBe(true); expect(settled).toBe(false);
    expect(JSON.parse(disk.get(key)!).book.tocOpen).toBe(false);
    expect(dom.window.document.querySelector('[aria-label="toc"]')!.hasAttribute("inert")).toBe(false);
    await act(async () => { pending.shift()!.commit(); expect(await request).toEqual({ tocOpen: true, notesOpen: false }); });
    expect(JSON.parse(disk.get(key)!).book.tocOpen).toBe(true);
  });

  test("write rejection rolls the mounted panel back and emits one localized notice, not raw prose", async () => {
    let request!: ReturnType<typeof state.setTocOpen>;
    await act(async () => { request = state.setTocOpen(true); await tick(); });
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "RAW private database failure" }); expect(await request).toBeNull(); await tick(); });
    expect(state.tocOpen).toBe(false);
    expect(dom.window.document.querySelector('[aria-label="toc"]')!.hasAttribute("inert")).toBe(true);
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(dom.window.document.querySelector('[role="status"]')!.textContent).toContain("Change not saved");
    expect(dom.window.document.body.textContent).not.toContain("RAW private");
    expect(JSON.parse(disk.get(key)!).book).toEqual({ tocOpen: false, notesOpen: false });
    hold = false;
    await act(async () => { expect(await state.setTocOpen(true)).toEqual({ tocOpen: true, notesOpen: false }); });
    expect(state.tocOpen).toBe(true);
  });

  test("queued toggles read settled state, retain other books and suppress superseded focus", async () => {
    let first!: ReturnType<typeof state.setNotesOpen>, second!: typeof first;
    await act(async () => {
      first = state.setNotesOpen(value => !value);
      second = state.setNotesOpen(value => !value);
      await tick();
    });
    expect(pending).toHaveLength(1);
    await act(async () => { pending.shift()!.commit(); expect(await first).toBeNull(); await tick(); });
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].value).book.notesOpen).toBe(false);
    await act(async () => { pending.shift()!.commit(); expect(await second).toEqual({ tocOpen: false, notesOpen: false }); });
    expect(JSON.parse(disk.get(key)!).other).toEqual({ tocOpen: true, notesOpen: true });
    expect(state.notesOpen).toBe(false);
  });

  test("a later intent patches rollback rather than retaining a failed optimistic sibling field", async () => {
    let first!: ReturnType<typeof state.setTocOpen>, second!: typeof first;
    await act(async () => { first = state.setTocOpen(true); second = state.setNotesOpen(true); await tick(); });
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "reject first" }); expect(await first).toBeNull(); await tick(); });
    expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: false, notesOpen: true });
    await act(async () => { pending.shift()!.commit(); await second; });
    expect(state.tocOpen).toBe(false); expect(state.notesOpen).toBe(true);
  });

  test("exclusive pane switch has one write and failure restores both panes", async () => {
    hold = false; await act(async () => { await state.setTocOpen(true); }); hold = true;
    let request!: ReturnType<typeof state.setNotesOpen>;
    await act(async () => { request = state.setNotesOpen(true, true); await tick(); });
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].value).book).toEqual({ tocOpen: false, notesOpen: true });
    expect(state.tocOpen).toBe(false); expect(state.notesOpen).toBe(true);
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "switch rejected" }); await request; });
    expect(state.tocOpen).toBe(true); expect(state.notesOpen).toBe(false);
  });

  test("external writes and rollback refresh the mounted book without writing it back", async () => {
    let external!: Promise<void>;
    await act(async () => { external = localKV.setItemAsync(key, JSON.stringify({ book: { tocOpen: true, notesOpen: true } })); void external.catch(() => {}); await tick(); });
    expect(state.tocOpen).toBe(true); expect(state.notesOpen).toBe(true);
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "external failed" }); await external.catch(() => {}); await tick(); });
    expect(state.tocOpen).toBe(false); expect(state.notesOpen).toBe(false); expect(pending).toHaveLength(0);
  });

  test("book replacement immediately uses its own state and cancels queued old-book intents", async () => {
    let blocker!: Promise<void>, old!: ReturnType<typeof state.setNotesOpen>;
    await act(async () => { blocker = localKV.setItemAsync(key, disk.get(key)!); old = state.setNotesOpen(true); await tick(); render("other"); });
    expect(await old).toBeNull();
    expect(state.tocOpen).toBe(true); expect(state.notesOpen).toBe(true);
    await act(async () => { pending.shift()!.commit(); await blocker; await tick(); });
    expect(pending).toHaveLength(0); expect(JSON.parse(disk.get(key)!).book.notesOpen).toBe(false);
  });

  test("host helper preserves failure codes and promptly cancels an already dispatched write", async () => {
    let failed!: Promise<unknown>;
    await act(async () => { failed = updateReaderPanelLayout("book", p => ({ ...p, tocOpen: true })).catch(error => error); await tick(); });
    await act(async () => { pending.shift()!.reject({ code: "db/locked", message: "private" }); expect(await failed).toMatchObject({ code: "db/locked" }); });
    const abort = new AbortController(); let cancelled!: Promise<unknown>;
    await act(async () => { cancelled = updateReaderPanelLayout("book", p => ({ ...p, tocOpen: true }), abort.signal).catch(error => error); await tick(); abort.abort(new Error("cancel")); expect(await cancelled).toHaveProperty("message", "cancel"); });
    await act(async () => { pending.shift()!.commit(); await tick(); });
    expect(getReaderPanelLayout("book").tocOpen).toBe(true);
  });

  test("same-value requests settle without writes; malformed values cannot corrupt preferences", async () => {
    expect(await updateReaderPanelLayout("book", p => ({ ...p }))).toEqual({ tocOpen: false, notesOpen: false });
    await expect(updateReaderPanelLayout("book", p => ({ ...p, tocOpen: "yes" as unknown as boolean }))).rejects.toMatchObject({ code: "reader/invalid-target" });
    expect(pending).toHaveLength(0);
    expect(getReaderPanelLayout("book", "[]")).toEqual({ tocOpen: false, notesOpen: false });
    expect(getReaderPanelLayout("book", "invalid")).toEqual({ tocOpen: false, notesOpen: false });
    expect(getReaderPanelLayout("toString", "{}")).toEqual({ tocOpen: false, notesOpen: false });
  });

  test("simultaneous book owners merge against the committed predecessor instead of overwriting it", async () => {
    let first!: Promise<unknown>, second!: Promise<unknown>;
    await act(async () => {
      first = updateReaderPanelLayout("book", p => ({ ...p, tocOpen: true }));
      second = updateReaderPanelLayout("other", p => ({ ...p, notesOpen: false }));
      await tick();
    });
    expect(pending).toHaveLength(1);
    await act(async () => { pending.shift()!.commit(); await first; await tick(); });
    expect(JSON.parse(pending[0].value)).toEqual({ book: { tocOpen: true, notesOpen: false }, other: { tocOpen: true, notesOpen: false } });
    await act(async () => { pending.shift()!.commit(); await second; });
    expect(JSON.parse(disk.get(key)!)).toEqual({ book: { tocOpen: true, notesOpen: false }, other: { tocOpen: true, notesOpen: false } });
  });
} else {
  test("isolated reader panel persistence and React lifetime cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, PANEL_LAYOUT_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("10 pass");
  }, 30_000);
}
