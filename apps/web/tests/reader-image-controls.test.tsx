import { expect, test } from "bun:test";
import { act, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { ReaderImageAction, ReaderImageReceipt } from "@read-aware/core";
import { ReaderImageLightbox } from "../src/features/reader/components/ReaderImageLightbox";
import { readingRuntime } from "../src/domain/reading-runtime";
import { readerImage } from "../src/services/reader-image";
import { initI18n } from "../src/i18n";
import { useImageViewer } from "../src/features/reader/hooks/useImageViewer";
import { readerImageOpen } from "../src/services/reader-image-open";
import type { BookImageData } from "../src/features/library/lib/book-images";
import {
  actorCause,
  actorFromEvent,
  actorOrigin,
  causalActor,
  eventCause,
  stampEventCause,
} from "../src/platform/domain-actor";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";

if (process.env.READER_IMAGE_CONTROLS_CASE === "1") {
  test("native lightbox and public controls share zoom, pan, rotation, reset and committed close under StrictMode", async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const observers: ResizeProbe[] = [];
    class ResizeProbe {
      element?: Element;
      active = true;
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      observe(element: Element) {
        this.element = element;
      }
      disconnect() {
        this.active = false;
      }
    }
    const values = {
      window: dom.window,
      document: dom.window.document,
      ResizeObserver: ResizeProbe,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const saved = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const root = createRoot(dom.window.document.getElementById("root")!);
    const sessionId = readingRuntime.begin("image-book");
    const location = { bookId: "image-book", contentVersion: "v1", cfi: "start" };
    const detach = readingRuntime.attach(
      sessionId,
      { navigate: async () => location, step: async () => location },
      location,
    );
    function Surface() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ReaderImageLightbox
          session={{ sessionId, bookId: "image-book" }}
          alt="Illustration"
          src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII="
          onClose={() => setOpen(false)}
        />
      ) : null;
    }
    try {
      await initI18n("en");
      await act(async () =>
        root.render(
          <StrictMode>
            <Surface />
          </StrictMode>,
        ),
      );
      const id = readerImage.snapshot()!.id;
      const img = dom.window.document.querySelector("img")!,
        stage = img.parentElement!;
      let width = 600;
      Object.defineProperties(stage, { clientWidth: { get: () => width }, clientHeight: { value: 400 } });
      Object.defineProperties(img, { naturalWidth: { value: 300 }, naturalHeight: { value: 200 } });
      async function control(action: ReaderImageAction) {
        let pending!: Promise<ReaderImageReceipt>;
        await act(async () => {
          pending = readerImage.control({ id, ...action });
        });
        return pending;
      }
      expect(await control({ action: "zoom-in" })).toMatchObject({ status: "updated", snapshot: { scale: 1.5 } });
      expect(img.style.transform).toContain("scale(1.5)");
      await control({ action: "pan", dx: 0.25, dy: -0.5 });
      expect(readerImage.snapshot()).toMatchObject({ panX: 0.25, panY: -0.5 });
      expect(img.style.transform).toContain("translate(150px, -200px)");
      const resize = () => {
        for (const observer of observers) if (observer.active && observer.element === stage) observer.callback();
      };
      // A stage resize republishes the transform in the observer callback, as
      // the system's change; whoever resized the window has that command's receipt.
      await act(async () => {
        width = 300;
        resize();
      });
      expect(readerImage.snapshot()?.panX).toBe(0.5);
      expect(actorOrigin(actorFromEvent(readerImage.snapshot()!))).toBe("system");
      const revision = readerImage.snapshot()!.revision;
      await act(async () => {
        resize();
      });
      expect(readerImage.snapshot()!.revision).toBe(revision);
      await control({ action: "rotate" });
      expect(readerImage.snapshot()).toMatchObject({ scale: 1, rotation: 90, panX: 0, panY: 0 });
      await act(async () => (dom.window.document.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click());
      expect(readerImage.snapshot()?.scale).toBe(1.5);
      await control({ action: "reset" });
      expect(readerImage.snapshot()).toMatchObject({ scale: 1, rotation: 0 });
      expect(await control({ action: "close" })).toEqual({ status: "closed", id });
      expect(readerImage.snapshot()).toBeNull();
      expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      detach();
      dom.window.close();
      for (const [key, value] of saved) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test("API opening mounts the same lightbox, releases URLs and yields to native activation in StrictMode", async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const originalCreate = URL.createObjectURL,
      originalRevoke = URL.revokeObjectURL,
      urls = new Set<string>();
    URL.createObjectURL = (blob) => {
      const url = originalCreate(blob);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      originalRevoke(url);
    };
    const root = createRoot(dom.window.document.getElementById("root")!);
    const sessionId = readingRuntime.begin("image-book");
    const location = { bookId: "image-book", contentVersion: "v1", cfi: "start" };
    const detach = readingRuntime.attach(
      sessionId,
      { navigate: async () => location, step: async () => location },
      location,
    );
    const image = { bookId: "image-book", contentVersion: "v1", sectionIndex: 0, index: 0 };
    const data: BookImageData = {
      status: "ready",
      image: { image, alt: "API illustration" },
      blob: new Blob(["pixels"], { type: "image/png" }),
    };
    let activateNative = () => {};
    let closeOld: (() => void) | undefined;
    function Surface() {
      const viewer = useImageViewer("image-book"),
        current = viewer.lightboxImage;
      activateNative = () =>
        viewer.setLightboxImage({
          src: "data:image/png;base64,cGl4ZWxz",
          alt: "Native illustration",
          session: { sessionId, bookId: "image-book" },
        });
      if (current && !closeOld) closeOld = () => viewer.closeLightbox(undefined, current.id);
      return current ? (
        <ReaderImageLightbox
          key={current.id}
          viewerId={current.id}
          session={current.session}
          lifetime={current.lifetime}
          alt={current.alt}
          src={current.src}
          onClose={(origin) => viewer.closeLightbox(origin, current.id)}
        />
      ) : null;
    }
    try {
      await initI18n("en");
      await act(async () =>
        root.render(
          <StrictMode>
            <Surface />
          </StrictMode>,
        ),
      );
      let pending!: ReturnType<typeof readerImageOpen.open>;
      const opening = causalActor("agent");
      await act(async () => {
        pending = readerImageOpen.open({ image }, async () => data, undefined, undefined, opening);
      });
      const result = await pending;
      expect(result.status).toBe("opened");
      if (result.status !== "opened") throw Error("Expected committed image viewer");
      expect(readerImage.snapshot()?.id).toBe(result.snapshot.id);
      expect(eventCause(readerImage.snapshot()!)!.root).toBe(actorCause(opening)!.root);
      const img = dom.window.document.querySelector("img")!,
        stage = img.parentElement!;
      Object.defineProperties(stage, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
      for (const mode of ["all", "book"] as const) {
        const runtime = buildPluginContext(
          {
            id: `image-${mode}`,
            name: "Image",
            version: "1",
            schemaVersion: 1,
            requires: {},
            permissions: ["reading:write"],
          },
          "1",
          [],
          mode === "all" ? { mode } : { mode, bookId: "image-book" },
        );
        runtime.lifecycle.promote();
        try {
          await runtime.reactions.deliver({}, stampEventCause({}, opening), async (reaction) => {
            const origin = runtime.reactions.actor(reaction),
              bound = runtime.context.withEvent({ reaction });
            await Promise.resolve();
            let request!: Promise<ReaderImageReceipt>;
            await act(async () => {
              request = bound.services.ui.reader!.image!.control!({ id: result.snapshot.id, action: "zoom-in" });
            });
            expect((await request).status).toBe("updated");
            expect(eventCause(readerImage.snapshot()!)!.root).toBe(actorCause(origin)!.root);
            expect(eventCause(readerImage.snapshot()!)!.steps).toEqual(actorCause(origin)!.steps);
          });
        } finally {
          runtime.lifecycle.stop();
          await runtime.lifecycle.drainCleanups();
        }
      }
      for (const mode of ["all", "book"] as const) {
        const reset = async () => {
          let pending!: Promise<ReaderImageReceipt>;
          await act(async () => {
            pending = readerImage.control({ id: result.snapshot.id, action: "reset" });
          });
          await pending;
        };
        await reset();
        const make = (id: string) => {
          const runtime = buildPluginContext(
            { id, name: id, version: "1", schemaVersion: 1, requires: {}, permissions: ["reading:write"] },
            "1",
            [],
            mode === "all" ? { mode } : { mode, bookId: "image-book" },
          );
          runtime.lifecycle.promote();
          return runtime;
        };
        const a = make(`image-cycle-a-${mode}`),
          b = make(`image-cycle-b-${mode}`),
          errors: unknown[] = [];
        let cycles = 0,
          rotations = 0,
          zooms = 0;
        try {
          a.context.services.ui.reader!.image!.observe(async (value, delivery) => {
            try {
              if (!value) return;
              if (value.rotation === 90 && value.scale === 1.5) {
                expect(delivery?.reaction?.status).toBe("cycle");
                cycles++;
                expect(() => a.context.withEvent(delivery)).toThrow(
                  expect.objectContaining({ code: "plugin/event-cycle" }),
                );
                return;
              }
              if (value.rotation !== 0 || value.scale <= 1 || delivery?.reaction?.status === "cycle") return;
              const bound = a.context.withEvent(delivery);
              await Promise.resolve();
              rotations++;
              await bound.services.ui.reader!.image!.control!({ id: value.id, action: "rotate" });
            } catch (error) {
              errors.push(error);
            }
          });
          b.context.services.ui.reader!.image!.observe(async (value, delivery) => {
            try {
              if (!value || value.rotation !== 90 || value.scale !== 1 || delivery?.reaction?.status === "cycle")
                return;
              const bound = b.context.withEvent(delivery);
              await Promise.resolve();
              zooms++;
              await bound.services.ui.reader!.image!.control!({ id: value.id, action: "zoom-in" });
            } catch (error) {
              errors.push(error);
            }
          });
          for (let n = 0; n < 2; n++) {
            if (n) await reset();
            let pending!: Promise<ReaderImageReceipt>;
            await act(async () => {
              pending = readerImage.control({ id: result.snapshot.id, action: "zoom-in" });
            });
            await pending;
            await act(async () => {
              await Promise.all([a.reactions.drain(), b.reactions.drain()]);
            });
            expect(errors).toEqual([]);
            expect(cycles).toBe(n + 1);
            expect(rotations).toBe(n + 1);
            expect(zooms).toBe(n + 1);
          }
        } finally {
          a.lifecycle.stop();
          b.lifecycle.stop();
          await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
        }
      }
      expect(dom.window.document.querySelector("img")?.alt).toBe("API illustration");
      expect(dom.window.document.querySelector("img")?.src).toStartWith("blob:");
      let close!: Promise<ReaderImageReceipt>;
      const closing = causalActor("plugin:closer"),
        retired: object[] = [];
      const stop = readerImage.observe((value, source) => {
        if (value === null) retired.push(source);
      });
      await act(async () => {
        close = readerImage.control({ id: result.snapshot.id, action: "close" }, undefined, closing);
      });
      expect(eventCause(retired.at(-1)!)!.root).toBe(actorCause(closing)!.root);
      stop();
      expect(await close).toEqual({ status: "closed", id: result.snapshot.id });
      expect(dom.window.document.querySelector("img")).toBeNull();
      expect(urls.size).toBe(0);
      const held = Promise.withResolvers<BookImageData>();
      const late = readerImageOpen.open({ image }, () => held.promise).catch((error) => error);
      await act(async () => activateNative());
      held.resolve(data);
      expect(await late).toMatchObject({ code: "reader/superseded" });
      expect(dom.window.document.querySelector("img")?.alt).toBe("Native illustration");
      await act(async () => closeOld?.());
      expect(dom.window.document.querySelector("img")?.alt).toBe("Native illustration");
      await act(async () => {
        readingRuntime.begin("other");
      });
      expect(dom.window.document.querySelector("img")).toBeNull();
      expect(readerImage.snapshot()).toBeNull();
    } finally {
      await act(async () => root.unmount());
      detach();
      dom.window.close();
      expect(urls.size).toBe(0);
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      for (const [key, value] of saved) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
} else {
  test("isolated reader image controls contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, READER_IMAGE_CONTROLS_CASE: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("2 pass");
  }, 30_000);
}
