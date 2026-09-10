import { expect, test } from "bun:test";
import { AppError, type ReaderImageRequest } from "@read-aware/core";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReaderImageService } from "./reader-image";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";

const view = { scale: 1, rotation: 0, panX: 0, panY: 0 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const reading = new ReadingSessionController(() => {});
  const sessionId = reading.begin("book"), location = { bookId: "book", contentVersion: "v1", cfi: "start" };
  reading.attach(sessionId, { navigate: async () => location, step: async () => location }, location);
  const service = new ReaderImageService(reading, () => {});
  let token = 0, closes = 0;
  const binding = service.bind({ id: "image", bookId: "book", sessionId }, {
    apply: (_request, nextToken) => { token = nextToken; }, close: () => { closes++; },
  }, view);
  return { reading, service, binding, get token() { return token; }, get closes() { return closes; } };
}

test("image commands require current identity, reject extra authority and wait for a matching commit", async () => {
  const f = fixture();
  try {
    for (const request of [{ id: "image", action: "open" }, { id: "image", action: "reset", url: "file://secret" },
      { id: "image", action: "pan", dx: Infinity, dy: 0 }, { id: "image", action: "pan", dx: 2, dy: 0 }]) {
      expect(() => f.service.control(request as ReaderImageRequest)).toThrow();
    }
    await expect(f.service.control({ id: "old-image", action: "close" })).rejects.toMatchObject({ code: "reader/superseded" });
    let settled = false;
    const pending = f.service.control({ id: "image", action: "zoom-in" }).then(result => { settled = true; return result; });
    await tick(); expect(settled).toBe(false);
    f.binding.publish({ ...view, scale: 1.5 }, f.token - 1); await tick(); expect(settled).toBe(false);
    f.binding.publish({ ...view, scale: 1.5 }, f.token);
    expect(await pending).toMatchObject({ status: "updated", snapshot: { scale: 1.5 } });
    const close = f.service.control({ id: "image", action: "close" });
    expect(f.closes).toBe(1); f.binding.dispose();
    expect(await close).toEqual({ status: "closed", id: "image" }); expect(f.service.snapshot()).toBeNull();
  } finally { f.binding.dispose(); }
});

test("new intent, cancellation and session retirement cannot acknowledge stale image controls", async () => {
  const f = fixture();
  try {
    const first = f.service.control({ id: "image", action: "zoom-in" }).catch(error => error);
    const abort = new AbortController();
    const next = f.service.control({ id: "image", action: "rotate" }, abort.signal).catch(error => error);
    expect(await first).toMatchObject({ code: "reader/superseded" });
    abort.abort(new AppError("plugin/cancelled", "Retired"));
    expect(await next).toMatchObject({ code: "plugin/cancelled" });
    const last = f.service.control({ id: "image", action: "close" }).catch(error => error);
    f.reading.begin("other");
    expect(await last).toMatchObject({ code: "reader/superseded" }); expect(f.service.snapshot()).toBeNull();
  } finally { f.binding.dispose(); }
});

test("image observers coalesce during slow callbacks and stop on disposal", async () => {
  const f = fixture(), held = Promise.withResolvers<void>(), values: unknown[] = [];
  const stop = f.service.observe(async value => { values.push(value); if (values.length === 1) await held.promise; });
  try {
    for (let i = 2; i <= 8; i++) f.binding.publish({ ...view, scale: i }, 0);
    expect(values).toHaveLength(1); held.resolve(); await tick();
    expect(values).toHaveLength(2); expect(values[1]).toMatchObject({ scale: 8 });
    stop(); f.binding.dispose(); await tick(); expect(values).toHaveLength(2);
  } finally { held.resolve(); stop(); f.binding.dispose(); }
});

test("plugin image metadata requires reading access and controls require reading write", async () => {
  for (const permissions of [[], ["reading:read"], ["reading:write"], ["library:read"]] as const) {
    const plugin = buildPluginContext({ id: "image-grants", name: "Image", version: "1", schemaVersion: 1, requires: {}, permissions: [...permissions] }, "1", []);
    const image = plugin.context.services.ui.reader?.image;
    expect(!!image).toBe(permissions.some(value => value.startsWith("reading:")));
    expect(!!image?.control).toBe(permissions.some(value => value === "reading:write"));
    plugin.lifecycle.promote();
    if (image) expect(await image.snapshot()).toBeNull();
    plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups();
    if (image?.control) expect(() => image.control!({ id: "old", action: "close" })).toThrow();
  }
});
