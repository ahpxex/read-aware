import { AppError, type ChapterDigest, type DigestCharacter, type DigestRelation } from "@read-aware/core";

function invalid(field: string): never {
  // Do not include persisted book content in diagnostic messages.
  throw new AppError("db/error", `Invalid chapter memory projection: ${field}`);
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim())) return invalid(field);
  return value;
}
function integer(value: unknown, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return invalid(field);
  return value;
}
function jsonArray(value: unknown, field: string): unknown[] {
  const raw = text(value, field);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return invalid(field); }
  if (!Array.isArray(parsed)) return invalid(field);
  return parsed;
}
function optionalNote(row: Record<string, unknown>): { note?: string } {
  return row.note === undefined ? {} : { note: text(row.note, "note") };
}
function character(value: unknown): DigestCharacter {
  const row = object(value, "character");
  if (row.aliases !== undefined && !Array.isArray(row.aliases)) return invalid("aliases");
  return {
    name: text(row.name, "character.name", true),
    ...(Array.isArray(row.aliases) ? { aliases: row.aliases.map(alias => text(alias, "alias", true)) } : {}),
    ...optionalNote(row),
  };
}
function relation(value: unknown): DigestRelation {
  const row = object(value, "relation");
  return { from: text(row.from, "relation.from", true), kind: text(row.kind, "relation.kind", true),
    to: text(row.to, "relation.to", true), ...optionalNote(row) };
}

/** A corrupt projection is a failed read, never an empty or partially trusted graph. */
export function decodeChapterDigestRows(value: unknown, bookId: string): ChapterDigest[] {
  if (!Array.isArray(value)) return invalid("rows");
  const seen = new Set<number>();
  return value.map(value => {
    const row = object(value, "row");
    if (row.bookId !== bookId) return invalid("bookId");
    const chapterIndex = integer(row.chapterIndex, "chapterIndex", 0);
    if (seen.has(chapterIndex)) return invalid("duplicate chapterIndex");
    seen.add(chapterIndex);
    const flavor = row.flavor;
    if (flavor !== null && flavor !== undefined && flavor !== "narrative" && flavor !== "expository") return invalid("flavor");
    return {
      chapterIndex,
      ...(row.chapterHref == null ? {} : { chapterHref: text(row.chapterHref, "chapterHref") }),
      summary: text(row.summary, "summary"),
      characters: jsonArray(row.charactersJson, "charactersJson").map(character),
      relations: jsonArray(row.relationsJson, "relationsJson").map(relation),
      digestVersion: integer(row.digestVersion, "digestVersion", 1),
      ...(flavor === "narrative" || flavor === "expository" ? { flavor } : {}),
    };
  });
}
