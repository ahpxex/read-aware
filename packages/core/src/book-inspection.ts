import type { BookFormat } from "./entities";

export type BookFormatCapability = {
  format: Exclude<BookFormat, "virtual">;
  extensions: string[];
  mimeTypes: string[];
};

/** Import routing hints, not a promise that every file with these suffixes is readable. */
export const BOOK_IMPORT_FORMATS: readonly BookFormatCapability[] = [
  { format: "epub", extensions: ["epub"], mimeTypes: ["application/epub+zip"] },
  { format: "pdf", extensions: ["pdf"], mimeTypes: ["application/pdf"] },
  { format: "mobi", extensions: ["mobi", "prc"], mimeTypes: [] },
  { format: "azw3", extensions: ["azw3", "azw", "kf8"], mimeTypes: [] },
  { format: "fb2", extensions: ["fb2", "fb2.zip", "fbz"], mimeTypes: ["application/x-fictionbook+xml"] },
  { format: "cbz", extensions: ["cbz"], mimeTypes: ["application/vnd.comicbook+zip"] },
  { format: "cbr", extensions: ["cbr"], mimeTypes: ["application/vnd.comicbook-rar"] },
  { format: "txt", extensions: ["txt", "text"], mimeTypes: ["text/plain"] },
  { format: "html", extensions: ["html", "htm", "xhtml"], mimeTypes: ["text/html"] },
];

export type BookInspection = {
  /** Same name/MIME/head-based routing hint as import, not a verified container identity. */
  formatHint: BookFormat | null;
  status: "parsed" | "unsupported" | "encrypted" | "failed";
  /** Initialization only: section resources and rendering can still fail later. */
  coverage: "initialization";
  sectionCount: number | null;
  errorCode: string | null;
};
