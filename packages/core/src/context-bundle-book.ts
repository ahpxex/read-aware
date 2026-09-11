import { AppError } from "./errors";
import { createContextBundle, type ContextBundle, type ContextBundleItem, type ContextBundleOmission } from "./context-bundle";
import type { DigestFlavor } from "./book-memory";

export type BookContextSnapshot = {
  bookId: string; readingStatus: string; flavor: DigestFlavor | null; href: string | null; format: string;
  contentHash: string | null; textHash: string | null;
  memories: { id: string; kind: string; text: string }[];
  annotations: { id: string; kind: string; href: string | null; quote: string; note: string | null }[];
  digests: { index: number; href: string | null; flavor: DigestFlavor | null; summary: string; characters: string; relations: string; version: number }[];
};
export type BookContextBoundary = { kind: "all" } | { kind: "unknown" } | { kind: "before"; chapterIndex: number };
const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid book context source"); };
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== [...keys].sort().join(",")) return invalid();
  return input as Record<string, unknown>;
}
function text(input: unknown, max = 1024 * 1024): string {
  if (typeof input !== "string" || input.length > max || /[\u0000\uD800-\uDFFF]/u.test(input)) return invalid();
  return input;
}
const nullable = (input: unknown) => input === null ? null : text(input);
const id = (input: unknown) => { const value = text(input, 256); if (!value.trim()) return invalid(); return value; };
const flavor = (input: unknown): DigestFlavor | null => input === null || input === "narrative" || input === "expository" ? input : invalid();
const integer = (input: unknown): number => typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : invalid();
function rows<T>(input: unknown, read: (value: unknown) => T, key: (row: T) => string): T[] {
  if (!Array.isArray(input) || input.length > 8192) return invalid();
  const result = input.map(read), keys = result.map(key);
  if (new Set(keys).size !== keys.length) return invalid();
  return result;
}

/** Validate and copy native data before any async hashing or source reads. */
export function normalizeBookContextSnapshot(input: unknown, expectedBookId: string): BookContextSnapshot {
  const value = object(input, ["bookId", "readingStatus", "flavor", "href", "format", "contentHash", "textHash", "memories", "annotations", "digests"]);
  if (id(value.bookId) !== id(expectedBookId)) return invalid();
  const hash = (value: unknown) => value === null ? null : typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : invalid();
  const memories = rows(value.memories, raw => {
    const row = object(raw, ["id", "kind", "text"]);
    if (!["fact", "preference", "insight", "summary"].includes(row.kind as string)) return invalid();
    return { id: id(row.id), kind: row.kind as string, text: text(row.text) };
  }, row => row.id);
  const annotations = rows(value.annotations, raw => {
    const row = object(raw, ["id", "kind", "href", "quote", "note"]);
    if (!["highlight", "note", "ask"].includes(row.kind as string)) return invalid();
    return { id: id(row.id), kind: row.kind as string, href: nullable(row.href), quote: text(row.quote), note: nullable(row.note) };
  }, row => row.id);
  const digests = rows(value.digests, raw => {
    const row = object(raw, ["index", "href", "flavor", "summary", "characters", "relations", "version"]);
    return { index: integer(row.index), href: nullable(row.href), flavor: flavor(row.flavor), summary: text(row.summary),
      characters: text(row.characters), relations: text(row.relations), version: integer(row.version) };
  }, row => String(row.index));
  if (memories.length + annotations.length + digests.length > 8192) return invalid();
  return { bookId: expectedBookId, readingStatus: text(value.readingStatus, 32), flavor: flavor(value.flavor), href: nullable(value.href),
    format: text(value.format, 32), contentHash: hash(value.contentHash), textHash: hash(value.textHash), memories, annotations, digests };
}

export async function bookContextHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function digestGraph(raw: string, relation: boolean): Record<string, unknown>[] {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return invalid(); }
  if (!Array.isArray(input)) return invalid();
  return input.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const allowed = relation ? ["from", "kind", "to", "note"] : ["name", "aliases", "note"];
    if (Object.keys(value).some(key => !allowed.includes(key))) return invalid();
    const row = value as Record<string, unknown>;
    const result: Record<string, unknown> = relation ? { from: text(row.from), kind: text(row.kind), to: text(row.to) } : { name: text(row.name) };
    if (row.note !== undefined) result.note = text(row.note);
    if (!relation && row.aliases !== undefined) {
      if (!Array.isArray(row.aliases)) return invalid();
      result.aliases = row.aliases.map(alias => text(alias));
    }
    return result;
  });
}

