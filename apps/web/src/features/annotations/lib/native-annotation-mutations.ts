import { AppError, type AnnotationMutation } from "@read-aware/core";
import type { Annotation, Highlight } from "./annotation-types";
import { commitAnnotationMutations } from "./annotation-mutations";

type NativeChange = { op: "remove" } | { op: "updateNote"; body: string }
  | { op: "recolorHighlight"; color: Highlight["color"]; style?: Highlight["style"] };

/** Use the token that accompanied what the user SAW, never a fresh pre-save read. */
export function observedAnnotationMutation(annotation: Annotation, change: NativeChange): AnnotationMutation {
  if (!annotation.revision) throw new AppError("annotations/conflict", "An observed annotation revision is required");
  const condition = { annotationId: annotation.id, expectedRevision: annotation.revision };
  if (change.op === "remove") return { ...condition, op: "remove", kind: annotation.type };
  if (change.op === "updateNote" && annotation.type !== "note"
    || change.op === "recolorHighlight" && annotation.type !== "highlight") {
    throw new AppError("annotations/invalid-input", "Annotation mutation kind mismatch");
  }
  return { ...condition, ...change };
}

export async function changeObservedAnnotation(annotation: Annotation, change: NativeChange): Promise<void> {
  await commitAnnotationMutations([observedAnnotationMutation(annotation, change)], "user");
}
