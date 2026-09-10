import { expect, test } from "bun:test";
import { act, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { ReaderImageAction, ReaderImageReceipt } from "@read-aware/core";
import { ReaderImageLightbox } from "../src/features/reader/components/ReaderImageLightbox";
import { readingRuntime } from "../src/domain/reading-runtime";
import { readerImage } from "../src/services/reader-image";
import { initI18n } from "../src/i18n";

test("native lightbox and public controls share zoom, pan, rotation, reset and committed close under StrictMode", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const sessionId = readingRuntime.begin("image-book");
  const location = { bookId: "image-book", contentVersion: "v1", cfi: "start" };
  const detach = readingRuntime.attach(sessionId, { navigate: async () => location, step: async () => location }, location);
  function Surface() {
    const [open, setOpen] = useState(true);
    return open ? <ReaderImageLightbox session={{ sessionId, bookId: "image-book" }} alt="Illustration"
      src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII="
      onClose={() => setOpen(false)} /> : null;
  }
  try {
    await initI18n("en");
    await act(async () => root.render(<StrictMode><Surface /></StrictMode>));
    const id = readerImage.snapshot()!.id;
    const img = dom.window.document.querySelector("img")!, stage = img.parentElement!;
    Object.defineProperties(stage, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
    Object.defineProperties(img, { naturalWidth: { value: 300 }, naturalHeight: { value: 200 } });
    async function control(action: ReaderImageAction) {
      let pending!: Promise<ReaderImageReceipt>;
      await act(async () => { pending = readerImage.control({ id, ...action }); });
      return pending;
    }
    expect(await control({ action: "zoom-in" })).toMatchObject({ status: "updated", snapshot: { scale: 1.5 } });
    expect(img.style.transform).toContain("scale(1.5)");
    await control({ action: "pan", dx: 0.25, dy: -0.5 });
    expect(readerImage.snapshot()).toMatchObject({ panX: 0.25, panY: -0.5 });
    expect(img.style.transform).toContain("translate(150px, -200px)");
    await control({ action: "rotate" });
    expect(readerImage.snapshot()).toMatchObject({ scale: 1, rotation: 90, panX: 0, panY: 0 });
    await act(async () => (dom.window.document.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click());
    expect(readerImage.snapshot()?.scale).toBe(1.5);
    await control({ action: "reset" });
    expect(readerImage.snapshot()).toMatchObject({ scale: 1, rotation: 0 });
    expect(await control({ action: "close" })).toEqual({ status: "closed", id });
    expect(readerImage.snapshot()).toBeNull(); expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount()); detach(); dom.window.close();
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
