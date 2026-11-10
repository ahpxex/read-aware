import { expect, test } from "bun:test";
import { BookContentCache } from "./book-content-cache";

type Book = { id: string; claims: number; closed: boolean };
type Identity = { revision: string; kept: boolean };

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness(keptIdle = 2) {
  const identities = new Map<string, Identity>();
  const versions = new Map<string, string>();
  const prepared: { bookId: string; fetchMissing: boolean; book: Book }[] = [];
  let gate: Promise<void> | null = null;
  let failure: unknown = null;
  const warnings: string[] = [];
  const cache = new BookContentCache<Book, Identity>(
    {
      identity: (bookId) => identities.get(bookId) ?? { revision: "initial", kept: true },
      sameIdentity: (a, b) => a.revision === b.revision && a.kept === b.kept,
      keepIdle: (identity) => identity.kept,
      currentVersion: async (bookId) => versions.get(bookId) ?? "v1",
      prepare: async (bookId, _identity, fetchMissing) => {
        const book: Book = { id: `${bookId}#${prepared.length + 1}`, claims: 0, closed: false };
        prepared.push({ bookId, fetchMissing, book });
        await gate;
        if (failure) throw failure;
        return { book, contentVersion: versions.get(bookId) ?? "v1" };
      },
      retain: (book) => {
        if (book.closed) throw new Error(`${book.id} is closed`);
        book.claims++;
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          if (--book.claims === 0) book.closed = true;
        };
      },
      warn: (message) => warnings.push(message),
    },
    keptIdle,
  );
  return {
    cache,
    identities,
    versions,
    prepared,
    warnings,
    gate: (value: Promise<void> | null) => {
      gate = value;
    },
    fail: (value: unknown) => {
      failure = value;
    },
  };
}

test("leases of one book share one preparation, and it is kept after the last is released", async () => {
  const h = harness();
  const gate = deferred();
  h.gate(gate.promise);
  const first = h.cache.acquire("a");
  const second = h.cache.acquire("a");
  gate.resolve();
  const [one, two] = await Promise.all([first, second]);
  expect(h.prepared).toHaveLength(1);
  expect(one.content.book).toBe(two.content.book);
  const book = one.content.book;
  await one.release();
  await one.release(); // idempotent
  expect(book.closed).toBe(false);
  await two.release();
  // Kept: the next lease gets the same book without another preparation.
  expect(book.closed).toBe(false);
  const again = await h.cache.acquire("a");
  expect(again.content.book).toBe(book);
  expect(h.prepared).toHaveLength(1);
  await again.release();
});

test("content that is not kept is closed with its last lease", async () => {
  const h = harness();
  h.identities.set("v", { revision: "initial", kept: false });
  const lease = await h.cache.acquire("v");
  const book = lease.content.book;
  await lease.release();
  await tick();
  expect(book.closed).toBe(true);
  expect((await h.cache.acquire("v")).content.book).not.toBe(book);
});

test("only the most recently used books stay kept; one asked for again is not pushed out by the release before it", async () => {
  const h = harness(2);
  const open = async (bookId: string) => h.cache.acquire(bookId);
  let held = await open("a");
  for (const bookId of ["b", "c"]) {
    const next = await open(bookId);
    await held.release();
    held = next;
  }
  // a and b are kept, c is held.
  expect(h.prepared.map((entry) => entry.bookId)).toEqual(["a", "b", "c"]);
  // Reopening the oldest kept one while releasing c would overflow the kept
  // ones; the book being opened is claimed first and survives.
  const reopened = h.cache.acquire("a");
  await held.release();
  held = await reopened;
  expect(held.content.book.closed).toBe(false);
  expect(h.prepared).toHaveLength(3);
  await tick();
  // b and c are kept now; a third released book pushes the oldest out.
  const d = await open("d");
  await held.release();
  await tick();
  expect(h.prepared.find((entry) => entry.bookId === "b")!.book.closed).toBe(true);
  expect(h.prepared.find((entry) => entry.bookId === "c")!.book.closed).toBe(false);
  await d.release();
});

test("a kept book whose content changed is prepared again and the old one closed", async () => {
  const h = harness();
  const first = await h.cache.acquire("a");
  const old = first.content.book;
  await first.release();
  h.versions.set("a", "v2");
  const second = await h.cache.acquire("a");
  expect(second.content.book).not.toBe(old);
  expect(second.content.contentVersion).toBe("v2");
  await tick();
  expect(old.closed).toBe(true);
  await second.release();
});

