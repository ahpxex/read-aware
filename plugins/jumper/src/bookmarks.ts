import type { PluginDocument, ReadingLocation } from "@read-aware/plugin-types";
import type { JumperContext } from "./types";

export const BOOKMARKS = "bookmarks";
export type Bookmark = { version: 1; name: string; bookTitle: string; kind: "location" | "selection"; target: ReadingLocation };
export const bookmarkCollection = (ctx: JumperContext) => ctx.services.storage.collection(BOOKMARKS);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max;

export function bookmarkName(value: unknown): string | null {
  return text(value, 120) ? value.trim() : null;
}

function targetOf(raw: unknown): ReadingLocation | null {
  if (!object(raw) || !text(raw.bookId, 512) || !text(raw.contentVersion, 256)) return null;
  const target: ReadingLocation = { bookId: raw.bookId, contentVersion: raw.contentVersion };
  if (raw.cfi !== undefined) {
    if (!text(raw.cfi, 8192)) return null;
    target.cfi = raw.cfi;
  } else if (raw.href !== undefined) {
    if (!text(raw.href, 8192)) return null;
    target.href = raw.href;
  }
  else if (typeof raw.fraction === "number" && Number.isFinite(raw.fraction) && raw.fraction >= 0 && raw.fraction <= 1) target.fraction = raw.fraction;
  else return null;
  if (raw.textQuote !== undefined) {
    const quote = raw.textQuote;
    if (!object(quote) || !text(quote.exact, 12000)) return null;
    target.textQuote = { exact: quote.exact };
    for (const key of ["prefix", "suffix"] as const) if (quote[key] !== undefined) {
      if (typeof quote[key] !== "string" || quote[key].length > 2000) return null;
      target.textQuote[key] = quote[key];
    }
  }
  return target;
}

export function parseBookmark(value: unknown): Bookmark | null {
  if (!object(value) || value.version !== 1 || !bookmarkName(value.name) || !text(value.bookTitle, 500)
    || (value.kind !== "location" && value.kind !== "selection")) return null;
  const target = targetOf(value.target);
  if (!target || value.kind === "selection" && !target.cfi) return null;
  return { version: 1, name: bookmarkName(value.name)!, bookTitle: value.bookTitle, kind: value.kind, target };
}

export async function captureBookmark(ctx: JumperContext, kind: Bookmark["kind"]): Promise<Bookmark> {
  const session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.location) {
    throw Object.assign(Error("Bookmark requires a ready reader"), { code: "reader/unavailable" });
  }
  const target = targetOf(kind === "selection" ? session.selection?.range : session.location);
  if (!target || target.bookId !== session.bookId || target.contentVersion !== session.location.contentVersion) {
    throw Object.assign(Error("Bookmark location is unavailable"), { code: "reader/stale-location" });
  }
  const selectionName = session.selection?.text.trim().slice(0, 120);
  const book = await ctx.domains.library.queries.books.get(target.bookId);
  if (!book) throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  const bookTitle = book.title.trim().slice(0, 500) || book.id;
  return { version: 1, name: (kind === "selection" ? selectionName : bookTitle.slice(0, 120)) || bookTitle.slice(0, 120),
    bookTitle, kind, target };
}

export async function writeBookmark(ctx: JumperContext, id: string, data: Bookmark, expectedRevision: string | null) {
  return ctx.services.storage.applyDocuments([{ kind: "put", collection: BOOKMARKS, id, data,
    bookId: data.target.bookId, ...(data.target.cfi ? { anchor: data.target.cfi } : {}), expectedRevision }]);
}

export async function removeBookmark(ctx: JumperContext, doc: PluginDocument) {
  return ctx.services.storage.applyDocuments([{ kind: "delete", collection: BOOKMARKS, id: doc.id, expectedRevision: doc.revision }]);
}

export async function openBookmark(ctx: JumperContext, bookmark: Bookmark) {
  if (!await ctx.domains.library.queries.books.get(bookmark.target.bookId)) {
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  }
  // Never replace a rejected source version with a new version or a fraction guess.
  await ctx.domains.reading.commands.goTo(structuredClone(bookmark.target));
  return { close: true };
}