/** The caller supplies the host-resolved fence, never an actor's requested chapter. */
export async function bookMemoryContextBundle(input: BookContextSnapshot, inputBoundary: BookContextBoundary, inputChapters: readonly (readonly string[])[] | null) {
  const source = normalizeBookContextSnapshot(input, input.bookId);
  const boundary = { ...object(inputBoundary, inputBoundary?.kind === "before" ? ["kind", "chapterIndex"] : ["kind"]) };
  if (!["all", "unknown", "before"].includes(boundary.kind as string)) return invalid();
  const before = boundary.kind === "before" ? integer(boundary.chapterIndex) : null;
  if (boundary.kind === "all" && source.flavor !== "expository" && source.readingStatus !== "finished") return invalid();
  if (inputChapters !== null && (!Array.isArray(inputChapters) || inputChapters.some(hrefs => !Array.isArray(hrefs)))) return invalid();
  const chapters: string[][] | null = inputChapters === null ? null : inputChapters.map((hrefs: readonly string[]) => hrefs.map(href => text(href)));
  const items: ContextBundleItem[] = [], omissions: ContextBundleOmission[] = [];
  const omit = (kind: ContextBundleOmission["kind"], reason: ContextBundleOmission["reason"]) => {
    const existing = omissions.find(row => row.kind === kind && row.reason === reason);
    if (existing) existing.count++; else omissions.push({ kind, reason, count: 1 });
  };
  const add = async (kind: ContextBundleItem["kind"], id: string, label: string, text: string, provenance: unknown) => {
    if (items.length >= 512) return invalid();
    items.push({ kind, id, label, text, revision: `bitem1:${await bookContextHash([kind, id, label, text, provenance])}` });
  };
  const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  for (const row of source.memories.sort(order)) {
    if (boundary.kind !== "all") omit("memory", "spoiler");
    else await add("memory", row.id, row.kind, row.text, null);
  }
  const locatedBefore = (href: string | null) => {
    if (before === null || !href || !chapters) return false;
    const base = (value: string) => value.split("#")[0];
    const exact = chapters.flatMap((hrefs, index) => hrefs.includes(href) ? [index] : []);
    const matches = exact.length ? exact : chapters.flatMap((hrefs, index) => hrefs.some(candidate => base(candidate) === base(href)) ? [index] : []);
    return matches.length === 1 && matches[0]! < before;
  };
  for (const row of source.annotations.sort(order)) {
    if (boundary.kind !== "all" && !locatedBefore(row.href)) omit("annotation", "spoiler");
    else await add("annotation", row.id, row.kind, JSON.stringify({ quote: row.quote, note: row.note }), row.href);
  }
  for (const row of source.digests.sort((a, b) => a.index - b.index)) {
    if ((row.flavor ?? "narrative") !== (source.flavor ?? "narrative")) { omit("chapter_digest", "unavailable"); continue; }
    if (boundary.kind === "unknown" || before !== null && row.index >= before) { omit("chapter_digest", "spoiler"); continue; }
    await add("chapter_digest", String(row.index), `Chapter ${row.index + 1}`, JSON.stringify({ summary: row.summary,
      entities: digestGraph(row.characters, false), relations: digestGraph(row.relations, true) }), [row.href, row.version, row.flavor ?? "narrative"]);
  }
  const sourceRevision = `bctx1:${await bookContextHash([source.bookId, source.flavor ?? "narrative", source.contentHash, boundary.kind, before,
    chapters, items.map(row => [row.kind, row.id, row.revision]), omissions.map(row => [row.kind, row.reason, row.count])])}`;
  return createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind: "book_memory_context",
    scope: { kind: "book", id: source.bookId }, sourceRevision, items, omissions });
}

export type BookContextFacts = { bookId: string; flavor: DigestFlavor | null; contentHash: string | null; chapters: readonly (readonly string[])[] | null };

/** Recover the fence a retained artifact was assembled behind from its own provenance hash.
 * null means the current edition/chapter map cannot establish it, so its text must be withheld. */
export async function establishBookContextBoundary(bundle: ContextBundle, facts: BookContextFacts): Promise<BookContextBoundary | null> {
  const content = bundle.content;
  if (content.kind !== "book_memory_context" || content.scope.kind !== "book" || content.scope.id !== facts.bookId) return null;
  const items = content.items.map(row => [row.kind, row.id, row.revision]), omissions = content.omissions.map(row => [row.kind, row.reason, row.count]);
  const chapters = facts.chapters === null ? null : facts.chapters.map(hrefs => [...hrefs]);
  const candidates: BookContextBoundary[] = [{ kind: "all" }, { kind: "unknown" }];
  for (let index = 0; index <= (chapters?.length ?? 0); ++index) candidates.push({ kind: "before", chapterIndex: index });
  for (const boundary of candidates) {
    for (const map of chapters === null ? [null] : [null, chapters]) {
      if (boundary.kind === "before" && map === null) continue;
      const before = boundary.kind === "before" ? boundary.chapterIndex : null;
      const hash = await bookContextHash([facts.bookId, facts.flavor ?? "narrative", facts.contentHash, boundary.kind, before, map, items, omissions]);
      if (`bctx1:${hash}` === content.sourceRevision) return boundary;
    }
  }
  return null;
}

/** A retained fence is disclosable only when the host's current fence covers every included row. */
export function bookContextBoundaryAdmits(current: BookContextBoundary, retained: BookContextBoundary): boolean {
  if (current.kind === "all") return true;
  if (retained.kind === "unknown") return true;
  if (current.kind === "unknown" || retained.kind !== "before") return false;
  return retained.chapterIndex <= current.chapterIndex;
}
