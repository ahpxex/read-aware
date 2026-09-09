/** A local derived-text snapshot, not the book's live reader/search index. */
export type BookTextSnapshot = {
  bookId: string;
  contentVersion: string | null;
  status: "unprepared" | "preparing" | "ready" | "partial" | "unsupported" | "unavailable" | "error";
  /** Text can exist even when the chapter indexing policy retains no chapters. */
  text: "unknown" | "available" | "textless";
  chapterCount: number;
  progress: { total: number; completed: number; failed: number; unsupported: number } | null;
  errorCode?: string;
};
