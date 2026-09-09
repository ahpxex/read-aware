import { AppError, type WorkspaceTarget } from "@read-aware/core";
import type { createStore } from "jotai";
import { readingRuntime } from "../domain/reading-runtime";
import { listCollections, listLibraryBooks } from "../features/library/lib/library-db";
import { installedPluginsAtom } from "../features/plugins/state/plugin-store";
import { libraryBooksAtom, libraryCollectionsAtom, libraryReadyAtom } from "../features/library/state/library-store";
import { activeCollectionAtom, activeTopNavAtom, commandQueryAtom, commandSearchOpenAtom, settingsOpenAtom, settingsSectionRequestAtom, shelfSelectionAtom } from "../state/ui";

type Store = ReturnType<typeof createStore>;
async function validateTargetData(store: Store, target: WorkspaceTarget, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (target.surface === "settings" && target.section?.startsWith("plugin:")) {
    const id = target.section.slice(7);
    if (!store.get(installedPluginsAtom).some(p => p.manifest.id === id && p.enabled && p.manifest.settings?.length)) {
      throw new AppError("ui/target-not-found", "Plugin settings section is unavailable");
    }
  }
  if (target.surface !== "shelf") return;
  if (target.collectionId) {
    const collections = await listCollections(); signal.throwIfAborted();
    if (!collections.some(c => c.id === target.collectionId)) throw new AppError("ui/target-not-found", "Collection does not exist");
  }
  if (target.selection?.active) {
    const books = await listLibraryBooks(); signal.throwIfAborted();
    if (!books.length) throw new AppError("ui/target-not-found", "Selection mode requires a nonempty library");
    const visible = new Set(books.filter(book => (book.collectionId ?? null) === (target.collectionId ?? null)).map(book => book.id));
    if (target.selection.bookIds.some(id => !visible.has(id))) throw new AppError("ui/target-not-found", "Selected books are missing or outside the target collection");
  }
}

function intentState(store: Store): string {
  return JSON.stringify([store.get(activeTopNavAtom), store.get(activeCollectionAtom), store.get(shelfSelectionAtom),
    store.get(settingsOpenAtom), store.get(settingsSectionRequestAtom), store.get(commandSearchOpenAtom), store.get(commandQueryAtom)]);
}

export async function validateWorkspaceTarget(store: Store, target: WorkspaceTarget, signal: AbortSignal): Promise<void> {
  const before = intentState(store);
  await validateTargetData(store, target, signal);
  signal.throwIfAborted();
  if (before !== intentState(store)) throw new AppError("ui/superseded", "Workspace intent changed during validation");
}

/** Imports and sync notify asynchronously. Do not select against an older UI replica. */
async function waitForLibraryView(store: Store, target: WorkspaceTarget, signal: AbortSignal): Promise<void> {
  if (target.surface !== "shelf") return;
  const ready = () => {
    if (!store.get(libraryReadyAtom)) return false;
    if (target.collectionId && !store.get(libraryCollectionsAtom).some(c => c.id === target.collectionId)) return false;
    const books = store.get(libraryBooksAtom);
    if (target.selection?.active && !books.length) return false;
    const visible = new Set(books.filter(b => (b.collectionId ?? null) === (target.collectionId ?? null)).map(b => b.id));
    return !target.selection || target.selection.bookIds.every(id => visible.has(id));
  };
  signal.throwIfAborted(); if (ready()) return;
  await new Promise<void>((resolve, reject) => {
    const stops: (() => void)[] = [];
    const cleanup = () => { for (const stop of stops) stop(); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const check = () => { if (ready()) { cleanup(); resolve(); } };
    for (const value of [libraryBooksAtom, libraryCollectionsAtom, libraryReadyAtom]) stops.push(store.sub(value, check));
    signal.addEventListener("abort", abort, { once: true }); check();
  });
}

export async function applyWorkspaceTarget(store: Store, target: WorkspaceTarget, signal: AbortSignal, allowReaderClose: boolean): Promise<void> {
  signal.throwIfAborted();
  if (target.surface !== "settings" && target.surface !== "search") {
    const reading = readingRuntime.snapshot();
    if (reading.sessionId) {
      if (!allowReaderClose) throw new AppError("ui/reading-permission", "Leaving the reader requires reading:write");
      const before = intentState(store);
      await readingRuntime.close(signal, { sessionId: reading.sessionId });
      signal.throwIfAborted();
      if (before !== intentState(store)) throw new AppError("ui/superseded", "Native workspace intent changed while closing the reader");
    }
  }
  // Recheck existence after the handoff; a collection/plugin may have retired.
  const before = intentState(store);
  await validateWorkspaceTarget(store, target, signal);
  await waitForLibraryView(store, target, signal);
  signal.throwIfAborted();
  if (before !== intentState(store)) throw new AppError("ui/superseded", "Workspace intent changed during validation");
  if (target.surface === "settings") {
    store.set(commandSearchOpenAtom, false);
    store.set(settingsSectionRequestAtom, target.section ?? "general");
    store.set(settingsOpenAtom, true);
  } else if (target.surface === "search") {
    store.set(settingsOpenAtom, false);
    store.set(commandSearchOpenAtom, true);
    store.set(commandQueryAtom, target.query ?? "");
  } else {
    // No awaits between the final guard and the ephemeral state change.
    if (readingRuntime.snapshot().sessionId) throw new AppError("ui/superseded", "A new reading session owns the screen");
    store.set(settingsOpenAtom, false); store.set(commandSearchOpenAtom, false);
    if (target.surface === "shelf") {
      store.set(activeCollectionAtom, target.collectionId ?? null);
      store.set(shelfSelectionAtom, target.selection ? { active: target.selection.active, ids: target.selection.bookIds } : { active: false, ids: [] });
    }
    store.set(activeTopNavAtom, target.surface);
  }
}
