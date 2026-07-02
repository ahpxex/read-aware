/**
 * Annotation types for ReadAware MVP
 * - Highlights: visual markers on text
 * - Notes: user annotations attached to text
 *
 * AI conversation is no longer modeled as a per-selection annotation: the book
 * has one persistent conversation (see `features/ai`). "Ask AI about this" pulls
 * a passage in as an attachment rather than creating an annotation here.
 * - Asks: passive traces of that conversation — every question asked in a book
 *   thread leaves one, anchored at the selection or the reading position
 *   (docs/agent-architecture.md §7). Written by the agent runtime, not the user.
 */

export type AnnotationType = "highlight" | "note" | "ask";

export interface BaseAnnotation {
  id: string;
  bookId: string;
  type: AnnotationType;
  cfiRange: string | null;
  chapterHref: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Highlight extends BaseAnnotation {
  type: "highlight";
  color: "yellow" | "green" | "blue" | "pink";
  /**
   * Visual treatment. A filled highlight or an underline rule. Absent on legacy
   * records, which are treated as `"highlight"`.
   */
  style?: "highlight" | "underline";
}

export interface Note extends BaseAnnotation {
  type: "note";
  content: string;
}

/** 提问痕迹：`text` 是问题本身；锚点在 `cfiRange`（选区或提问时的阅读位置）。 */
export interface Ask extends BaseAnnotation {
  type: "ask";
}

export type Annotation = Highlight | Note | Ask;

export interface AnnotationFilters {
  bookId?: string;
  type?: AnnotationType;
  searchQuery?: string;
}
