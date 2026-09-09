import type { Id } from "./entities";
import type { ChapterHit } from "./text-search";

/** Derived prose, not an engine Location or a renderable Range. */
export type BookTextHit = ChapterHit & { bookId: Id };

export interface BookTextSearch {
  /** 1-12 nonblank, case-sensitive variants, at most 1024 characters each. */
  queries: string[];
  /** Omit to scan only locally persisted indexes across the shelf. */
  bookId?: string;
  /** Inclusive chapter ceiling; -1 searches no chapters. Requires bookId. */
  throughChapterIndex?: number;
  /** 1-100, default 16. This caps results, not total scanning work. */
  limit?: number;
}
