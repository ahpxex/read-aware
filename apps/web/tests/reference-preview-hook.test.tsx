import { expect, test } from "bun:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { BookReferencePreview, ReaderReferencePreviewReceipt } from "@read-aware/core";
import { readingRuntime } from "../src/domain/reading-runtime";
import { readerReferencePreview } from "../src/services/reader-reference-preview";
import { useReferencePreview } from "../src/features/reader/hooks/useReferencePreview";
import { withDom } from "./helpers/foliate-dom";

test("native/API preview hook acknowledges actual commits, native replacement and owner cleanup", () => withDom(async window => {
  const globals = { window, IS_REACT_ACT_ENVIRONMENT: true };
  const old = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root")!);
  let state!: ReturnType<typeof useReferencePreview>;
  function Harness() {
    state = useReferencePreview("book", "Note");
    return state.footnote ? <div data-preview={state.footnote.previewId ?? "native"}>{state.footnote.text}</div> : null;
  }
  const query = { reference: { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 } };
  const preview: BookReferencePreview = { reference: query.reference, status: "resolved", label: "", text: "Visible note", offset: 0, totalLength: 20, nextOffset: 12 };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const begin = async (owner: object) => {
    let pending!: Promise<ReaderReferencePreviewReceipt>;
    await act(async () => { pending = readerReferencePreview.open(owner, query, async () => preview); await tick(); });
    return pending;
  };
  try {
    const session = readingRuntime.begin("book"), location = { bookId: "book", contentVersion: "v1", cfi: "start" };
    readingRuntime.attach(session, { navigate: async () => location, step: async () => location }, location);
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); await tick(); });
    const nativeRequest = state.beginNativeFootnote();
    const owner = {}, opened = await begin(owner);
    expect(opened.status).toBe("opened");
    expect(document.querySelector("[data-preview]")?.textContent).toBe("Visible note...");
    await act(async () => { state.setFootnote({ anchorRect: null, label: "Old native", text: "Late result" }, nativeRequest); });
    expect(document.querySelector("[data-preview]")?.textContent).toBe("Visible note...");
    await act(async () => { state.setFootnote({ anchorRect: null, label: "Native", text: "Native note" }); });
    if (opened.status !== "opened") throw Error("Expected opened");
    expect(await readerReferencePreview.close(owner, opened.id)).toMatchObject({ status: "not-current" });
    expect(document.querySelector("[data-preview]")?.textContent).toBe("Native note");
    await begin(owner);
    let release!: Promise<void>;
    await act(async () => { release = readerReferencePreview.release(owner); await tick(); });
    await release;
    expect(document.querySelector("[data-preview]")).toBeNull();
  } finally {
    await act(async () => { root.unmount(); readingRuntime.closed(); });
    for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}));
