/**
 * Annotation types for ReadAware MVP
 * - Highlights: visual markers on text
 * - Notes: user annotations attached to text
 * - AIChats: conversation threads about selected text
 */

export type AnnotationType = "highlight" | "note" | "ai-chat";

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
}

export interface Note extends BaseAnnotation {
  type: "note";
  content: string;
}

export interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AIChat extends BaseAnnotation {
  type: "ai-chat";
  messages: AIChatMessage[];
}

export type Annotation = Highlight | Note | AIChat;

export interface AnnotationFilters {
  bookId?: string;
  type?: AnnotationType;
  searchQuery?: string;
}
