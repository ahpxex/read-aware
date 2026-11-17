import { expect, test } from "bun:test";
import { createPluginBookAccessPolicy, runFenced } from "./plugin-object-access";
import { ReadingSessionController } from "./reading-session-controller";
import { ResourceOwner, type ResourceAdapter } from "../services/resource-owner";

test("current grants follow the host reader snapshot for synchronous gates", () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    undefined,
    () => current,
  );

  policy.assertBook("book-a", "read");
  current = { bookId: "book-b", sessionId: "session-b" };
  expect(() => policy.assertBook("book-a", "read")).toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  policy.assertBook("book-b", "read");
  expect(policy.filterBooks([{ id: "book-a" }, { id: "book-b" }])).toEqual([{ id: "book-b" }]);
});

test("fixed book grants reject a different result and never use a query id as a widening hint", () => {
  const policy = createPluginBookAccessPolicy({ mode: "book", bookId: "book-a" }, async () => ({
    bookId: "book-a",
    sessionId: "session-a",
  }));

  policy.assertBook("book-a", "read");
  expect(() => policy.assertBook("book-b", "read")).toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  policy.assertReturnedBook("book-a", "result");
  expect(() => policy.assertReturnedBook("book-b", "result")).toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  expect(policy.filterBooks([{ id: "book-a" }, { id: "book-b" }])).toEqual([{ id: "book-a" }]);
});

test("current fences abort and reject a late result when the book or session changes", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  let notify: ((snapshot: typeof current) => unknown) | undefined;
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    (handler) => {
      notify = handler;
      return () => {
        notify = undefined;
      };
    },
    () => current,
  );
  const fence = await policy.beginBook("book-a", "read");
  expect(fence.signal?.aborted).toBe(false);
  current = { bookId: "book-b", sessionId: "session-b" };
  notify?.(current);
  expect(fence.signal?.aborted).toBe(true);
  await expect(fence.assertUnchanged()).rejects.toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  fence.dispose();
  expect(notify).toBeUndefined();
});

test("fixed book current operations still fence the live reader without widening the grant", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  let notify: ((snapshot: typeof current) => unknown) | undefined;
  const policy = createPluginBookAccessPolicy(
    { mode: "book", bookId: "book-a" },
    async () => current,
    (handler) => {
      notify = handler;
      return () => {
        notify = undefined;
      };
    },
    () => current,
  );
  const fence = await policy.beginCurrent("reader.snapshot");
  current = { bookId: "book-b", sessionId: "session-b" };
  notify?.(current);
  expect(fence.signal?.aborted).toBe(true);
  await expect(fence.assertUnchanged()).rejects.toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  fence.dispose();
});

test("resource leases follow a current grant after A to B and reject the old book", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    undefined,
    () => current,
  );
  const adapter: ResourceAdapter = {
    pick: async () => [],
    openBook: async (bookId) => ({
      id: `native-${bookId}`,
      size: 1,
      name: `${bookId}.epub`,
      mimeType: "application/epub+zip",
    }),
    openCover: async () => null,
    create: async (options) => ({
      id: "native-created",
      size: 0,
      name: options.name,
      mimeType: options.mimeType ?? "application/octet-stream",
    }),
    read: async () => new Uint8Array([7]).buffer,
    append: async (_id, offset, bytes) => offset + bytes.length,
    commit: async () => {},
    commitContext: async () => {},
    save: async () => false,
    copyImage: async () => ({ copied: true, width: 1, height: 1 }),
    imagePreview: async () => new Uint8Array([1]).buffer,
    release: async () => {},
  };
  const owner = new ResourceOwner(
    adapter,
    () => {},
    (bookId) => policy.assertBook(bookId, "resource"),
    Date.now,
    (_ref, bookId) => {
      if (bookId) policy.assertBook(bookId, "resource");
    },
  );
  try {
    const a = await owner.openBook("book-a");
    expect(a).not.toBeNull();
    current = { bookId: "book-b", sessionId: "session-b" };
    await expect(owner.read(a!.id, 0, 1)).rejects.toThrow(
      expect.objectContaining({ code: "plugin/object-access-denied" }),
    );
    const b = await owner.openBook("book-b");
    expect(b).not.toBeNull();
    expect((await owner.read(b!.id, 0, 1)).eof).toBe(true);
  } finally {
    await owner.dispose();
  }
});

test("reader fences allow an intended same-book reload or close but reject a different book", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  let notify: ((snapshot: typeof current) => unknown) | undefined;
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    (handler) => {
      notify = handler;
      return () => {
        notify = undefined;
      };
    },
    () => current,
  );
  const reload = await policy.beginCurrent("reading.reload", { allowSessionChange: true });
  current = { bookId: "book-a", sessionId: "session-b" };
  notify?.(current);
  await reload.assertUnchanged();

  const close = await policy.beginCurrent("reading.close", { allowClose: true });
  current = { bookId: "book-b", sessionId: "session-c" };
  notify?.(current);
  expect(close.signal?.aborted).toBe(true);
  await expect(close.assertUnchanged()).rejects.toThrow(
    expect.objectContaining({ code: "plugin/object-access-denied" }),
  );
  close.dispose();
});

