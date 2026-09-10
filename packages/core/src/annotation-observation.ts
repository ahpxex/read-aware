import { AppError } from "./errors";
import { normalizeAnnotationPageQuery, type AnnotationPage, type AnnotationPageQuery } from "./annotation-query";
import type { AnnotationSnapshot } from "./annotation-mutations";

export type AnnotationObservationQuery =
  | { kind: "page"; query?: AnnotationPageQuery }
  | { kind: "inspect"; annotationId: string };
export type AnnotationObservationResult =
  | { kind: "page"; page: AnnotationPage }
  | { kind: "inspect"; snapshot: AnnotationSnapshot | null };
/** Subscription-local delivery order, never an annotation mutation revision. */
export type AnnotationObservation = { revision: number } & (
  | { status: "ready"; result: AnnotationObservationResult }
  | { status: "error"; errorCode: string }
);

export function normalizeAnnotationObservation(input: AnnotationObservationQuery): AnnotationObservationQuery {
  const invalid = () => new AppError("annotations/invalid-input", "Invalid annotation observation query");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  if (input.kind === "inspect") {
    if (Object.keys(input).some(key => !["kind", "annotationId"].includes(key))
      || typeof input.annotationId !== "string" || !input.annotationId.trim() || input.annotationId.length > 512) throw invalid();
    return { kind: "inspect", annotationId: input.annotationId };
  }
  if (input.kind !== "page" || Object.keys(input).some(key => !["kind", "query"].includes(key))) throw invalid();
  if (input.query && Object.keys(input.query).some(key => !["bookId", "kind", "query", "cursor", "limit"].includes(key))) throw invalid();
  return { kind: "page", query: normalizeAnnotationPageQuery(input.query) };
}
