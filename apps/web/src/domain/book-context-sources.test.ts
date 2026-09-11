import { expect, test } from "bun:test";
import { createBookContextSources } from "./book-context-sources";
import { ReadingSessionController } from "./reading-session-controller";
import fixture from "../../../../packages/core/src/context-bundle-book.fixture.json";
import { normalizeBookContextSnapshot } from "@read-aware/core";

async function host() {
  const source = normalizeBookContextSnapshot(fixture, fixture.bookId), calls: string[] = [];
  source.contentHash = "a".repeat(64);
  const record = { version: 5, bookId: source.bookId, contentVersion: `sha256:${source.contentHash}`, extractedAt: "now", finalized: true,
    sectionCount: 2, required: [0, 1], pieces: [{ sectionIndex: 0, text: "RAW BOOK TEXT" }, { sectionIndex: 1, text: "SECOND RAW" }], failures: [], unsupported: [],
    chapters: [{ text: "RAW BOOK TEXT", hrefs: ["c1.xhtml"] }, { text: "SECOND RAW", hrefs: ["c2.xhtml"] }] };
  let bytes: Uint8Array | null = null;
  const store = async (value: unknown) => {
    bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    source.textHash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
  };
  await store(record);
  const reader = new ReadingSessionController(); let observers = 0;
  const controls = { before: async (_step: string) => {} };
  const owner = createBookContextSources({ reader: { snapshot: () => reader.snapshot(), observe: listener => {
    observers++; const off = reader.observe(listener); return () => { observers--; off(); };
  } }, read: async id => { calls.push(id); await controls.before("read"); return structuredClone(source); },
  blob: async key => { calls.push(key); await controls.before("blob"); return bytes; } });
  const open = (href = "c2.xhtml") => { const session = reader.begin(source.bookId);
    const location = { bookId: source.bookId, contentVersion: record.contentVersion, href };
    reader.attach(session, { navigate: async () => location, step: async () => location }, location); return session; };
  return { source, reader, owner, record, store, calls, controls, open, observers: () => observers, bytes: (value: Uint8Array | null) => { bytes = value; } };
}

test("book producer reads exact durable scope and verified chapter metadata without exporting raw text", async () => {
  const h = await host(), lease = h.owner.open(h.source.bookId);
  const result = await lease.read(); lease.dispose();
  expect(h.calls).toEqual(["book-one", "booktext:book-one"]);
  expect(result.content.items.map(row => row.kind)).toEqual(["annotation", "chapter_digest"]);
  expect(JSON.stringify(result)).not.toContain("RAW BOOK TEXT"); expect(h.observers()).toBe(0);
  h.source.readingStatus = "finished"; h.calls.length = 0;
  h.controls.before = async step => { if (step === "blob") throw Error("Unneeded derived text must not load"); };
  const complete = h.owner.open(h.source.bookId);
  expect((await complete.read()).content.items).toHaveLength(3); complete.dispose();
  expect(h.calls).toEqual(["book-one"]);
});

test("active rewind/loading/wrong-edition override persisted later position; unrelated sessions do not", async () => {
  for (const mode of ["rewind", "loading", "wrong-edition", "other"]) {
    const h = await host();
    if (mode === "rewind") h.open("c1.xhtml");
    if (mode === "loading") h.reader.begin(h.source.bookId);
    if (mode === "wrong-edition") { h.record.contentVersion = "sha256:old"; h.open(); }
    if (mode === "other") h.reader.begin("other");
    const lease = h.owner.open(h.source.bookId), bundle = await lease.read(); lease.dispose();
    expect(bundle.content.items).toHaveLength(mode === "other" ? 2 : 0);
  }
});

test("missing/legacy/incomplete metadata fail closed; corrupt or mismatched bytes reject", async () => {
  for (const mode of ["missing", "legacy", "incomplete", "corrupt", "mismatch"]) {
    const h = await host();
    if (mode === "missing") h.bytes(null);
    if (mode === "legacy") await h.store({ ...h.record, version: 4 });
    if (mode === "incomplete") await h.store({ ...h.record, finalized: false, chapters: [], pieces: [] });
    if (mode === "corrupt") await h.store("{broken");
    if (mode === "mismatch") h.bytes(new Uint8Array([1, 2]));
    const lease = h.owner.open(h.source.bookId);
    if (mode === "corrupt" || mode === "mismatch") await expect(lease.read()).rejects.toMatchObject({ code: mode === "corrupt" ? "db/error" : "memory/conflict" });
    else expect((await lease.read()).content.items).toHaveLength(0);
    lease.dispose();
  }
});

