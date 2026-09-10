import { AppError } from "./errors";
import { normalizeBookReferenceQuery, normalizeBookReferencesQuery, type BookReference, type BookReferencesQuery } from "./book-references";
import type { ResourceRef } from "./resources";
import type { ReadingLocation } from "./reading-session";

export type BookImageRef = BookReference;
export type BookImagesQuery = BookReferencesQuery;
export type BookImageQuery = { image: BookImageRef };
export type BookImage = { image: BookImageRef; alt: string; location?: ReadingLocation };
export type BookImagesPage = {
  bookId: string; contentVersion: string; sectionIndex: number;
  status: "available" | "unsupported"; items: BookImage[];
  total: number; nextOffset: number | null;
};
export type BookImageResource =
  | { status: "ready"; image: BookImage; resource: ResourceRef }
  | { status: "missing" | "external" | "unsupported"; image: BookImage };
export const normalizeBookImagesQuery = normalizeBookReferencesQuery;
export function normalizeBookImageQuery(value: BookImageQuery): BookImageQuery {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "image")) {
    throw new AppError("library/invalid-query", "Invalid book image query");
  }
  return { image: normalizeBookReferenceQuery({ reference: value.image }).reference };
}
export const BOOK_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
