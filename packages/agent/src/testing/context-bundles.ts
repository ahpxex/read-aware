import { AppError, bookMemoryContextBundle, conversationContextBundle, contextBundleSelector, normalizeContextBundleHistoryQuery,
  normalizeContextBundleReadQuery, profileContextBundle, readingIntentContextBundle, RESOURCE_LIFETIME_MS,
  type ContextBundle, type ContextBundlePort, type ContextBundleSelector, type ResourceRef } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

/** In-process archive over the other in-memory ports. Native tests own clocks, sealing and revocation. */
export function createContextBundleFixture(deps: () => RuntimeDeps): ContextBundlePort & { published(): ContextBundle[] } {
  const archive = new Map<string, { bundle: ContextBundle; publishedAt: string }[]>();
  const exported: ResourceRef[] = [];
  let clock = 0;
  const key = (selector: ContextBundleSelector) => JSON.stringify([selector.kind, selector.scope]);
  const hex = async (value: unknown) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const assemble = async (selector: ContextBundleSelector): Promise<ContextBundle> => {
    const scope = selector.scope;
    if (selector.kind === "user_profile_context") {
      const summary = await deps().profile.getProfileSummary() ?? null, { revision } = await deps().profile.readProfile();
      return (await profileContextBundle({ profile: { summary, revision }, derived: null, sourceConditions: [] })).bundle;
    }
    if (selector.kind === "reading_intent_context") return readingIntentContextBundle(scope.kind === "book" ? { kind: "book", id: scope.id } : { kind: "user" }, []);
    if (selector.kind === "conversation_insights_context") {
      const target = scope.kind === "book" ? { kind: "book" as const, id: scope.id } : { kind: "global" as const, id: scope.kind === "conversation" ? scope.id : "" };
      const summary = await deps().conversations.getInsights(`${target.kind}:${target.id}`) ?? null;
      const status = summary === null ? "absent" as const : "present" as const;
      const revision = `cins1:${await hex(["conversation-insights", 1, target.kind, target.id, status, summary])}`;
      return conversationContextBundle({ target, status, summary, revision }, target);
    }
    const bookId = scope.kind === "book" ? scope.id : "";
    const book = await deps().library.getBook(bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    const memories = (await deps().memory.searchMemories({ scopes: [`book:${bookId}`], limit: 100 })).map(memory => ({ id: memory.id, kind: memory.kind, text: memory.content }));
    const digests = (await deps().bookMemory.listDigests(bookId)).map(digest => ({ index: digest.chapterIndex, href: digest.chapterHref ?? null,
      flavor: digest.flavor ?? null, summary: digest.summary, characters: JSON.stringify(digest.characters), relations: JSON.stringify(digest.relations), version: digest.digestVersion }));
    const finished = book.status === "finished" || book.narrativity === "expository";
    return bookMemoryContextBundle({ bookId, readingStatus: book.status ?? "unread", flavor: book.narrativity ?? null, href: null, format: "epub",
      contentHash: null, textHash: null, memories, annotations: [], digests }, finished ? { kind: "all" } : { kind: "unknown" }, null);
  };
  return {
    published: () => [...archive.values()].flatMap(rows => rows.map(row => row.bundle)),
    async capture(input, signal) {
      const selector = contextBundleSelector(input);
      signal?.throwIfAborted();
      const bundle = await assemble(selector);
      signal?.throwIfAborted();
      const rows = archive.get(key(selector)) ?? [];
      const changed = !rows.some(row => row.bundle.version === bundle.version);
      if (changed) { rows.push({ bundle, publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString() }); archive.set(key(selector), rows); }
      return { bundle, changed, persistence: "event-log" };
    },
    async history(input, signal) {
      const query = normalizeContextBundleHistoryQuery(input);
      signal?.throwIfAborted();
      const rows = [...(archive.get(key(query)) ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.bundle.version.localeCompare(a.bundle.version));
      const revision = `cbhist1:${await hex(rows.map(row => [row.bundle.version, row.publishedAt]))}`;
      if (query.expectedRevision !== undefined && query.expectedRevision !== revision) throw new AppError("memory/conflict", "Context history changed");
      if (query.offset > rows.length) throw new AppError("memory/invalid-query", "Invalid context history offset");
      const items = rows.slice(query.offset, query.offset + query.limit).map(row => ({ version: row.bundle.version, publishedAt: row.publishedAt }));
      const nextOffset = query.offset + items.length < rows.length ? query.offset + items.length : null;
      return { selector: { kind: query.kind, scope: query.scope }, items, offset: query.offset, nextOffset, total: rows.length, revision };
    },
    async read(input, signal) {
      const query = normalizeContextBundleReadQuery(input);
      signal?.throwIfAborted();
      return (archive.get(key(query)) ?? []).find(row => row.bundle.version === query.version)?.bundle ?? null;
    },
    async export(_threadKey, input, signal) {
      const query = normalizeContextBundleReadQuery(input);
      signal?.throwIfAborted();
      const row = (archive.get(key(query)) ?? []).find(row => row.bundle.version === query.version);
      if (!row) throw new AppError("fs/not-found", "Context bundle version is not retained");
      const bytes = new TextEncoder().encode(`${JSON.stringify(row.bundle)}\n`);
      const ref: ResourceRef = { id: crypto.randomUUID(), name: `${row.bundle.content.kind}-${row.bundle.version.slice(4)}.json`, mimeType: "application/json",
        size: bytes.byteLength, state: "ready", source: "context", expiresAt: Date.UTC(2026, 0, 1) + RESOURCE_LIFETIME_MS };
      exported.push(ref);
      return { ...ref };
    },
  };
}