test("position ABA and caller cancellation invalidate the whole source lease", async () => {
  for (const mode of ["read", "blob", "caller"]) {
    const h = await host(), session = h.open(), caller = new AbortController();
    h.controls.before = async step => {
      if (step !== (mode === "caller" ? "read" : mode)) return;
      if (mode === "caller") caller.abort();
      else for (const href of ["c1.xhtml", "c2.xhtml"]) h.reader.relocate(session, { bookId: h.source.bookId, contentVersion: h.record.contentVersion, href }, "");
    };
    const lease = h.owner.open(h.source.bookId, caller.signal);
    await expect(lease.read()).rejects.toBeDefined(); lease.dispose(); expect(h.observers()).toBe(0);
  }
});

test("source failures propagate and scope mismatches never yield a recipe", async () => {
  const h = await host(), lease = h.owner.open(h.source.bookId);
  h.source.bookId = "other";
  await expect(lease.read()).rejects.toMatchObject({ code: "memory/invalid-input" }); lease.dispose();
  expect(() => h.owner.open("bad\0id")).toThrow();
  h.controls.before = async () => { throw Error("read failure"); };
  const failed = h.owner.open("book-one");
  await expect(failed.read()).rejects.toThrow("read failure"); failed.dispose();
});

test("retained book text is disclosed only behind a fence the current reader state admits; editions and rewinds withhold", async () => {
  const h = await host(); h.open("c2.xhtml");
  const lease = h.owner.open(h.source.bookId), fenced = await lease.read(); lease.dispose();
  expect(fenced.content.items).toHaveLength(2);
  await h.owner.disclose(fenced);
  h.open("c1.xhtml");
  await expect(h.owner.disclose(fenced)).rejects.toMatchObject({ code: "memory/forbidden", message: expect.stringContaining("boundary") });
  h.reader.begin("other");
  await h.owner.disclose(fenced);
  h.source.readingStatus = "finished";
  await h.owner.disclose(fenced);
  const full = (await (async () => { const l = h.owner.open(h.source.bookId); try { return await l.read(); } finally { l.dispose(); } })());
  expect(full.content.items).toHaveLength(3);
  h.source.readingStatus = "reading"; h.open("c2.xhtml");
  await expect(h.owner.disclose(full)).rejects.toMatchObject({ code: "memory/forbidden" });
  h.source.contentHash = "b".repeat(64); h.record.contentVersion = `sha256:${h.source.contentHash}`; await h.store(h.record);
  await expect(h.owner.disclose(fenced)).rejects.toMatchObject({ code: "memory/forbidden", message: expect.stringContaining("edition") });
  await expect(h.owner.disclose({ ...fenced, content: { ...fenced.content, kind: "user_profile_context", scope: { kind: "user" } } })).rejects.toMatchObject({ code: "memory/invalid-query" });
  const caller = new AbortController(); caller.abort(new Error("gone"));
  await expect(h.owner.disclose(fenced, caller.signal)).rejects.toMatchObject({ message: "gone" });
});

test("position observation reports changes of the observed book's session state and stops on dispose", async () => {
  const h = await host(), session = h.open("c2.xhtml"), changes: string[] = [];
  const stop = h.owner.observePosition(h.source.bookId, error => { changes.push(error.code); });
  h.reader.relocate(session, { bookId: h.source.bookId, contentVersion: h.record.contentVersion, href: "c2.xhtml" }, "");
  expect(changes).toEqual([]);
  h.reader.relocate(session, { bookId: h.source.bookId, contentVersion: h.record.contentVersion, href: "c1.xhtml" }, "");
  expect(changes).toEqual(["memory/conflict"]);
  stop();
  h.reader.begin("other");
  expect(changes).toEqual(["memory/conflict"]); expect(h.observers()).toBe(0);
  // With no session for that book, only a session of that book (not another one) counts as a change.
  const idle = await host(), idleChanges: string[] = [];
  const stopIdle = idle.owner.observePosition(idle.source.bookId, error => { idleChanges.push(error.code); });
  idle.reader.begin("other"); expect(idleChanges).toEqual([]);
  // Opening that book reports both the new session and its first location; the lease is invalid either way.
  idle.open("c1.xhtml"); expect(idleChanges).toEqual(["memory/conflict", "memory/conflict"]);
  stopIdle(); expect(idle.observers()).toBe(0);
});
