import { actorOrigin } from "../platform/domain-actor";
import { afterEach, expect, spyOn, test } from "bun:test";
import { ResourceOwner, type ResourceAdapter } from "../services/resource-owner";
import { createBookImportTasks } from "./library-import-tasks";
import * as environment from "../platform/environment";
import * as ipc from "../platform/ipc";
import * as blobs from "../platform/blob-store";
import * as events from "../platform/domain-events";
import * as library from "../features/library/lib/library-db";
import { pendingImportPlaceholder } from "../features/library/lib/book-import";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const off of restore.splice(0).reverse()) off();
});
function fixture() {
  const unexpected = async () => {
    throw new Error("Unexpected resource operation");
  };
  let released = false;
  const adapter: ResourceAdapter = {
    create: async () => ({ id: "private-id", name: "book.txt", size: 4, mimeType: "text/plain" }),
    commit: async () => {},
    release: async () => {
      released = true;
    },
    pick: unexpected,
    openBook: unexpected,
    openCover: unexpected,
    read: unexpected,
    append: unexpected,
    commitContext: unexpected,
    save: unexpected,
    copyImage: unexpected,
    imagePreview: unexpected,
  };
  const resources = new ResourceOwner(adapter, () => {}),
    tasks = createBookImportTasks(resources, "plugin:import-test");
  const book = pendingImportPlaceholder("actual-book", { kind: "file", file: new File(["text"], "book.txt") }, "txt");
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const list = spyOn(library, "listLibraryBooks").mockResolvedValue([]);
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  const put = spyOn(blobs, "putDesktopBlob").mockResolvedValue({ sha256: "hash", byteSize: 4 });
  /** What `library_import` answers for a committed import. */
  const staged = {
    status: "imported",
    cover: "none",
    metadataDeferred: false,
    events: [
      {
        type: "book.imported",
        hlc: { wallMs: 1_700_000_000_000, counter: 0, deviceId: "device-a" },
        payload: { bookId: "actual-book", title: "Book" },
      },
    ],
  };
  // A mounted library observer also refreshes reading statistics after import.
  // Keep its projection response distinct from the native import receipt.
  const invoke = spyOn(ipc, "invoke").mockImplementation(
    async (command) =>
      (command === "reading_time_load"
        ? { totals: [], daily: [], hourly: [] }
        : command === "library_import"
          ? staged
          : undefined) as never,
  );
  const commit = spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {});
  const observe = spyOn(events, "observeCommittedStamps").mockImplementation(() => {});
  for (const spy of [native, list, get, put, invoke, commit, observe]) restore.push(() => spy.mockRestore());
  return {
    tasks,
    resources,
    book,
    staged,
    list,
    put,
    invoke,
    commit,
    get released() {
      return released;
    },
  };
}

test("resource task milestones follow native staging and commit; cancellation cannot erase accepted completion", async () => {
  const f = fixture(),
    entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  f.invoke.mockImplementation(async (command) => {
    if (command === "reading_time_load") return { totals: [], daily: [], hourly: [] } as never;
    if (command !== "library_import") return undefined as never;
    entered.resolve();
    await finish.promise;
    return f.staged as never;
  });
  try {
    const ref = await f.resources.create({ name: "book.txt" });
    await f.resources.commit(ref.id);
    const task = await f.tasks.start({ kind: "resource", resourceId: ref.id });
    expect(task.phase).toBe("queued");
    const phases: string[] = [];
    f.tasks.observe(task.taskId, (value) => {
      phases.push(value.phase);
    });
    await entered.promise;
    expect(f.tasks.get(task.taskId)).toMatchObject({ phase: "staging", cancellable: false, receipt: null });
    expect(f.tasks.cancel(task.taskId).cancelRequested).toBe(true);
    const released = f.resources.release(ref.id);
    expect(f.released).toBe(false);
    finish.resolve();
    await f.tasks.drain();
    await released;
    expect(f.tasks.get(task.taskId)).toMatchObject({
      phase: "completed",
      cancelRequested: true,
      receipt: { status: "imported", book: { id: f.book.id } },
    });
    expect(phases).toContain("staging");
    expect(phases.at(-1)).toBe("completed");
    // The native import committed it; the host announces it with the task's actor.
    expect(f.commit.mock.calls[0]?.[0]?.[0]).toMatchObject({ type: "book.imported" });
    expect(actorOrigin(f.commit.mock.calls[0]![0][0]!.origin!)).toBe("plugin:import-test");
    expect(f.released).toBe(true);
  } finally {
    finish.resolve();
    await f.resources.dispose();
    await f.tasks.drain();
  }
});

test("preparation cancellation has no native writes and input bytes are snapshotted before task admission returns", async () => {
  const f = fixture(),
    gate = Promise.withResolvers<void>();
  f.list.mockImplementation(async () => {
    await gate.promise;
    return [];
  });
  try {
    const cancelled = await f.tasks.start({ kind: "file", fileName: "cancel.txt", data: new Uint8Array([1]) });
    f.tasks.cancel(cancelled.taskId);
    gate.resolve();
    await f.tasks.drain();
    expect(f.tasks.get(cancelled.taskId)).toMatchObject({ phase: "cancelled", receipt: null });
    expect(f.put).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    const bytes = new Uint8Array([1, 2, 3]);
    const task = await f.tasks.start({ kind: "file", fileName: "snapshot.txt", data: bytes });
    bytes.fill(9);
    await f.tasks.drain();
    expect(f.put.mock.calls[0][1]).toEqual(new Uint8Array([1, 2, 3]));
    expect(f.tasks.get(task.taskId).phase).toBe("completed");
  } finally {
    gate.resolve();
    await f.resources.dispose();
    await f.tasks.drain();
  }
});

test("only an owned sealed input can start; admission cancellation and owner retirement reject before dispatch", async () => {
  const f = fixture();
  try {
    const ref = await f.resources.create({ name: "book.txt" });
    await expect(f.tasks.start({ kind: "resource", resourceId: ref.id })).rejects.toMatchObject({
      code: "ui/invalid-target",
    });
    await expect(f.tasks.start({ kind: "resource", resourceId: "other-owner" })).rejects.toMatchObject({
      code: "fs/not-found",
    });
    await expect(
      f.tasks.start({ kind: "file", fileName: "a.txt", data: new ArrayBuffer(1) }, AbortSignal.abort()),
    ).rejects.toBeDefined();
    expect(f.tasks.list()).toEqual([]);
    await f.resources.dispose();
    await expect(f.tasks.start({ kind: "file", fileName: "a.txt", data: new ArrayBuffer(1) })).rejects.toMatchObject({
      code: "ui/superseded",
    });
    expect(f.invoke).not.toHaveBeenCalled();
  } finally {
    await f.resources.dispose();
    await f.tasks.drain();
  }
});
