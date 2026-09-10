import type { BookReferencePreview } from "./book-references";

export type ReaderReferencePreviewReceipt =
  | { status: "opened"; id: string; sessionId: string; preview: BookReferencePreview }
  | { status: "not-opened"; preview: BookReferencePreview };
export type ReaderReferenceCloseReceipt = { status: "closed" | "not-current"; id: string };
