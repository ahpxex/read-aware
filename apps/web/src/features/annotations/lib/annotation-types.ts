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
 *   (docs/architecture/agent-architecture.md). Written by the agent runtime, not the user.
 */

export type AnnotationType = "highlight" | "note" | "ask";

export interface BaseAnnotation {
  range?: import("@read-aware/core").BookTextRange;
  id: string;
  bookId: string;
  type: AnnotationType;
  cfiRange: string | null;
  chapterHref: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
  /** Device-local read token, not persisted annotation content. Native observed
   * lists include it; create/search/legacy objects are not editable snapshots. */
  readonly revision?: string;
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

/**
 * The reader's own marks: highlights and notes. An `ask` records a question
 * put to the agent about a passage — it is not something the reader marked,
 * so lists and counts of a book's highlights and notes leave it out.
 */
export function isReaderMark(annotation: Annotation): annotation is Highlight | Note {
  return annotation.type === "highlight" || annotation.type === "note";
}

export interface AnnotationFilters {
  bookId?: string;
  type?: AnnotationType;
  searchQuery?: string;
}
