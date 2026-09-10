import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReaderImageService } from "./reader-image";
import { ReaderImageOpenService } from "./reader-image-open";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { BookImageData } from "../features/library/lib/book-images";

const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
const data: BookImageData = { status: "ready", image: { image, alt: "Picture" }, blob: new Blob(["bytes"]) };
function fixture(deadline?: number) {
  const reading = new ReadingSessionController(() => {});
  const sessionId = reading.begin("book"), location = { bookId: "book", contentVersion: "v1", cfi: "start" };
  reading.attach(sessionId, { navigate: async () => location, step: async () => location }, location);
  const images = new ReaderImageService(reading, () => {}), service = new ReaderImageOpenService(reading, images, deadline);
  const presented: string[] = [], cleared: string[] = [];
  const binding = service.bind(sessionId, "book", { present: id => { presented.push(id); }, clear: id => { cleared.push(id); } });
  return { reading, sessionId, images, service, presented, cleared, binding };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("image opening requires matching session/version and waits for the actual viewer identity", async () => {
  const f = fixture(); let loads = 0;
  const read = async () => { loads++; return data; };
  try {
    await expect(f.service.open({ image: { ...image, bookId: "other" } }, read)).rejects.toMatchObject({ code: "reader/out-of-scope" });
    await expect(f.service.open({ image: { ...image, contentVersion: "old" } }, read)).rejects.toMatchObject({ code: "reader/stale-location" });
    await expect(f.service.open({ image }, read, undefined, { sessionId: "old" })).rejects.toMatchObject({ code: "reader/superseded" });
    expect(loads).toBe(0);
    let resolved = false;
    const pending = f.service.open({ image }, read).then(value => { resolved = true; return value; });
    await tick(); expect(resolved).toBe(false); expect(f.presented).toHaveLength(1);
    const view = f.images.bind({ id: f.presented[0]!, bookId: "book", sessionId: f.sessionId }, { apply: () => {}, close: () => {} },
      { scale: 1, rotation: 0, panX: 0, panY: 0 });
    expect(await pending).toMatchObject({ status: "opened", snapshot: { id: f.presented[0], bookId: "book" } });
    view.dispose();
    for (const status of ["missing", "external", "unsupported"] as const) {
      expect(await f.service.open({ image }, async () => ({ status, image: data.image }))).toEqual({ status: "not-opened", reason: status });
    }
    expect(f.presented).toHaveLength(1);
  } finally { f.binding.dispose(); }
});

test("native intent, replacement, retirement and deadline reject pending opens without late presentation", async () => {
  const f = fixture(30);
  try {
    const held = Promise.withResolvers<BookImageData>();
    const pending = f.service.open({ image }, () => held.promise).catch(error => error);
    f.binding.interrupt(); held.resolve(data);
    expect(await pending).toMatchObject({ code: "reader/superseded" }); expect(f.presented).toHaveLength(0);
    const next = Promise.withResolvers<BookImageData>();
    const old = f.service.open({ image }, () => next.promise).catch(error => error);
    await f.service.open({ image }, async () => ({ status: "missing", image: data.image }));
    next.resolve(data); expect(await old).toMatchObject({ code: "reader/superseded" });
    const abort = new AbortController();
    const waiting = f.service.open({ image }, async () => data, abort.signal).catch(error => error);
    await tick(); abort.abort(new AppError("plugin/cancelled", "Retired"));
    expect(await waiting).toMatchObject({ code: "plugin/cancelled" });
    expect(f.cleared).toEqual(f.presented);
    await expect(f.service.open({ image }, async () => data)).rejects.toMatchObject({ code: "reader/timeout" });
    expect(f.cleared).toEqual(f.presented);
    const last = f.service.open({ image }, async () => data).catch(error => error);
    f.reading.begin("other"); expect(await last).toMatchObject({ code: "reader/superseded" });
  } finally { f.binding.dispose(); }
});

test("public image opening needs both library read and reading write and stops at activation retirement", async () => {
  for (const permissions of [[], ["reading:write"], ["library:read"], ["reading:read", "library:read"],
    ["reading:write", "library:read"], ["reading:write", "library:write"]] as const) {
    const plugin = buildPluginContext({ id: "image-open", name: "Images", version: "1", schemaVersion: 1, requires: {}, permissions: [...permissions] }, "1", []);
    plugin.lifecycle.promote();
    const open = plugin.context.services.ui.reader?.image?.open;
    expect(!!open).toBe(permissions.some(value => value === "reading:write") && permissions.some(value => value.startsWith("library:")));
    if (open) await expect(open({ image })).rejects.toMatchObject({ code: "reader/unavailable" });
    plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups();
    if (open) expect(() => open({ image })).toThrow();
  }
});