test("another identity gets its own preparation; holders of the earlier one keep a working book until they release", async () => {
  const h = harness();
  const reader = await h.cache.acquire("a");
  const old = reader.content.book;
  h.identities.set("a", { revision: "invalidated", kept: true });
  const query = await h.cache.acquire("a");
  expect(query.content.book).not.toBe(old);
  expect(old.closed).toBe(false);
  await reader.release();
  await tick();
  // Retired: closed with its last lease instead of being kept.
  expect(old.closed).toBe(true);
  await query.release();
  expect(query.content.book.closed).toBe(false);
});

test("retiring a book's content stops new leases from getting it", async () => {
  const h = harness();
  const kept = await h.cache.acquire("a");
  await kept.release();
  h.cache.retire("a");
  await tick();
  expect(kept.content.book.closed).toBe(true);
  const held = await h.cache.acquire("a");
  h.cache.retire("a");
  expect(held.content.book.closed).toBe(false);
  const next = await h.cache.acquire("a");
  expect(next.content.book).not.toBe(held.content.book);
  await held.release();
  await tick();
  expect(held.content.book.closed).toBe(true);
  await next.release();
});

test("a failed preparation fails its leases and is not kept", async () => {
  const h = harness();
  h.fail(new Error("unreadable"));
  await expect(h.cache.acquire("a")).rejects.toThrow("unreadable");
  h.fail(null);
  const lease = await h.cache.acquire("a");
  expect(h.prepared).toHaveLength(2);
  expect(lease.content.book.closed).toBe(false);
  await lease.release();
});

test("a preparation that may not fetch does not answer a lease that may", async () => {
  const h = harness();
  const gate = deferred();
  h.gate(gate.promise);
  const background = h.cache.acquire("a");
  const reader = h.cache.acquire("a", { fetchMissing: true });
  expect(h.prepared.map((entry) => entry.fetchMissing)).toEqual([false, true]);
  gate.resolve();
  const [query, opened] = await Promise.all([background, reader]);
  expect(query.content.book).not.toBe(opened.content.book);
  await query.release();
  await tick();
  expect(query.content.book.closed).toBe(true);
  // Once prepared, the fetching one answers everyone.
  const later = await h.cache.acquire("a");
  expect(later.content.book).toBe(opened.content.book);
  await later.release();
  await opened.release();
});

test("a cancelled lease gives its claim back, and a book given up while preparing is closed when it arrives", async () => {
  const h = harness();
  const gate = deferred();
  h.gate(gate.promise);
  const abort = new AbortController();
  const lease = h.cache.acquire("a", { signal: abort.signal });
  abort.abort(new Error("cancelled"));
  gate.resolve();
  await expect(lease).rejects.toThrow("cancelled");
  await tick();
  // It was prepared and nobody else wanted it while it was: it is kept like any released book.
  expect(h.prepared[0]!.book.closed).toBe(false);
  expect((await h.cache.acquire("a")).content.book).toBe(h.prepared[0]!.book);

  const second = deferred();
  h.gate(second.promise);
  h.identities.set("b", { revision: "initial", kept: false });
  const aborted = new AbortController();
  const pending = h.cache.acquire("b", { signal: aborted.signal });
  // Retired before it finished, with its only lease about to be cancelled.
  h.cache.retire("b");
  aborted.abort(new Error("cancelled"));
  second.resolve();
  await expect(pending).rejects.toThrow("cancelled");
  await tick();
  expect(h.prepared.at(-1)!.book.closed).toBe(true);
  await expect(h.cache.acquire("a", { signal: aborted.signal })).rejects.toThrow("cancelled");
});

test("an adopted book is this book's content until it is given back, and is never closed by the cache", async () => {
  const h = harness();
  const own: Book = { id: "own", claims: 1, closed: false };
  const giveBack = h.cache.adopt("a", own, "v1", { revision: "initial", kept: true });
  const lease = await h.cache.acquire("a");
  expect(lease.content.book).toBe(own);
  expect(h.prepared).toHaveLength(0);
  await lease.release();
  giveBack();
  giveBack();
  await tick();
  // The owner's claim is still there.
  expect(own.closed).toBe(false);
  expect(own.claims).toBe(1);
  expect((await h.cache.acquire("a")).content.book).not.toBe(own);
});
