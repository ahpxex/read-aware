import { AppError } from "./errors";
import type { AnnotationItem } from "./read-models";
import type { HighlightColor, HighlightStyle } from "./entities";

/** Revision is an opaque, device-local observation token, not a timestamp. */
export type AnnotationSnapshot = { annotation: AnnotationItem; revision: string };
type Condition = { annotationId: string; expectedRevision: string };
export type AnnotationMutation = Condition & (
  | { op: "updateNote"; body: string }
  | { op: "recolorHighlight"; color: HighlightColor; style?: HighlightStyle }
  | { op: "remove"; kind: AnnotationItem["kind"] }
);
export type AnnotationCommitResult = {
  atomic: true;
  changes: { annotationId: string; revision: string | null }[];
};

export function validateAnnotationMutations(input: AnnotationMutation[]): void {
  const invalid = () => new AppError("annotations/invalid-input", "Invalid annotation mutation batch");
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw invalid();
  const ids = new Set<string>();
  for (const change of input) {
    if (!change || typeof change !== "object" || typeof change.annotationId !== "string" || !change.annotationId.trim()
      || change.annotationId.length > 512 || ids.has(change.annotationId)
      || typeof change.expectedRevision !== "string" || !/^ann1:[a-f0-9]{64}$/.test(change.expectedRevision)) throw invalid();
    ids.add(change.annotationId);
    if (change.op === "updateNote") {
      if (typeof change.body !== "string" || change.body.length > 100_000) throw invalid();
    } else if (change.op === "recolorHighlight") {
      if (!["yellow", "green", "blue", "pink"].includes(change.color)
        || (change.style !== undefined && !["highlight", "underline"].includes(change.style))) throw invalid();
    } else if (change.op !== "remove" || !["highlight", "note", "ask"].includes(change.kind)) throw invalid();
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 1_048_576) throw invalid();
}
