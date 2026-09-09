import { afterEach, expect, spyOn, test } from "bun:test";
import { createStore } from "jotai";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../domain/reading-runtime";
import * as db from "../features/library/lib/library-db";
import { activeTopNavAtom, commandQueryAtom, commandSearchOpenAtom, settingsOpenAtom, settingsSectionRequestAtom } from "../state/ui";
import { activeCollectionAtom, shelfSelectionAtom } from "../state/ui";
import { libraryBooksAtom, libraryCollectionsAtom, libraryReadyAtom } from "../features/library/state/library-store";
import { applyWorkspaceTarget, validateWorkspaceTarget } from "./workspace-adapter";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const signal = () => new AbortController().signal;
test("adapter validates collection and selected membership before changing any state", async () => {
  const store = createStore(), s = signal();
  const collections = spyOn(db, "listCollections").mockResolvedValue([]); cleanup.push(() => collections.mockRestore());
  const books = spyOn(db, "listLibraryBooks").mockResolvedValue([{ id: "hidden", collectionId: "other" }] as never); cleanup.push(() => books.mockRestore());
  await expect(validateWorkspaceTarget(store, { surface: "shelf", collectionId: "missing" }, s)).rejects.toMatchObject({ code: "ui/target-not-found" });
  await expect(validateWorkspaceTarget(store, { surface: "shelf", selection: { active: true, bookIds: ["hidden"] } }, s)).rejects.toMatchObject({ code: "ui/target-not-found" });
  await expect(validateWorkspaceTarget(store, { surface: "settings", section: "plugin:missing" }, s)).rejects.toMatchObject({ code: "ui/target-not-found" });
  expect(store.get(activeTopNavAtom)).toBe("shelf"); expect(store.get(settingsOpenAtom)).toBe(false);
});
test("native atom changes during lookups supersede even before React has rendered them", async () => {
  const store = createStore(); let release!: (value: never[]) => void;
  const read = spyOn(db, "listLibraryBooks").mockImplementation(() => new Promise(resolve => { release = resolve as typeof release; })); cleanup.push(() => read.mockRestore());
  const pending = validateWorkspaceTarget(store, { surface: "shelf", selection: { active: true, bookIds: ["book"] } }, signal());
  store.set(activeTopNavAtom, "agent"); release([{ id: "book", collectionId: null }] as never[]);
  await expect(pending).rejects.toMatchObject({ code: "ui/superseded" });
});
test("read failure propagates rather than pretending a collection is missing", async () => {
  const error = new AppError("db/locked", "native private error");
  const read = spyOn(db, "listCollections").mockRejectedValue(error); cleanup.push(() => read.mockRestore());
  await expect(validateWorkspaceTarget(createStore(), { surface: "shelf", collectionId: "book" }, signal())).rejects.toBe(error);
});
test("leaving a reader needs the extra grant and preserves native handoff; overlays never close it", async () => {
  const store = createStore(), s = signal(); let sessionId: string | null = "reader";
  const snapshot = spyOn(readingRuntime, "snapshot").mockImplementation(() => ({ sessionId }) as never); cleanup.push(() => snapshot.mockRestore());
  const close = spyOn(readingRuntime, "close").mockImplementation(async () => { sessionId = null; }); cleanup.push(() => close.mockRestore());
  await expect(applyWorkspaceTarget(store, { surface: "stats" }, s, false)).rejects.toMatchObject({ code: "ui/reading-permission" });
  expect(close).not.toHaveBeenCalled();
  await applyWorkspaceTarget(store, { surface: "settings", section: "reading" }, s, false);
  expect(store.get(settingsSectionRequestAtom)).toBe("reading"); expect(close).not.toHaveBeenCalled();
  await applyWorkspaceTarget(store, { surface: "search", query: "kept" }, s, false);
  expect(store.get(commandQueryAtom)).toBe("kept"); expect(store.get(settingsOpenAtom)).toBe(false); expect(close).not.toHaveBeenCalled();
  await applyWorkspaceTarget(store, { surface: "stats" }, s, true);
  expect(close).toHaveBeenCalledWith(s, { sessionId: "reader" }); expect(store.get(activeTopNavAtom)).toBe("stats");
  expect(store.get(commandSearchOpenAtom)).toBe(false);
  store.set(commandSearchOpenAtom, true); expect(store.get(commandQueryAtom)).toBe("");
});
test("native navigation or reopened reader during close is never overwritten", async () => {
  for (const reopen of [true, false]) {
    const store = createStore(); let sessionId: string | null = "reader";
    const snapshot = spyOn(readingRuntime, "snapshot").mockImplementation(() => ({ sessionId }) as never);
    const close = spyOn(readingRuntime, "close").mockImplementation(async () => {
      sessionId = reopen ? "new-reader" : null;
      if (!reopen) store.set(activeTopNavAtom, "agent");
    });
    try { await expect(applyWorkspaceTarget(store, { surface: "stats" }, signal(), true)).rejects.toMatchObject({ code: "ui/superseded" }); }
    finally { close.mockRestore(); snapshot.mockRestore(); }
    expect(store.get(activeTopNavAtom)).toBe(reopen ? "shelf" : "agent");
  }
});

test("new imports wait for the library replica and cancellation disposes the wait before any selection", async () => {
  const record = { id: "new-book", collectionId: "new-collection" };
  const books = spyOn(db, "listLibraryBooks").mockResolvedValue([record] as never);
  const collections = spyOn(db, "listCollections").mockResolvedValue([{ id: "new-collection" }] as never);
  cleanup.push(() => books.mockRestore(), () => collections.mockRestore());
  for (const cancel of [false, true]) {
    const store = createStore(), abort = new AbortController(); let settled = false;
    const result = applyWorkspaceTarget(store, { surface: "shelf", collectionId: "new-collection", selection: { active: true, bookIds: ["new-book"] } }, abort.signal, false)
      .then(() => { settled = true; }, error => { settled = true; throw error; });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false);
    expect(store.get(shelfSelectionAtom).ids).toEqual([]);
    if (cancel) abort.abort(new AppError("ui/superseded", "retired"));
    if (cancel) await expect(result).rejects.toMatchObject({ code: "ui/superseded" });
    store.set(libraryBooksAtom, [record] as never); store.set(libraryCollectionsAtom, [{ id: "new-collection" }] as never); store.set(libraryReadyAtom, true);
    if (!cancel) await result;
    expect(store.get(shelfSelectionAtom).ids).toEqual(cancel ? [] : ["new-book"]);
    expect(store.get(activeCollectionAtom)).toBe(cancel ? null : "new-collection");
  }
});