test("a close fence accepts the controller's legal transition to no current book", async () => {
  const runtime = new ReadingSessionController();
  const sessionId = runtime.begin("book-a");
  runtime.attach(
    sessionId,
    {
      navigate: async (target) => ({ bookId: target.bookId ?? "book-a", contentVersion: "v1", fraction: 0 }),
      step: async () => ({ bookId: "book-a", contentVersion: "v1", fraction: 0 }),
    },
    { bookId: "book-a", contentVersion: "v1", fraction: 0 },
  );
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => {
      const snapshot = runtime.snapshot();
      return { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
    },
    (handler) => runtime.observe((snapshot) => handler({ bookId: snapshot.bookId, sessionId: snapshot.sessionId })),
    () => {
      const snapshot = runtime.snapshot();
      return { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
    },
  );
  const off = runtime.bindShell({ open: () => {}, close: () => runtime.closed() });
  try {
    const fence = await policy.beginCurrent("reading.close", { allowClose: true });
    await runtime.close(fence.signal, { sessionId });
    expect(runtime.snapshot().bookId).toBeNull();
    expect(fence.signal?.aborted).toBe(false);
    await fence.assertUnchanged();
  } finally {
    off();
    runtime.closed();
  }
});

test("a reload fence follows the real controller shell reopen and checks its loading snapshot", async () => {
  const runtime = new ReadingSessionController();
  const sessionId = runtime.begin("book-a");
  const location = { bookId: "book-a", contentVersion: "v1", fraction: 0 };
  runtime.attach(
    sessionId,
    {
      navigate: async () => location,
      step: async () => location,
    },
    location,
  );
  const observed: Array<{ bookId: string | null; sessionId: string | null; status: string; location: unknown }> = [];
  const offObserved = runtime.observe((snapshot) =>
    observed.push({
      bookId: snapshot.bookId,
      sessionId: snapshot.sessionId,
      status: snapshot.status,
      location: snapshot.location,
    }),
  );
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => {
      const snapshot = runtime.snapshot();
      return { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
    },
    (handler) => runtime.observe((snapshot) => handler({ bookId: snapshot.bookId, sessionId: snapshot.sessionId })),
    () => {
      const snapshot = runtime.snapshot();
      return { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
    },
  );
  const offShell = runtime.bindShell({
    open: (bookId, intent) => {
      const next = runtime.begin(bookId, intent);
      runtime.attach(next, { navigate: async () => location, step: async () => location }, location);
    },
    close: () => runtime.closed(),
  });
  try {
    const fence = await policy.beginCurrent("reading.reload", { allowSessionChange: true });
    const receipt = await runtime.reload(fence.signal, { sessionId });
    await fence.assertUnchanged();
    expect(receipt.location.bookId).toBe("book-a");
    expect(receipt.sessionId).not.toBe(sessionId);
    expect(
      observed.some(
        (snapshot) =>
          snapshot.status === "loading" &&
          snapshot.bookId === "book-a" &&
          snapshot.sessionId !== sessionId &&
          snapshot.location === null,
      ),
    ).toBe(true);
    expect(observed.some((snapshot) => snapshot.bookId === null)).toBe(false);
  } finally {
    offShell();
    offObserved();
    runtime.closed();
  }
});

test("a reader switch during the current snapshot await blocks dispatch before a fence is returned", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  const snapshot = Promise.withResolvers<typeof current>();
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    () => snapshot.promise,
    undefined,
    () => current,
  );
  const opening = policy.beginBook("book-a", "resource.write");
  await Promise.resolve();
  current = { bookId: "book-b", sessionId: "session-b" };
  snapshot.resolve({ bookId: "book-a", sessionId: "session-a" });
  await expect(opening).rejects.toThrow(expect.objectContaining({ code: "plugin/object-access-denied" }));
});

test("a fenced call rejects a result that settled after the reader changed, and releases its observer either way", async () => {
  let current = { bookId: "book-a", sessionId: "session-a" };
  const handlers = new Set<(snapshot: typeof current) => unknown>();
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    () => current,
  );
  expect(await runFenced(policy.beginBook("book-a", "read"), async () => "ok", { verify: () => {} })).toBe("ok");
  expect(handlers.size).toBe(0);
  let aborted = false;
  await expect(
    runFenced(policy.beginBook("book-a", "read"), async (access) => {
      current = { bookId: "book-b", sessionId: "session-b" };
      for (const handler of handlers) handler(current);
      aborted = access.signal.aborted;
      return "late";
    }),
  ).rejects.toMatchObject({ code: "plugin/object-access-denied" });
  expect(aborted).toBe(true);
  expect(handlers.size).toBe(0);
});

test("a retained fence stays with the handed-off work until its access is released", async () => {
  const current = { bookId: "book-a", sessionId: "session-a" };
  const handlers = new Set<unknown>();
  const policy = createPluginBookAccessPolicy(
    { mode: "current" },
    async () => current,
    (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    () => current,
  );
  let release!: () => void;
  let allowed!: () => boolean;
  await runFenced(
    policy.beginBook("book-a", "task"),
    async (access) => {
      release = access.dispose;
      allowed = () => access.isAllowed();
    },
    { retain: true },
  );
  expect(handlers.size).toBe(1);
  expect(allowed()).toBe(true);
  release();
  expect(handlers.size).toBe(0);
  expect(allowed()).toBe(false);
  // A failed verification releases even a retained fence.
  await expect(
    runFenced(policy.beginBook("book-a", "task"), async () => 1, {
      retain: true,
      verify: () => {
        throw new Error("wrong book");
      },
    }),
  ).rejects.toThrow("wrong book");
  expect(handlers.size).toBe(0);
});
