import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../src/domain/library";
import { registerActiveBookContent, withBookContent } from "../../src/features/library/lib/book-content-source";
import { retainBook } from "../../src/features/reader/lib/book-lifetime";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";

/** Inject an explicitly held document load, over an actual imported book/parser. */
export async function runRangeLifetimeProbe(bookId: string) {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
  const books = createLibraryDomain("user").queries.books;
  if (!(await books.get(bookId))?.title.startsWith("Range composition ")) throw Error("Owned range fixture required");
  const range = (await books.searchLocations({ bookId, query: "needle" })).hits[0].range;
  return withBookContent(bookId, range.contentVersion, undefined, async ({ book, contentVersion }) => {
    let enter!: () => void, unblock!: () => void, retired!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const destroyed = new Promise<void>(resolve => { retired = resolve; });
    let destroys = 0;
    const held = { ...book, sections: book.sections.map(section => ({ ...section,
      ...(section.createDocument ? { createDocument: async () => { enter(); await gate; return section.createDocument!(); } } : {}),
    })), destroy: () => { destroys++; retired(); } };
    const releaseOwner = retainBook(held), unregister = registerActiveBookContent(bookId, held, contentVersion);
    const disposables: PluginDisposable[] = [], id = "capability-range-retirement";
    let worker: SandboxedPlugin | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Range retirement timeout")), 10000); });
    try {
      worker = await startPluginWorker({ id, name: "Range retirement", version: "1.0.0", schemaVersion: 1,
        permissions: ["library:read"], requires: { domains: { library: "^1.7.0" } }, description: JSON.stringify(range) }, "0.5.4", disposables,
      { moduleUrl: new URL("./range-lifetime-probe.ts", import.meta.url).href });
      await worker.checkHealth(); worker.promote();
      const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === id)!;
      const pending = Promise.resolve(command.run()).then(() => ({ status: "unexpected-success" }), (error: unknown) => ({ status: "rejected",
        code: error && typeof error === "object" && "code" in error ? error.code : "unknown" }));
      await Promise.race([entered, timeout]);
      unregister(); await releaseOwner();
      const beforeRetirement = destroys;
      let finished = false;
      const stopping = worker.terminate().finally(() => { finished = true; });
      // Observe the RPC cancellation before allowing the physical load to end.
      const outcome = await Promise.race([pending, timeout]);
      const beforeLoadReleased = destroys;
      await new Promise(resolve => setTimeout(resolve, 2300));
      const stoppedBeforeRelease = finished;
      unblock(); await Promise.race([Promise.all([destroyed, stopping]), timeout]);
      return { beforeRetirement, beforeLoadReleased, afterLoadReleased: destroys, stoppedBeforeRelease, outcome };
    } finally {
      unblock(); unregister(); await releaseOwner();
      try { await worker?.terminate(); }
      finally {
      for (const item of disposables.reverse()) item.dispose();
      if (timer) clearTimeout(timer);
      if (inspectContributions(id).length) throw Error("Range retirement left contributions");
      }
    }
  });
}
