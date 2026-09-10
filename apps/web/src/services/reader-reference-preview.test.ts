import { expect, test } from "bun:test";
import type { BookReferencePreview } from "@read-aware/core";
import { ReadingSessionController } from "../domain/reading-session-controller";
import { ReaderReferencePreviewService, type ReferencePreviewView } from "./reader-reference-preview";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";

const query = { reference: { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 } };
const preview = (): BookReferencePreview => ({ reference: { ...query.reference }, status: "resolved", label: "Note", text: "Note text", offset: 0, totalLength: 9, nextOffset: null });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("plugin presentation requires both library reads and reading writes", () => {
  const manifest = { id: "preview-permissions", name: "Preview", version: "1.0.0", schemaVersion: 1, requires: {} };
  for (const permissions of [[], ["library:read"], ["reading:write"], ["library:read", "reading:read"], ["library:read", "reading:write"]] as const) {
    const { context } = buildPluginContext({ ...manifest, permissions: [...permissions] }, "1.0.0", []);
    const allowed = permissions.includes("library:read" as never) && permissions.includes("reading:write" as never);
    expect(typeof context.services.ui.reader?.previewReference === "function").toBe(allowed);
    expect(typeof context.services.ui.reader?.closeReferencePreview === "function").toBe(allowed);
  }
});
function fixture() {
  const reading = new ReadingSessionController(() => {});
  const sessionId = reading.begin("book");
  const location = { bookId: "book", contentVersion: "v1", cfi: "start" };
  reading.attach(sessionId, { navigate: async () => location, step: async () => location }, location);
  const service = new ReaderReferencePreviewService(reading);
  let shown: ReferencePreviewView | null = null;
  let commit: (() => void) | undefined;
  const binding = service.bind(sessionId, "book", {
    present: (view, signal) => new Promise((resolve, reject) => {
      shown = view;
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      commit = () => { signal.removeEventListener("abort", abort); resolve(); };
    }),
    clear: async id => { if (shown?.id === id) shown = null; },
  });
  return { reading, service, binding, sessionId, get shown() { return shown; }, commit: () => commit?.() };
}

test("opening waits for a matching renderer commit; close uses exact owner and ID", async () => {
  const f = fixture(), owner = {}; let settled = false;
  try {
    const opening = f.service.open(owner, query, async () => preview()).then(value => { settled = true; return value; });
    await tick(); expect(f.shown?.preview.text).toBe("Note text"); expect(settled).toBe(false);
    f.commit(); const receipt = await opening;
    expect(receipt.status).toBe("opened");
    if (receipt.status !== "opened") throw Error("Expected opened");
    expect(await f.service.close({}, receipt.id)).toEqual({ status: "not-current", id: receipt.id });
    expect(f.shown).not.toBeNull();
    expect(await f.service.close(owner, receipt.id)).toEqual({ status: "closed", id: receipt.id });
    expect(f.shown).toBeNull();
    expect(await f.service.close(owner, receipt.id)).toEqual({ status: "not-current", id: receipt.id });
  } finally { f.binding.dispose(); }
});

test("replaced reads drain but cannot replace newer or native preview intent", async () => {
  for (const native of [false, true]) {
    const f = fixture(); const oldRead = Promise.withResolvers<BookReferencePreview>(); let signal: AbortSignal | undefined;
    try {
      const old = f.service.open({}, query, async (_query, passed) => { signal = passed; return oldRead.promise; }).catch(error => error);
      if (native) f.binding.interrupt();
      else {
        const next = f.service.open({}, query, async () => preview());
        await tick(); f.commit(); await next;
      }
      const shown = f.shown;
      expect(signal?.aborted).toBe(true);
      oldRead.resolve(preview());
      expect(await old).toMatchObject({ code: "reader/superseded" });
      expect(f.shown).toBe(shown);
    } finally { f.binding.dispose(); }
  }
});

test("missing/external references preserve existing preview; release clears only its actor", async () => {
  const f = fixture(), owner = {};
  try {
    const opening = f.service.open(owner, query, async () => preview()); await tick(); f.commit(); await opening;
    const shown = f.shown;
    expect(await f.service.open({}, query, async () => ({ ...preview(), status: "external", text: "", url: "https://example.com" }))).toMatchObject({ status: "not-opened" });
    expect(f.shown).toBe(shown);
    await f.service.release({}); expect(f.shown).toBe(shown);
    await f.service.release(owner); expect(f.shown).toBeNull();
  } finally { f.binding.dispose(); }
});

test("session changes, cancellation, stale versions and wrong books cannot acknowledge a preview", async () => {
  const f = fixture(); const deferred = Promise.withResolvers<BookReferencePreview>();
  try {
    await expect(f.service.open({}, { reference: { ...query.reference, bookId: "other" } }, async () => preview())).rejects.toMatchObject({ code: "reader/out-of-scope" });
    await expect(f.service.open({}, { reference: { ...query.reference, contentVersion: "v0" } }, async () => preview())).rejects.toMatchObject({ code: "reader/stale-location" });
    const cancelled = new AbortController(); cancelled.abort(new Error("cancelled"));
    await expect(f.service.open({}, query, async () => preview(), cancelled.signal)).rejects.toThrow("cancelled");
    const pending = f.service.open({}, query, async () => deferred.promise).catch(error => error);
    f.reading.begin("other"); deferred.resolve(preview());
    expect(await pending).toMatchObject({ code: "reader/superseded" });
    expect(f.shown).toBeNull();
  } finally { f.binding.dispose(); }
});
