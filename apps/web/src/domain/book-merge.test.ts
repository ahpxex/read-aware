import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, type BookMergePreview, type BookMergeReceipt } from "@read-aware/core";
import * as environment from "../platform/environment";
import * as ipc from "../platform/ipc";
import * as events from "../platform/domain-events";
import * as appEvents from "../platform/app-events";
import { createActorDomainView } from "./registry";
import { listDuplicateBooks, mergeDuplicateBooks } from "./book-merge";

const restore: Array<() => void> = [];
afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });
function fixture() {
  const preview: BookMergePreview = { revision: `bmg1:${"a".repeat(64)}`,
    keep: { id: "a", title: "Book", author: "Author", createdAt: "1" },
    merged: [{ id: "b", title: "Duplicate", author: "Author", createdAt: "2" }] };
  const receipt: BookMergeReceipt = { committed: true, keepId: "a", redirects: [{ from: "b", to: "a" }] };
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>(command: string) =>
    (command === "library_merge_preview" ? preview : command === "library_merge_commit" ? receipt : null) as T);
  const mint = spyOn(events, "mintEventRows").mockResolvedValue([]);
  const broadcast = spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {});
  const emit = spyOn(appEvents, "emitAppEvent").mockImplementation(() => {});
  for (const mock of [native, invoke, mint, broadcast, emit]) restore.push(() => mock.mockRestore());
  return { preview, receipt, invoke, mint, broadcast, emit };
}

test("duplicate queries respect read grants; merge uses the canonical preview and actor origin", async () => {
  const f = fixture();
  const read = createActorDomainView("plugin:reader", { library: "read" }).library!;
  expect(read.commands).toBeUndefined();
  expect(await read.queries.books.previewMerge("b")).toEqual(f.preview);
  expect(await read.queries.books.resolveId("missing")).toBeNull();
  const write = createActorDomainView("plugin:writer", { library: "write" }).library!;
  expect(await write.commands!.books.mergeDuplicates({ bookId: "b", expectedRevision: f.preview.revision })).toEqual(f.receipt);
  expect(f.mint).toHaveBeenCalledWith([{ type: "book.merged", origin: "plugin:writer", payload: { keepId: "a", mergedId: "b" } }]);
  expect(f.invoke).toHaveBeenLastCalledWith("library_merge_commit", { bookId: "b", expectedRevision: f.preview.revision, events: [] });
  expect(f.broadcast).toHaveBeenCalledTimes(1);
  expect(f.emit).toHaveBeenCalledWith("library-changed", {});
});

test("stale previews, invalid pages and pre-dispatch cancellation cannot commit", async () => {
  const f = fixture();
  await expect(listDuplicateBooks({ limit: 51 })).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(mergeDuplicateBooks({ bookId: "a", expectedRevision: f.preview.revision }, "agent", AbortSignal.abort())).rejects.toBeDefined();
  expect(f.invoke).not.toHaveBeenCalled();
  await expect(mergeDuplicateBooks({ bookId: "a", expectedRevision: `bmg1:${"b".repeat(64)}` }, "agent")).rejects.toMatchObject({ code: "ui/superseded" });
  expect(f.mint).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

test("failed native commits reject without publishing a successful mutation", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async <T>(command: string) => {
    if (command === "library_merge_preview") return f.preview as T;
    throw new AppError("db/locked", "private failure");
  });
  await expect(mergeDuplicateBooks({ bookId: "a", expectedRevision: f.preview.revision }, "agent")).rejects.toMatchObject({ code: "db/locked" });
  expect(f.broadcast).not.toHaveBeenCalled();
  expect(f.emit).not.toHaveBeenCalled();
});
