import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { useTextUnitNavigator, type TextUnitNavigator } from "./useTextUnitNavigator";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import { readTextUnitModeState, writeTextUnitModeState } from "../lib/text-unit-mode-state";

test("navigator handles both event orders, same-index replacements, provider failure and retirement", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, Range: dom.window.Range,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const painted: string[] = [];
  let crosses = 0;
  const pending: { text: string; resolve(value: { start: number; end: number }[]): void; reject(error: unknown): void }[] = [];
  const segmenter: Parameters<typeof useTextUnitNavigator>[0]["segmentText"] = ({ text }) => new Promise((resolve, reject) => pending.push({ text, resolve, reject }));
  const view = { getCFI: (_index: number, range: Range) => range.toString(),
    resolveCFI: (cfi: string) => ({ index: 0, anchor: (doc: Document) => {
      const node = [...doc.querySelectorAll("p")].find(p => p.textContent === cfi)?.firstChild;
      if (!node) throw new Error("Missing test CFI");
      const range = doc.createRange(); range.selectNodeContents(node); return range;
    } }),
    addAnnotation: async (annotation: { value: string }) => { painted.push(annotation.value); },
    deleteAnnotation: async () => {},
  } as unknown as FoliateView;
  const options: Parameters<typeof useTextUnitNavigator>[0] = {
    active: true, bookId: "unit-build-test", modeKey: "test-mode:reader", unitId: "sentence", segmentText: segmenter,
    viewRef: { current: view }, readerRootRef: { current: null }, crossSection: () => { crosses++; }, veilColor: "white",
  };
  let state!: TextUnitNavigator;
  const unavailableSegmenter = () => [];
  function Harness({ active = true, unitId = "sentence", suspended = false }: { active?: boolean; unitId?: string; suspended?: boolean }) {
    state = useTextUnitNavigator({ ...options, active, unitId, suspended,
      modeKey: suspended ? null : options.modeKey, segmentText: suspended ? unavailableSegmenter : segmenter });
    return <div data-status={state.status}>{state.current?.text}</div>;
  }
  const render = (active = true, unitId = "sentence", suspended = false) => root.render(<ToastProvider><Harness active={active} unitId={unitId} suspended={suspended} /></ToastProvider>);
  const doc = (text: string) => new dom.window.DOMParser().parseFromString(`<p>${text}</p>`, "text/html");
  const relocate = (document: Document) => {
    const range = document.createRange(); range.selectNodeContents(document.body);
    state.handleRelocate({ range } as FoliateRelocateDetail);
  };
  const finish = (index: number) => { const item = pending[index]!; item.resolve([{ start: 0, end: item.text.length }]); };
  try {
    await act(async () => { render(); });
    await act(async () => { state.handleContentVersion("unit-build-test", "v1"); });
    const first = doc("First.");
    await act(async () => { state.handleSectionLoad(first, 0); relocate(first); });
    expect(state.status).toBe("building");
    await act(async () => { finish(0); });
    expect(state.current?.text).toBe("First.");

    const second = doc("Second.");
    await act(async () => { state.handleSectionLoad(second, 0); });
    await act(async () => { finish(1); });
    expect(state.current).toBeNull();
    await act(async () => { relocate(second); });
    expect(state.current?.text).toBe("Second.");

    const obsolete = doc("Obsolete.");
    const replacement = doc("Replacement.");
    await act(async () => { state.handleSectionLoad(obsolete, 0); });
    await act(async () => { state.handleSectionLoad(replacement, 0); relocate(replacement); });
    await act(async () => { finish(2); });
    expect(state.current).toBeNull();
    await act(async () => { finish(3); });
    expect(state.current?.text).toBe("Replacement.");
    expect(painted).not.toContain("Obsolete.");

    await act(async () => { render(true, "paragraph"); });
    expect(state.status).toBe("building");
    await act(async () => { pending[4]!.reject(new Error("provider unavailable")); });
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("reader/segmentation-failed");
    expect(state.current).toBeNull();
    await act(async () => { state.next(); });
    expect(crosses).toBe(0);

    await act(async () => { render(false, "paragraph"); });
    await act(async () => { render(true, "paragraph"); });
    await act(async () => { render(false, "paragraph"); });
    await act(async () => { finish(5); });
    expect(state.status).toBe("inactive");
    expect(state.current).toBeNull();
    expect(painted.filter(value => value === "Replacement.")).toHaveLength(1);

    const two = new dom.window.DOMParser().parseFromString("<p>First unit.</p><p>Second unit.</p>", "text/html");
    await act(async () => { state.handleSectionLoad(two, 0); relocate(two); render(true, "paragraph"); });
    await act(async () => { finish(6); finish(7); });
    await act(async () => { state.next(); });
    expect(state.current?.text).toBe("Second unit.");
    await act(async () => { render(false, "paragraph", true); });
    expect(state.current).toBeNull();
    expect(state.canReturn).toBe(true);
    await act(async () => { render(true, "paragraph"); });
    await act(async () => { finish(8); finish(9); });
    expect(state.current?.text).toBe("Second unit.");
    expect(state.progress?.ordinal).toBe(1);
    expect(state.position?.location.contentVersion).toBe("v1");

    const oldRevision = doc("Old revision.");
    await act(async () => { state.handleSectionLoad(oldRevision, 0); });
    await act(async () => { state.handleContentVersion("unit-build-test", "v2"); });
    expect(state.canReturn).toBe(false);
    expect(state.position).toBeNull();
    const newRevision = doc("New revision.");
    await act(async () => { state.handleSectionLoad(newRevision, 0); relocate(newRevision); });
    await act(async () => { finish(10); });
    expect(state.current).toBeNull();
    await act(async () => { finish(11); });
    expect(state.current?.text).toBe("New revision.");
    expect(state.position?.location.contentVersion).toBe("v2");

    const position = state.position!;
    const returningDocument = doc("New revision.");
    await act(async () => { state.handleSectionLoad(returningDocument, 0); relocate(returningDocument); });
    let returned = false;
    const returning = state.waitForPosition(position, new AbortController().signal).then(value => { returned = true; return value; });
    await act(async () => {});
    expect(returned).toBe(false);
    await act(async () => { finish(12); });
    expect((await returning).cfiRange).toBe("New revision.");
    await expect(state.waitForPosition({ ...position, location: { ...position.location, contentVersion: "v1" } }, new AbortController().signal))
      .rejects.toMatchObject({ code: "reader/stale-location" });

    await act(async () => { state.handleSectionLoad(doc("New revision."), 0); });
    const failedReturn = state.waitForPosition(position, new AbortController().signal).catch(error => error);
    await act(async () => { pending[13]!.reject(new Error("provider rejected return")); });
    expect(await failedReturn).toMatchObject({ code: "reader/segmentation-failed" });
    await act(async () => { render(false, "paragraph"); });
    await act(async () => { state.handleContentVersion("unit-build-test", "v2"); });
    expect(state.position).toBeNull();
    expect(readTextUnitModeState("unit-build-test").active).toBe(false);
    writeTextUnitModeState("pending-version-test", { active: true, modeKey: "test-mode:reader", unitId: "paragraph", contentVersion: "v2",
      resting: { sectionIndex: 0, ordinal: 0, cfiRange: "New revision." } });
    options.bookId = "pending-version-test";
    await act(async () => { render(false, "paragraph"); });
    expect(readTextUnitModeState("pending-version-test").active).toBe(true);
    await act(async () => { state.handleContentVersion("pending-version-test", "v2"); });
    expect(state.position).toBeNull();
    expect(readTextUnitModeState("pending-version-test").active).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
