import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useExternalBookOpens } from "../src/features/library/hooks/useExternalBookOpens";
import type { ExternalOpenBatch } from "../src/features/library/lib/external-open";
import type { BookImportSource, LibraryBook } from "../src/features/library/lib/library-types";
import type { ImportOutcome } from "../src/features/library/lib/book-import";

if (process.env.EXTERNAL_OPEN_CASE === "1") {
  const tick = () => Bun.sleep(0);
  function fixture() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const callbacks = new Map<number, () => void>(), listeners = new Set<number>();
    const batches: ExternalOpenBatch[] = [], commands: string[] = [], imports: BookImportSource[][] = [], opened: string[] = [], errors: unknown[] = [];
    let epoch = "first", callbackId = 0;
    const outcome: ImportOutcome[] = [{ status: "imported", book: { id: "imported-book" } as LibraryBook }];
    const adapter = { take: async (): Promise<ExternalOpenBatch> => batches.shift() ?? { epoch, paths: [] },
      size: async () => 123,
      import: async (): Promise<ImportOutcome[]> => outcome,
      current: async (value: string) => value === epoch,
      listen: async () => {},
    };
    Object.assign(dom.window, { __TAURI_INTERNALS__: {
      transformCallback: (callback: () => void) => { callbacks.set(++callbackId, callback); return callbackId; },
      invoke: async (command: string, args: { epoch: string; handler: number; eventId: number }) => {
        commands.push(command);
        if (command === "external_open_take") return adapter.take();
        if (command === "external_open_is_current") return adapter.current(args.epoch);
        if (command === "book_file_size") return adapter.size();
        if (command === "plugin:event|listen") { await adapter.listen(); listeners.add(args.handler); return args.handler; }
        if (command === "plugin:event|unlisten") listeners.delete(args.eventId);
        return null;
      },
    }, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => callbacks.delete(id) } });
    const root = createRoot(dom.window.document.getElementById("root")!);
    const options = { enabled: true,
      importSources: async (sources: BookImportSource[]) => { imports.push(sources); return adapter.import(); },
      openBook: (book: LibraryBook) => opened.push(book.id), reportError: (error: unknown) => errors.push(error),
    };
    function Consumer({ enabled }: { enabled: boolean }) { useExternalBookOpens({ ...options, enabled }); return null; }
    const render = async (enabled = true) => { await act(async () => { root.render(<StrictMode><Consumer enabled={enabled} /></StrictMode>); await tick(); }); };
    return { adapter, batches, commands, imports, opened, errors, listeners, render, outcome,
      queue: (path: string) => batches.push({ epoch, paths: [path] }),
      revoke: () => { epoch = `${epoch}-changed`; },
      emit: () => { for (const id of listeners) callbacks.get(id)?.(); },
      unmount: async () => { await act(async () => { root.unmount(); await tick(); }); },
      close: () => {
        dom.window.close();
        for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
        }
      },
    };
  }

  test("StrictMode preserves cold requests and concurrent pings serialize imports", async () => {
    const f = fixture(), gate = Promise.withResolvers<ImportOutcome[]>();
    try {
      f.queue("/books/cold.epub"); f.adapter.import = () => gate.promise;
      await f.render(false);
      expect(f.commands).not.toContain("external_open_take");
      await f.render();
      expect(f.imports).toEqual([[{ kind: "native-path", path: "/books/cold.epub", name: "cold.epub", size: 123, externalOpenEpoch: expect.any(String) }]]);
      expect(f.commands.filter(command => command === "external_open_take")).toHaveLength(1);
      f.queue("/books/warm.pdf");
      await act(async () => { f.emit(); f.emit(); await tick(); });
      expect(f.imports).toHaveLength(1);
      f.adapter.import = async () => f.outcome;
      await act(async () => { gate.resolve(f.outcome); await tick(); });
      expect(f.imports).toHaveLength(2);
      expect(f.commands.filter(command => command === "external_open_take")).toHaveLength(2);
      expect(f.opened).toEqual(["imported-book", "imported-book"]);
      expect(f.errors).toEqual([]);
    } finally { await f.unmount(); expect(f.listeners.size).toBe(0); f.close(); }
  });

  test("revocation during file preparation blocks import, including disable then reenable", async () => {
    const f = fixture(), size = Promise.withResolvers<number>();
    try {
      f.queue("/books/old.epub"); f.adapter.size = () => size.promise;
      await f.render();
      f.revoke();
      await act(async () => { size.resolve(100); await tick(); });
      expect(f.imports).toEqual([]); expect(f.opened).toEqual([]);
      f.queue("/books/new.epub"); f.adapter.size = async () => 200;
      await act(async () => { f.emit(); await tick(); });
      expect(f.imports).toHaveLength(1); expect(f.opened).toEqual(["imported-book"]);
    } finally { await f.unmount(); f.close(); }
  });

  test("an already-dispatched import is not undone, but revocation suppresses later navigation", async () => {
    const f = fixture(), imported = Promise.withResolvers<ImportOutcome[]>();
    try {
      f.queue("/books/active.epub"); f.adapter.import = () => imported.promise;
      await f.render(); expect(f.imports).toHaveLength(1);
      f.revoke();
      await act(async () => { imported.resolve(f.outcome); await tick(); });
      expect(f.imports).toHaveLength(1); expect(f.opened).toEqual([]); expect(f.errors).toEqual([]);
    } finally { await f.unmount(); f.close(); }
  });

  test("native policy failures are reported rather than empty success, and a later ping can recover", async () => {
    const f = fixture();
    try {
      f.adapter.take = async () => { throw { code: "settings/unavailable", message: "injected policy load failure" }; };
      await f.render();
      expect(f.errors).toHaveLength(1); expect(f.errors[0]).toMatchObject({ code: "settings/unavailable" });
      expect(f.imports).toEqual([]);
      f.adapter.take = async () => f.batches.shift() ?? { epoch: "first", paths: [] };
      f.queue("/books/recovered.epub");
      await act(async () => { f.emit(); await tick(); });
      expect(f.opened).toEqual(["imported-book"]);
    } finally { await f.unmount(); f.close(); }
  });

  test("unmount prevents late metadata/epoch checks from starting import or surfacing stale errors", async () => {
    const f = fixture(), current = Promise.withResolvers<boolean>();
    try {
      f.queue("/books/late.epub"); f.adapter.current = () => current.promise;
      await f.render(); await f.unmount();
      current.resolve(true); await tick();
      expect(f.imports).toEqual([]); expect(f.opened).toEqual([]); expect(f.errors).toEqual([]);
    } finally { f.close(); }
  });

  test("a ping during failed preparation still drains the next queued batch", async () => {
    const f = fixture(), size = Promise.withResolvers<number>();
    try {
      f.queue("/books/failing.epub"); f.adapter.size = () => size.promise;
      await f.render();
      f.queue("/books/next.epub");
      await act(async () => { f.emit(); await tick(); });
      f.adapter.size = async () => 123;
      await act(async () => { size.reject({ code: "fs/not-found", message: "injected missing file" }); await tick(); });
      expect(f.errors).toHaveLength(1);
      expect(f.imports).toHaveLength(1);
      expect(f.imports[0]?.[0]).toMatchObject({ kind: "native-path", name: "next.epub" });
      expect(f.opened).toEqual(["imported-book"]);
    } finally { await f.unmount(); f.close(); }
  });
} else {
  test("isolated mounted external-open intake contracts", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, EXTERNAL_OPEN_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("6 pass");
  }, 30_000);
}
