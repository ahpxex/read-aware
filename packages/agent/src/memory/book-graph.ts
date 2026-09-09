import { AppError, type BookGraphQuery, type BookGraphResult, type ChapterDigest, type DigestCharacter, type DigestFlavor } from "@read-aware/core";
import { mergeCharacterRegistry, mergeRelationGraph } from "./chapter-digest";

/** Host/Agent policy only. A public query must never choose its own fence. */
export type BookGraphBoundary = { kind: "all" } | { kind: "before"; chapterIndex: number } | { kind: "unknown" };
export const MAX_GRAPH_NAMES = 8;
export const MAX_GRAPH_ENTITIES = 200;
export const MAX_GRAPH_EDGES = 40;

export function normalizeBookGraphQuery(input: BookGraphQuery): BookGraphQuery {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Expected names or a nonnegative chapter index"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  if (Object.keys(input).some(key => key !== "names" && key !== "chapterIndex")) return fail();
  if (input.names !== undefined && input.chapterIndex !== undefined) return fail();
  if (input.chapterIndex !== undefined) {
    if (!Number.isSafeInteger(input.chapterIndex) || input.chapterIndex < 0) return fail();
    return { chapterIndex: input.chapterIndex };
  }
  if (input.names !== undefined) {
    if (!Array.isArray(input.names) || !input.names.length || input.names.length > MAX_GRAPH_NAMES ||
      input.names.some(name => typeof name !== "string" || !name.trim() || name.length > 256)) return fail();
    return { names: [...new Set(input.names.map(name => name.trim()))] };
  }
  return {};
}

const namesOf = (entity: DigestCharacter) => [entity.name, ...(entity.aliases ?? [])];
const matches = (entity: DigestCharacter, query: string) => namesOf(entity).some(name => {
  const hay = name.toLowerCase(), needle = query.toLowerCase();
  return hay.includes(needle) || needle.includes(hay);
});

/** Filter before merging: a later alias, note or relation must not contaminate an earlier graph. */
export function queryBookGraph(digests: ChapterDigest[], input: BookGraphQuery, boundary: BookGraphBoundary, flavor?: DigestFlavor): BookGraphResult {
  const query = normalizeBookGraphQuery(input);
  if (boundary.kind === "unknown") return { graph: "unavailable", note: "The reader's position is unknown; chapter memory is withheld." };
  if (boundary.kind === "before" && (!Number.isSafeInteger(boundary.chapterIndex) || boundary.chapterIndex < 0)) {
    return { graph: "unavailable", note: "No completed chapter boundary is available." };
  }
  const fence = boundary.kind === "before" ? `graph clamped to chapters before the reader's position (chapter index ${boundary.chapterIndex})` : undefined;
  const meta = fence ? { fence } : {};
  const visible = digests.filter(digest => (!flavor || (digest.flavor ?? "narrative") === flavor) &&
    (boundary.kind !== "before" || digest.chapterIndex < boundary.chapterIndex))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
  if (query.chapterIndex !== undefined) {
    const digest = visible.find(entry => entry.chapterIndex === query.chapterIndex);
    if (!digest) return { ...meta, graph: "miss", note: "No visible, current-flavor digest for that chapter; it may be absent or beyond the reader's position." };
    return structuredClone({ ...meta, graph: "chapter", chapterIndex: digest.chapterIndex, ...(digest.chapterHref ? { chapterHref: digest.chapterHref } : {}), summary: digest.summary, entities: digest.characters, relations: digest.relations });
  }
  if (!visible.length) return { ...meta, graph: "empty", note: "No chapter digests are available within this boundary and flavor. Use the book text for evidence." };
  const registry = mergeCharacterRegistry(visible), edges = mergeRelationGraph(visible);
  const appearsIn = (entity: DigestCharacter) => {
    const names = new Set(namesOf(entity));
    return visible.filter(digest => digest.characters.some(character => namesOf(character).some(name => names.has(name))))
      .map(digest => digest.chapterIndex);
  };
  if (query.names) {
    const hits = registry.filter(entity => query.names!.some(name => matches(entity, name)));
    return { ...meta, graph: "profiles", profiles: hits.slice(0, MAX_GRAPH_ENTITIES).map(entity => {
      const names = new Set(namesOf(entity)), relations = edges.filter(edge => names.has(edge.from) || names.has(edge.to));
      return { ...entity, appearsInChapters: appearsIn(entity), relations: relations.slice(0, MAX_GRAPH_EDGES), relationsTruncated: relations.length > MAX_GRAPH_EDGES };
    }), notFound: query.names.filter(name => !registry.some(entity => matches(entity, name))), truncated: hits.length > MAX_GRAPH_ENTITIES,
    note: "These profiles are distilled chapter memory; verify exact wording in the source text." };
  }
  const entities = registry.map(entity => ({ name: entity.name, ...(entity.aliases ? { aliases: entity.aliases } : {}), chapters: appearsIn(entity).length }))
    .sort((a, b) => b.chapters - a.chapters || a.name.localeCompare(b.name));
  return { ...meta, graph: "overview", chaptersDigested: visible.length,
    chapterRange: [visible[0]!.chapterIndex, visible[visible.length - 1]!.chapterIndex], entityCount: registry.length, edgeCount: edges.length,
    entities: entities.slice(0, MAX_GRAPH_ENTITIES), truncated: entities.length > MAX_GRAPH_ENTITIES,
    note: "Pass names for profiles with relations and provenance chapters. This is distilled memory, not verbatim source text." };
}
