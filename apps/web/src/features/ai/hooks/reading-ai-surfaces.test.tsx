import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { ToastProvider } from "@read-aware/ui";
import { READING_AI_ACTIONS } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { localKV } from "../../../platform/local-store";
import { aiPreferencesAtom } from "../../../state/ui";
import { ReadingSessionController } from "../../../domain/reading-session-controller";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerPanels } from "../../../services/reader-panels";
import { readingAiActions } from "../../../services/reading-ai-runtime";
import { useReadingAiSurface } from "./useReadingAiSurface";
import { useReadingAiControls } from "./useReadingAiControls";
import { ReaderSelectionMenu } from "../../reader/components/ReaderSelectionMenu";
import { CommandPalette } from "../../command/components/CommandPalette";
import type { BookConversation } from "./useBookConversation";

if (process.env.READING_AI_SURFACES_CASE === "1") {
test("selection overflow and palette react to feature toggles, and the mounted chat receives the actual captured turn once", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} }, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const store = getDefaultStore(), original = store.get(aiPreferencesAtom), session = new ReadingSessionController(() => {}).snapshot();
  Object.assign(session, { status: "ready", sessionId: "session", bookId: "book", location: { bookId: "book", contentVersion: "v1", href: "chapter.xhtml" },
    selection: { id: "selection", text: "Selected text", textLength: 13, range: null } });
  const spies = [spyOn(localKV, "setItem").mockImplementation(() => {}), spyOn(readingRuntime, "snapshot").mockReturnValue(session),
    spyOn(readingRuntime, "observe").mockImplementation(handler => { handler(session); return () => {}; }),
    spyOn(readerPanels, "setPanel").mockResolvedValue({ status: "completed" } as never)];
  const calls: unknown[] = [], chat: Pick<BookConversation, "send" | "isLoading" | "isStreaming"> = { isLoading: false, isStreaming: false,
    send: (...args) => { calls.push(args); return true; } };
  let menuId: string | null = "selection", controls!: ReturnType<typeof useReadingAiControls>;
  function Harness() {
    useReadingAiSurface("book", chat);
    controls = useReadingAiControls(true, menuId);
    return <><ReaderSelectionMenu selection={{ text: "Selected text", cfiRange: null, captured: menuId ? { ...session.selection!, id: menuId } : undefined, anchorRect: { left: 0, top: 0, width: 30, height: 20 } }} onCopy={() => {}} />
      <CommandPalette isOpen onClose={() => {}} ctx={{ activeTopNav: "shelf", readingBookId: "book", shelfView: { layout: "grid", group: "none", sort: "recent" }, books: [], collections: [], importBook: () => {} }} /></>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const labels = ["Explain selection", "Define term", "Translate", "Summarize chapter"];
  try {
    await initI18n("en");
    await act(async () => { store.set(aiPreferencesAtom, { ...original, features: { ...original.features, ...Object.fromEntries(READING_AI_ACTIONS.map(action => [action, true])) } });
      root.render(<ToastProvider><Harness /></ToastProvider>); });
    const more = dom.window.document.querySelector('button[aria-label="More"]') as HTMLButtonElement;
    expect(more).toBeTruthy(); await act(async () => { more.click(); });
    for (const label of labels) expect([...dom.window.document.querySelectorAll("button")].filter(button => button.textContent === label).length).toBe(2);
    for (const [index, action] of READING_AI_ACTIONS.entries()) {
      await act(async () => { const prefs = store.get(aiPreferencesAtom); store.set(aiPreferencesAtom, { ...prefs, features: { ...prefs.features, [action]: false } }); });
      expect([...dom.window.document.querySelectorAll("button")].some(button => button.textContent === labels[index])).toBe(false);
      await expect(readingAiActions.run(action)).rejects.toBeDefined();
    }
    await act(async () => { const prefs = store.get(aiPreferencesAtom); store.set(aiPreferencesAtom, { ...prefs, features: { ...prefs.features, explainSelection: true } }); });
    await act(async () => {
      const action = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === labels[0])!;
      expect(action.disabled).toBe(false); action.click(); await Bun.sleep(1);
    });
    expect(calls).toEqual([[expect.stringContaining("Explain"), [{ kind: "selection", text: "Selected text", cfiRange: null, chapterHref: "chapter.xhtml" }]]]);
    await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); }); expect(calls).toHaveLength(1);
    for (const id of ["retired-selection", null]) {
      menuId = id;
      await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); });
      expect(controls.disabled("explainSelection")).toBe(true);
      await expect(controls.run("explainSelection")).rejects.toMatchObject({ code: "reader/superseded" });
      expect(calls).toHaveLength(1);
    }
  } finally {
    await act(async () => { root.unmount(); store.set(aiPreferencesAtom, original); });
    for (const spy of spies) spy.mockRestore(); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
} else {
  test("isolated reading AI surface contracts", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, READING_AI_SURFACES_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
