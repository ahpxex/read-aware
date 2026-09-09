/** Reports count this finite pass, not a synchronized global graph backlog. */
export interface DigestReport {
  status: "complete" | "partial" | "unavailable";
  reason?: "boundary-unknown" | "no-toc" | "classification-pending";
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
  retryOf?: string;
  revision: number;
  status: BookGraphTaskStatus;
  createdAt: string;
  updatedAt: string;
  report?: DigestReport;
  errorCode?: string;
}
export interface BookGraphTaskPort {
  start(bookId: string, mode: "catch-up" | "rebuild", signal?: AbortSignal): Promise<BookGraphTaskSnapshot>;
  get(bookId: string, taskId: string): Promise<BookGraphTaskSnapshot>;
  list(bookId: string): Promise<BookGraphTaskSnapshot[]>;
  cancel(bookId: string, taskId: string): Promise<BookGraphTaskSnapshot>;
  retry(bookId: string, taskId: string, signal?: AbortSignal): Promise<BookGraphTaskSnapshot>;
}
