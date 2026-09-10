import { AppError } from "./errors";
import { normalizeBookRangeQuery, type BookTextRange } from "./book-range";

export type ReadingEmphasisStyle = "highlight" | "underline";
export type ReadingEmphasisWrite = {
  ranges: BookTextRange[];
  style?: ReadingEmphasisStyle;
  /** Omit both fields to create; replacing requires the observed configuration revision. */
  id?: string;
  expectedRevision?: number;
};
export type ReadingEmphasisRef = { id: string; expectedRevision: number };
export type ReadingEmphasisSnapshot = {
  id: string;
  /** Changes when configuration is replaced, not when another page becomes attached. */
  revision: number;
  sessionId: string;
  bookId: string;
  style: ReadingEmphasisStyle;
  count: number;
  /** Ranges attached to rendered documents, not a guarantee of viewport visibility. */
  attached: number;
  status: "attached" | "deferred" | "partial" | "error";
  errorCode?: string;
};
export type ReadingEmphasisReceipt = { status: "completed"; emphasis: ReadingEmphasisSnapshot };
export type ReadingEmphasisRemoval = { status: "completed"; id: string; removed: boolean };

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new AppError("reader/invalid-target", "Invalid temporary emphasis operation");
  }
  return value as Record<string, unknown>;
}
export function normalizeReadingEmphasisRef(value: unknown): ReadingEmphasisRef {
  const raw = object(value, ["id", "expectedRevision"]);
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 256 || typeof raw.expectedRevision !== "number"
    || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 1) throw new AppError("reader/invalid-target", "An observed emphasis identity and revision are required");
  return { id: raw.id, expectedRevision: raw.expectedRevision };
}
export function normalizeReadingEmphasisWrite(value: unknown): ReadingEmphasisWrite & { style: ReadingEmphasisStyle } {
  const raw = object(value, ["ranges", "style", "id", "expectedRevision"]);
  if (!Array.isArray(raw.ranges) || raw.ranges.length < 1 || raw.ranges.length > 64
    || raw.style !== undefined && raw.style !== "highlight" && raw.style !== "underline") throw new AppError("reader/invalid-target", "Emphasis requires 1-64 ranges and a supported style");
  const ranges = raw.ranges.map(range => normalizeBookRangeQuery({ range }).range);
  if (ranges.some(range => range.bookId !== ranges[0].bookId || range.contentVersion !== ranges[0].contentVersion)) {
    throw new AppError("reader/invalid-target", "Emphasis ranges must share one book and content version");
  }
  return { ranges, style: raw.style ?? "highlight", ...(raw.id !== undefined || raw.expectedRevision !== undefined
    ? normalizeReadingEmphasisRef({ id: raw.id, expectedRevision: raw.expectedRevision }) : {}) };
}
