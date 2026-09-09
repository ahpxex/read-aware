import { AppError, validateAnnotationMutations, type AnnotationItem, type AnnotationMutation, type AnnotationCommitResult, type AnnotationSnapshot } from "@read-aware/core";

/** Synchronous checks and writes model the native atomic boundary, not SQLite. */
export function createAnnotationMutationFixture(rows: AnnotationItem[]) {
  const generations = new Map<string, number>();
  const revisions = new Map<string, { fingerprint: string; revision: string }>();
  const touch = (id: string) => { generations.set(id, (generations.get(id) ?? 0) + 1); };
  const inspect = (id: string): AnnotationSnapshot | null => {
    const item = rows.find(item => item.id === id);
    if (!item) return null;
    // Revisions are opaque CAS tokens. Keep the fixture usable in both Bun and
    // WebKit without reproducing the native database's hashing implementation.
    const fingerprint = JSON.stringify([item, generations.get(id) ?? 0]);
    let current = revisions.get(id);
    if (current?.fingerprint !== fingerprint) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      current = { fingerprint, revision: `ann1:${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}` };
      revisions.set(id, current);
    }
    return { annotation: structuredClone(item), revision: current.revision };
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
