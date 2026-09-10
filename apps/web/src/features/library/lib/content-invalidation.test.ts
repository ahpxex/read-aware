import { expect, test } from "bun:test";
import { localKV, flushLocalKV } from "../../../platform/local-store";
import { bindVirtualBook, resolveContentProvider } from "../../plugins/lib/virtual-books";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";
import { buildVirtualFoliateBook } from "../../reader/lib/virtual-book";
import { registerActiveBookContent, virtualContentVersion, withBookContent } from "./book-content-source";
import { contentInvalidationRevision } from "./content-invalidation";
import { readingRuntime } from "../../../domain/reading-runtime";
import { createReaderPort } from "../../ai/agent/ports/reader-port";

test("formal plugin invalidation bypasses stale active content and rejects a read invalidated in flight", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const bookId = "invalidation-book", key = "read-aware-virtual-books";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string) => {
      if (command === "library_get_book") return { id: bookId, title: "Feed", format: "virtual", coverStatus: "none" };
      if (command === "library_load") return [{ id: bookId, title: "Feed", format: "virtual", coverStatus: "none" }];
      if (command === "set_kv" || command === "delete_kv") return;
      throw Error(`Unexpected IPC: ${command}`);
    },
  } } });
  const saved = localKV.getItem(key);
  const plugin = buildPluginContext({ id: "content-invalidation", name: "Content", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["library:write"] }, "0.5.4", []);
  const readOnly = buildPluginContext({ id: "content-readonly", name: "Read", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["library:read"] }, "0.5.4", []);
  let detach: (() => void) | undefined;
  try {
    plugin.lifecycle.promote(); readOnly.lifecycle.promote();
    let content = { title: "Before", sections: [{ id: "chapter", html: "Old" }] };
    let loads = 0;
    plugin.context.contributions.contentProviders.register({ id: "feed", load: async () => { loads++; return content; } });
    bindVirtualBook(bookId, { pluginId: "content-invalidation", providerId: "feed", key: "source" });
    await flushLocalKV();
    const oldVersion = await virtualContentVersion(content);
    const oldRevision = contentInvalidationRevision(bookId);
    detach = registerActiveBookContent(bookId, buildVirtualFoliateBook(content), oldVersion,
      resolveContentProvider({ pluginId: "content-invalidation", providerId: "feed", key: "source" }));
    expect(await withBookContent(bookId, oldVersion, undefined, async source => source.book.metadata?.title)).toBe("Before");
    expect(loads).toBe(0);
    bindVirtualBook(bookId, { pluginId: "content-invalidation", providerId: "feed", key: "another-source" });
    await flushLocalKV();
    await withBookContent(bookId, undefined, undefined, async source => source.book.metadata?.title);
    expect(loads).toBe(1);
    bindVirtualBook(bookId, { pluginId: "content-invalidation", providerId: "feed", key: "source" });
    await flushLocalKV();
    content = { title: "After", sections: [{ id: "chapter", html: "New" }] };
    const receipt = await plugin.context.domains.library!.commands!.books.invalidateVirtualBook({ providerId: "feed", key: "source" });
    expect(receipt.bookId).toBe(bookId);
    expect(readOnly.context.domains.library!.commands).toBeUndefined();
    expect(await withBookContent(bookId, undefined, undefined, async source => source.book.metadata?.title)).toBe("After");
    expect(loads).toBe(2);
    await expect(withBookContent(bookId, oldVersion, undefined, async () => "must not succeed")).rejects.toMatchObject({ code: "reader/stale-location" });
    expect(() => registerActiveBookContent(bookId, buildVirtualFoliateBook(content), oldVersion, undefined, oldRevision)).toThrow();
    await expect(withBookContent(bookId, undefined, undefined, async () => {
      await plugin.context.domains.library!.commands!.books.invalidateVirtualBook({ providerId: "feed", key: "source" });
      return "outdated";
    })).rejects.toMatchObject({ code: "reader/stale-location" });
    plugin.lifecycle.stop();
    expect(() => plugin.context.domains.library!.commands!.books.invalidateVirtualBook({ providerId: "feed", key: "source" })).toThrow();
  } finally {
    detach?.(); plugin.lifecycle.stop(); readOnly.lifecycle.stop();
    if (saved === null) localKV.removeItem(key); else localKV.setItem(key, saved);
    await flushLocalKV();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("plugin reload and the Agent port share the current reader and enforce retirement", async () => {
  const plugin = buildPluginContext({ id: "source-reload", name: "Reload", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["reading:write"] }, "0.5.4", []);
  const readOnly = buildPluginContext({ id: "reload-readonly", name: "Read", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["reading:read"] }, "0.5.4", []);
  const id = readingRuntime.begin("reload-book");
  let version = 0;
  const off = readingRuntime.bindShell({ open: (bookId, intent, options) => {
    expect(options).toEqual({ resetPosition: true });
    const session = readingRuntime.begin(bookId, intent);
    const location = { bookId, contentVersion: `new-${++version}`, fraction: 0 };
    readingRuntime.attach(session, { step: async () => location, navigate: async () => location }, location);
  }, close: () => readingRuntime.closed() });
  try {
    plugin.lifecycle.promote(); readOnly.lifecycle.promote();
    expect(readOnly.context.domains.reading!.commands).toBeUndefined();
    const receipt = await plugin.context.domains.reading!.commands!.reload({ sessionId: id });
    expect(receipt.location.contentVersion).toBe("new-1"); expect(receipt.sessionId).not.toBe(id);
    expect((await createReaderPort().reload(undefined, { sessionId: receipt.sessionId })).location.contentVersion).toBe("new-2");
    plugin.lifecycle.stop();
    expect(() => plugin.context.domains.reading!.commands!.reload()).toThrow();
  } finally { off(); plugin.lifecycle.stop(); readOnly.lifecycle.stop(); readingRuntime.closed(); }
});
