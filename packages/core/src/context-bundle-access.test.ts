import { expect, test } from "bun:test";
import fixture from "./context-bundle-book.fixture.json";
import { assertContextBundleGrants, contextBundleSourceDomains } from "./context-bundle-access";
import { bookContextBoundaryAdmits, bookMemoryContextBundle, establishBookContextBoundary, normalizeBookContextSnapshot, type BookContextBoundary } from "./context-bundle-book";
import type { DomainGrants } from "./domains";

test("each recipe names exactly the domains it reads, and book scopes always add the library", () => {
  expect(contextBundleSourceDomains({ kind: "user_profile_context", scope: { kind: "user" } })).toEqual(["memory"]);
  expect(contextBundleSourceDomains({ kind: "reading_intent_context", scope: { kind: "user" } })).toEqual(["memory"]);
  expect(contextBundleSourceDomains({ kind: "reading_intent_context", scope: { kind: "book", id: "b" } })).toEqual(["memory", "library"]);
  expect(contextBundleSourceDomains({ kind: "book_memory_context", scope: { kind: "book", id: "b" } })).toEqual(["memory", "annotations", "library"]);
  expect(contextBundleSourceDomains({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t" } })).toEqual(["memory", "conversations"]);
  expect(contextBundleSourceDomains({ kind: "conversation_insights_context", scope: { kind: "book", id: "b" } })).toEqual(["memory", "conversations", "library"]);
  expect(() => contextBundleSourceDomains({ kind: "book_memory_context", scope: { kind: "user" } })).toThrow();
});

test("grants are checked per source domain; publication needs memory write, never a selector trick", () => {
  const book = { kind: "book_memory_context" as const, scope: { kind: "book" as const, id: "b" } };
  const conversation = { kind: "conversation_insights_context" as const, scope: { kind: "conversation" as const, id: "t" } };
  const profile = { kind: "user_profile_context" as const, scope: { kind: "user" as const } };
  const forbidden = (grants: DomainGrants, selector: typeof book | typeof conversation | typeof profile, access: "read" | "write", message: string) =>
    expect(() => assertContextBundleGrants(grants, selector, access)).toThrow(expect.objectContaining({ code: "memory/forbidden", message: expect.stringContaining(message) }));
  expect(() => assertContextBundleGrants({ memory: "read" }, profile, "read")).not.toThrow();
  forbidden({ memory: "read" }, profile, "write", "memory write");
  forbidden({ annotations: "write", library: "write" }, book, "read", "memory");
  forbidden({ memory: "write", library: "read" }, book, "read", "annotations");
  forbidden({ memory: "write", annotations: "read" }, book, "write", "library");
  expect(() => assertContextBundleGrants({ memory: "write", annotations: "read", library: "read" }, book, "write")).not.toThrow();
  forbidden({ memory: "write" }, conversation, "read", "conversations");
  expect(() => assertContextBundleGrants({ memory: "read", conversations: "read" }, conversation, "read")).not.toThrow();
  forbidden({ memory: "read", conversations: "write" }, conversation, "write", "memory write");
});

const chapters = [["c1.xhtml"], ["c2.xhtml"], ["c3.xhtml"]];
function source() {
  const snapshot = normalizeBookContextSnapshot(fixture, fixture.bookId);
  snapshot.contentHash = "a".repeat(64);
  return snapshot;
}
const facts = (snapshot = source(), map: readonly (readonly string[])[] | null = chapters) =>
  ({ bookId: snapshot.bookId, flavor: snapshot.flavor, contentHash: snapshot.contentHash, chapters: map });

test("a retained artifact's fence is recovered from its own provenance, never guessed from a version ID", async () => {
  const snapshot = source();
  for (const boundary of [{ kind: "before", chapterIndex: 0 }, { kind: "before", chapterIndex: 1 }, { kind: "before", chapterIndex: 2 }, { kind: "unknown" }] as BookContextBoundary[]) {
    const bundle = await bookMemoryContextBundle(snapshot, boundary, boundary.kind === "unknown" ? null : chapters);
    expect(await establishBookContextBoundary(bundle, facts())).toEqual(boundary);
  }
  const finished = { ...snapshot, readingStatus: "finished" };
  const full = await bookMemoryContextBundle(finished, { kind: "all" }, null);
  expect(await establishBookContextBoundary(full, facts(finished, null))).toEqual({ kind: "all" });
  expect(await establishBookContextBoundary(full, facts(finished))).toEqual({ kind: "all" });
  const fenced = await bookMemoryContextBundle(snapshot, { kind: "before", chapterIndex: 1 }, chapters);
  expect(await establishBookContextBoundary(fenced, facts({ ...snapshot, contentHash: "b".repeat(64) }))).toBeNull();
  expect(await establishBookContextBoundary(fenced, facts({ ...snapshot, flavor: "expository" }))).toBeNull();
  expect(await establishBookContextBoundary(fenced, facts(snapshot, [["c1.xhtml"], ["other.xhtml"]]))).toBeNull();
  expect(await establishBookContextBoundary(fenced, facts(snapshot, null))).toBeNull();
  expect(await establishBookContextBoundary(fenced, { ...facts(), bookId: "another" })).toBeNull();
  const tampered = structuredClone(fenced);
  tampered.content.items[0]!.revision = `bitem1:${"0".repeat(64)}`;
  expect(await establishBookContextBoundary(tampered, facts())).toBeNull();
});

test("admission requires the current fence to cover the retained one; unknown current state withholds fenced text", () => {
  const before = (chapterIndex: number): BookContextBoundary => ({ kind: "before", chapterIndex });
  const all: BookContextBoundary = { kind: "all" }, unknown: BookContextBoundary = { kind: "unknown" };
  expect(bookContextBoundaryAdmits(all, all)).toBe(true);
  expect(bookContextBoundaryAdmits(all, before(4))).toBe(true);
  expect(bookContextBoundaryAdmits(all, unknown)).toBe(true);
  expect(bookContextBoundaryAdmits(before(2), before(2))).toBe(true);
  expect(bookContextBoundaryAdmits(before(2), before(1))).toBe(true);
  expect(bookContextBoundaryAdmits(before(2), before(3))).toBe(false);
  expect(bookContextBoundaryAdmits(before(2), all)).toBe(false);
  expect(bookContextBoundaryAdmits(before(2), unknown)).toBe(true);
  expect(bookContextBoundaryAdmits(unknown, unknown)).toBe(true);
  expect(bookContextBoundaryAdmits(unknown, before(0))).toBe(false);
  expect(bookContextBoundaryAdmits(unknown, all)).toBe(false);
});
