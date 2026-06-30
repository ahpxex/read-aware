/**
 * Annotation types for ReadAware MVP
 * - Highlights: visual markers on text
 * - Notes: user annotations attached to text
 *
 * AI conversation is no longer modeled as a per-selection annotation: the book
 * has one persistent conversation (see `features/ai`). "Ask AI about this" pulls
 * a passage in as an attachment rather than creating an annotation here.
 */

export type AnnotationType = "highlight" | "note";

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

export type Annotation = Highlight | Note;

export interface AnnotationFilters {
  bookId?: string;
  type?: AnnotationType;
  searchQuery?: string;
}
