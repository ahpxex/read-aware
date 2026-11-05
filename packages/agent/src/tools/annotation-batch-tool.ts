import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, validateAnnotationMutations, type AnnotationMutation } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";
import { arr, lit, obj, oneOf, opt, str, union } from "@earendil-works/pi-schema";

const condition = { annotationId: str(), expectedRevision: str() };
export function buildAnnotationBatchTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "apply_annotation_changes",
    label: "Change annotations",
    description:
      "Atomically change 1..100 distinct existing annotations. First get_annotations(annotationId) for each item and use its revision. Update note bodies, recolor/restyle highlights, or remove notes/highlights/questions. Any conflict or transaction failure commits NONE. A lost response is not proof of rollback: inspect the items before deciding what to do. Deletion always requires host approval for the entire batch. On conflict re-read and reconsider; never blindly retry with fresh revisions.",
    parameters: obj({
      changes: arr(
        union([
          obj({ ...condition, op: lit("updateNote"), body: str({ maxLength: 100_000 }) }),
          obj({
            ...condition,
            op: lit("recolorHighlight"),
            color: oneOf(["yellow", "green", "blue", "pink"]),
            style: opt(oneOf(["highlight", "underline"])),
          }),
          obj({
            ...condition,
            op: lit("remove"),
            kind: oneOf(["note", "highlight", "ask"]),
          }),
        ]),
        { minItems: 1, maxItems: 100 },
      ),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { changes } = params as { changes: AnnotationMutation[] };
      validateAnnotationMutations(changes);
      const subjects: string[] = [];
      for (const change of changes) {
        const snapshot = await deps.annotations.inspectAnnotation(change.annotationId);
        if (!snapshot) throw new AppError("annotations/not-found", "Annotation no longer exists");
        if (snapshot.revision !== change.expectedRevision)
          throw new AppError("annotations/conflict", "Annotation changed before approval");
        if (change.op === "remove") {
          const item = snapshot.annotation;
          if (item.kind !== change.kind) throw new AppError("annotations/not-found", "Annotation kind mismatch");
          subjects.push((item.kind === "note" ? item.body : item.text).slice(0, 80) || item.id);
        }
      }
      let details;
      if (subjects.length) {
        const interaction = await requestUserInteraction({
          deps,
          toolCallId,
          threadKey: threadScopeKey(scope),
          request: {
            kind: "permission",
            action: "delete-annotation",
            subject: `${subjects.length} deletions in ${changes.length} atomic changes:\n${subjects.join("\n")}`,
          },
          signal,
          onUpdate,
        });
        details = interaction.details;
        if (interaction.answer.cancelled || interaction.answer.optionId !== "approve")
          return { ...textResult({ committed: false, reason: "User declined." }), details };
      }
      return { ...textResult(await deps.annotations.applyChanges(changes, signal)), details };
    },
  };
}
