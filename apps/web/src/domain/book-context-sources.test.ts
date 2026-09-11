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
