import { createHash } from "node:crypto";
import { AppError, validateAnnotationMutations, type AnnotationItem, type AnnotationMutation, type AnnotationCommitResult, type AnnotationSnapshot } from "@read-aware/core";

/** Synchronous checks and writes model the native atomic boundary, not SQLite. */
export function createAnnotationMutationFixture(rows: AnnotationItem[]) {
  const generations = new Map<string, number>();
  const touch = (id: string) => { generations.set(id, (generations.get(id) ?? 0) + 1); };
  const inspect = (id: string): AnnotationSnapshot | null => {
    const item = rows.find(item => item.id === id);
    if (!item) return null;
    return { annotation: structuredClone(item), revision: `ann1:${createHash("sha256").update(JSON.stringify([item, generations.get(id) ?? 0])).digest("hex")}` };
  };
  const apply = (changes: AnnotationMutation[]): AnnotationCommitResult => {
    validateAnnotationMutations(changes);
    for (const change of changes) {
      const snapshot = inspect(change.annotationId);
      const kind = change.op === "remove" ? change.kind : change.op === "updateNote" ? "note" : "highlight";
      if (!snapshot || snapshot.annotation.kind !== kind) throw new AppError("annotations/not-found", "Annotation missing or wrong kind");
      if (snapshot.revision !== change.expectedRevision) throw new AppError("annotations/conflict", "Annotation changed");
    }
    for (const change of changes) {
      const index = rows.findIndex(item => item.id === change.annotationId);
      const item = rows[index];
      if (change.op === "remove") rows.splice(index, 1);
      else if (item.kind === "note" && change.op === "updateNote") { item.body = change.body; item.updatedAt = new Date().toISOString(); }
      else if (item.kind === "highlight" && change.op === "recolorHighlight") {
        item.color = change.color; if (change.style !== undefined) item.style = change.style;
        item.updatedAt = new Date().toISOString();
      }
      touch(change.annotationId);
    }
    return { atomic: true, changes: changes.map(({ annotationId }) => ({ annotationId, revision: inspect(annotationId)?.revision ?? null })) };
  };
  return { inspect, apply, touch };
}
