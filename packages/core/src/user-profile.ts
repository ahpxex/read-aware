import { AppError } from "./errors";

/** Public access to the summary projection, not the other structured profile fields. */
export type UserProfileSnapshot = { summary: string | null; revision: string };
export type UserProfileQuery = { offset?: number; limit?: number; expectedRevision?: string };
export type UserProfileChange = { summary: string; expectedRevision: string };
export type UserProfileReceipt = { changed: boolean; revision: string; persistence: "event-log" };

export function normalizeUserProfileChange(input: UserProfileChange): UserProfileChange {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "summary" && key !== "expectedRevision")
    || typeof input.summary !== "string" || input.summary.length > 16000
    || typeof input.expectedRevision !== "string" || !/^profile2:[a-f0-9]{64}$/.test(input.expectedRevision)) {
    throw new AppError("memory/invalid-input", "Profile changes require bounded text and the observed revision");
  }
  return { summary: input.summary, expectedRevision: input.expectedRevision };
}
export type UserProfilePage = {
  exists: boolean;
  text: string;
  offset: number;
  nextOffset: number | null;
  totalLength: number;
  revision: string;
  format: "plain-text";
  persistence: "event-log";
};

export function normalizeUserProfileQuery(input: UserProfileQuery = {}): UserProfileQuery & { offset: number; limit: number } {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Invalid profile page query"); };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["offset", "limit", "expectedRevision"].includes(key))) return fail();
  const offset = input.offset === undefined ? 0 : input.offset, limit = input.limit === undefined ? 4000 : input.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 2 || limit > 16000
    || input.expectedRevision !== undefined && (typeof input.expectedRevision !== "string" || !/^profile2:[a-f0-9]{64}$/.test(input.expectedRevision))
    || offset > 0 && input.expectedRevision === undefined) return fail();
  return { offset, limit, ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) };
}

/** Mirrors native snapshot identity; in-memory adapters must rotate eventId on writes. */
export async function userProfileRevision(summary: string | null, eventId: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([summary, eventId]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `profile2:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Page one captured projection snapshot without replacing its native revision. */
export async function userProfilePage(snapshot: UserProfileSnapshot, input: UserProfileQuery = {}): Promise<UserProfilePage> {
  const query = normalizeUserProfileQuery(input), { summary, revision } = snapshot, text = summary ?? "";
  if (query.expectedRevision !== undefined && query.expectedRevision !== revision) throw new AppError("memory/conflict", "Profile changed; restart pagination");
  const splitsPair = (offset: number) => offset > 0 && offset < text.length
    && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff;
  if (query.offset > text.length || splitsPair(query.offset)) throw new AppError("memory/invalid-query", "Invalid profile text offset");
  let end = Math.min(text.length, query.offset + query.limit);
  if (splitsPair(end)) --end;
  return { exists: summary !== null, text: text.slice(query.offset, end), offset: query.offset,
    nextOffset: end < text.length ? end : null, totalLength: text.length, revision,
    format: "plain-text", persistence: "event-log" };
}
