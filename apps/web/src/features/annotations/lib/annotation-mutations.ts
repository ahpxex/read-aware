import { AppError, validateAnnotationMutations, type AnnotationCommitResult, type AnnotationMutation, type EventOrigin } from "@read-aware/core";
import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../../../platform/domain-events";
import type { Annotation } from "./annotation-types";

export async function inspectAnnotation(id: string): Promise<{ annotation: Annotation; revision: string } | null> {
  if (typeof id !== "string" || !id.trim() || id.length > 512) throw new AppError("annotations/invalid-input", "Invalid annotation ID");
  if (!isTauri()) throw new AppError("annotations/unavailable", "Annotation storage requires the desktop shell");
  return invoke("annotation_inspect", { id });
}

export async function commitAnnotationMutations(changes: AnnotationMutation[], origin: EventOrigin, signal?: AbortSignal): Promise<AnnotationCommitResult> {
  validateAnnotationMutations(changes);
  if (!isTauri()) throw new AppError("annotations/unavailable", "Annotation storage requires the desktop shell");
  // Only semantic operations enter here; plugins never supply event envelopes.
  const drafts: DomainEventDraft[] = changes.map(change => {
    if (change.op === "updateNote") return { type: "note.updated", payload: { noteId: change.annotationId, body: change.body }, origin };
    if (change.op === "recolorHighlight") return { type: "highlight.recolored", payload: { highlightId: change.annotationId, color: change.color, ...(change.style === undefined ? {} : { style: change.style }) }, origin };
    if (change.kind === "note") return { type: "note.removed", payload: { noteId: change.annotationId }, origin };
    if (change.kind === "highlight") return { type: "highlight.removed", payload: { highlightId: change.annotationId }, origin };
    return { type: "ask.removed", payload: { askId: change.annotationId }, origin };
  });
  const conditions = changes.map(({ annotationId, expectedRevision }) => ({ annotationId, expectedRevision }));
  if (signal?.aborted) throw new AppError("annotations/cancelled", "Cancelled before annotation commit");
  const events = await mintEventRows(drafts);
  if (signal?.aborted) throw new AppError("annotations/cancelled", "Cancelled before annotation commit");
  const result = await invoke<AnnotationCommitResult>("annotations_commit", { events, conditions });
  broadcastDomainEventDrafts(drafts);
  return result;
}
