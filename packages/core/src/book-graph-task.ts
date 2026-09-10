import { AppError } from "./errors";

export interface BookGraphTaskOptions {
  /** Maximum chapter attempts, including empty/failed chapters; not a model-call or billing cap. */
  maxChapters: number;
}

export function normalizeBookGraphTaskOptions(input: unknown, fallback = 20): BookGraphTaskOptions {
  if (input === undefined) return { maxChapters: fallback };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "maxChapters"))
    throw new AppError("memory/invalid-input", "Invalid graph task options");
  const maxChapters = (input as Record<string, unknown>).maxChapters;
  if (typeof maxChapters !== "number" || !Number.isSafeInteger(maxChapters) || maxChapters < 1 || maxChapters > 1000)
    throw new AppError("memory/invalid-input", "Graph chapter limit must be an integer from 1 to 1000");
  return { maxChapters };
}

/** Reports count this finite pass, not a synchronized global graph backlog. */
export interface DigestReport {
  status: "complete" | "partial" | "unavailable";
  reason?: "boundary-unknown" | "no-toc" | "classification-pending" | "chapter-limit";
  eligible: number;
  attempted: number;
  digested: number;
  remaining: number;
  emptyChapters: number[];
  failures: Array<{ chapterIndex: number; errorCode: string }>;
}

export type BookGraphTaskStatus = "queued" | "running" | "cancelling" | "cancelled" | "completed" | "partial" | "unavailable" | "failed";
export interface BookGraphTaskSnapshot {
  taskId: string;
  bookId: string;
  mode: "catch-up" | "rebuild";
  maxChapters: number;
  retryOf?: string;
  revision: number;
  status: BookGraphTaskStatus;
  createdAt: string;
  updatedAt: string;
  report?: DigestReport;
  errorCode?: string;
}
export interface BookGraphTaskPort {
  start(bookId: string, mode: "catch-up" | "rebuild", options?: BookGraphTaskOptions, signal?: AbortSignal): Promise<BookGraphTaskSnapshot>;
  get(bookId: string, taskId: string): Promise<BookGraphTaskSnapshot>;
  list(bookId: string): Promise<BookGraphTaskSnapshot[]>;
  cancel(bookId: string, taskId: string): Promise<BookGraphTaskSnapshot>;
  retry(bookId: string, taskId: string, options?: BookGraphTaskOptions, signal?: AbortSignal): Promise<BookGraphTaskSnapshot>;
}
