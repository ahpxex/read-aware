import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { PluginImageViewBody } from "./PluginImageViewBody";
import { normalizePluginView } from "../lib/plugin-view";
import { registerPluginImageOwner } from "../lib/plugin-image-owner";
import { decodePluginCallbacks } from "../runtime/plugin-callback-wire";

test("mounted resource image keeps a stable box, waits for load, localizes failure and releases hidden copies", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const activation = new AbortController(), created: string[] = [], revoked: string[] = [];
  let finish: ((blob: Blob) => void) | undefined;
  const stop = registerPluginImageOwner(activation.signal, async id => {
    if (id === "missing") throw new AppError("fs/not-found", "private disk path");
    if (id === "pending") return new Promise(resolve => { finish = resolve; });
    return new Blob(["pixels"], { type: "image/png" });
  }, {
    createObjectURL: () => { const url = `blob:private-${created.length}`; created.push(url); return url; },
    revokeObjectURL: url => { revoked.push(url); },
  });
  const view = (resourceId: string) => {
    const image = normalizePluginView(decodePluginCallbacks({ data: { kind: "image", resourceId, alt: "Book cover", caption: "<b>Cover</b>", aspectRatio: 0.75 }, callbacks: [] }, () => null, undefined, activation.signal));
    if (image.kind !== "image") throw Error("Expected image");
    return image;
  };
  const render = async (id: string) => { await act(async () => { root.render(<StrictMode><PluginImageViewBody view={view(id)} /></StrictMode>); }); };
  try {
    await initI18n("en"); await render("cover");
    const img = dom.window.document.querySelector("img")!;
    expect(img.alt).toBe("Book cover"); expect(img.getAttribute("src")).toBe(created[0]);
    expect(img.parentElement?.style.aspectRatio).toBe("0.75 / 1");
    expect(img.style.opacity).toBe("0"); expect(img.parentElement?.getAttribute("aria-busy")).toBe("true");
    await act(async () => { img.dispatchEvent(new dom.window.Event("load")); });
    expect(img.style.opacity).toBe("1"); expect(img.parentElement?.getAttribute("aria-busy")).toBe("false");
    expect(dom.window.document.querySelector("figcaption")?.textContent).toBe("<b>Cover</b>");
    expect(dom.window.document.querySelector("b")).toBeNull();
    await render("cover"); expect(created).toHaveLength(1);
    await render("missing"); expect(revoked).toEqual(created); expect(dom.window.document.querySelector("img")).toBeNull();
    expect(dom.window.document.body.textContent).not.toContain("private disk path");
    expect(dom.window.document.querySelector("[aria-busy=false]")).not.toBeNull();
    await render("pending");
    await act(async () => { root.render(null); });
    await act(async () => { finish?.(new Blob(["late"], { type: "image/png" })); });
    expect(created).toHaveLength(1);
    await render("cover"); expect(created).toHaveLength(2);
    const last = dom.window.document.querySelector("img")!;
    await act(async () => { last.dispatchEvent(new dom.window.Event("error")); });
    expect(dom.window.document.querySelector("img")).toBeNull(); expect(revoked).toEqual(created);
  } finally {
    await act(async () => { root.unmount(); }); activation.abort(); stop(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
