import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { HighlightColor, Id } from "@read-aware/core";
import type { AnnotationItem, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

const highlightColorSchema = Type.Union(
  [
    Type.Literal("yellow"),
    Type.Literal("green"),
    Type.Literal("blue"),
    Type.Literal("pink"),
  ],
  { description: "Highlight color" },
);

function resolveBookId(scope: ThreadScope, raw?: string): Id {
  const target = (raw ?? (scope.kind === "book" ? scope.bookId : undefined)) as Id | undefined;
  if (!target) throw new Error("bookId is required in the global thread");
  return target;
}

function annotationSubject(annotation: AnnotationItem): string {
  if (annotation.kind === "note") return annotation.body.slice(0, 80) || "Untitled note";
  return annotation.text.slice(0, 80) || `${annotation.kind} ${annotation.id}`;
}

export function buildAnnotationTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const createAnnotation: AgentTool = {
    name: "create_annotation",
    label: "Create annotation",
    description:
      "Create a note or a highlight when the user explicitly asks. kind=note needs body (quotedText optional); kind=highlight needs text (the exact quoted passage, color optional). Both can be unanchored, or anchored when anchor/chapterHref are known. bookId defaults to the current book.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("note"), Type.Literal("highlight")], {
        description: "note = the user's own words; highlight = exact book text",
      }),
      body: Type.Optional(Type.String({ description: "Note body (kind=note)" })),
      text: Type.Optional(
        Type.String({ description: "Exact quoted book text (kind=highlight)" }),
      ),
      quotedText: Type.Optional(
        Type.String({ description: "Book text the note refers to (kind=note)" }),
      ),
      color: Type.Optional(highlightColorSchema),
      bookId: Type.Optional(Type.String()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { kind, body, text, quotedText, color, bookId, anchor, chapterHref } = params as {
        kind: "note" | "highlight";
        body?: string;
        text?: string;
        quotedText?: string;
        color?: HighlightColor;
        bookId?: string;
        anchor?: string;
        chapterHref?: string;
      };
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      if (kind === "note") {
        if (!body?.trim()) throw new Error("kind=note requires a non-empty body");
        return textResult(
          await deps.annotations.createNote({
            bookId: target,
            body: body.trim(),
            quotedText: quotedText?.trim() || undefined,
            anchor,
            chapter: chapterHref,
          }),
        );
      }
      if (!text?.trim()) throw new Error("kind=highlight requires non-empty text");
      return textResult(
        await deps.annotations.createHighlight({
          bookId: target,
          text: text.trim(),
          anchor,
          chapter: chapterHref,
          color,
        }),
      );
    },
  };

  const editAnnotation: AgentTool = {
    name: "edit_annotation",
    label: "Edit annotation",
    description:
      "Edit an existing annotation the user clearly identifies: replace a note's body, or change a highlight's color. Pass the field matching the annotation's kind.",
    parameters: Type.Object({
      annotationId: Type.String(),
      body: Type.Optional(Type.String({ description: "New body (notes only)" })),
      color: Type.Optional(highlightColorSchema),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { annotationId, body, color } = params as {
        annotationId: string;
        body?: string;
        color?: HighlightColor;
      };
      if (body === undefined && color === undefined) {
        throw new Error("pass body (note) or color (highlight)");
      }
      const annotation = (await deps.annotations.listAnnotations()).find(
        (entry) => entry.id === annotationId,
      );
      if (!annotation) throw new Error(`annotation not found: ${annotationId}`);
      if (annotation.kind === "note") {
        if (!body?.trim()) throw new Error(`${annotationId} is a note; pass a non-empty body`);
        await deps.annotations.updateNote(annotationId as Id, body.trim());
        return textResult({ updated: true, annotationId, body: body.trim() });
      }
      if (annotation.kind === "highlight") {
        if (!color) throw new Error(`${annotationId} is a highlight; pass color`);
        await deps.annotations.recolorHighlight(annotationId as Id, color);
        return textResult({ updated: true, annotationId, color });
      }
      throw new Error(`${annotationId} is a recorded question and cannot be edited`);
    },
  };

  const deleteAnnotation: AgentTool = {
    name: "delete_annotation",
    label: "Delete annotation",
    description:
      "Permanently delete a note, highlight, or recorded question. The host ALWAYS asks the user for permission before deletion.",
    parameters: Type.Object({ annotationId: Type.String() }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { annotationId } = params as { annotationId: string };
      const annotation = (await deps.annotations.listAnnotations()).find(
        (entry) => entry.id === annotationId,
      );
      if (!annotation) throw new Error(`annotation not found: ${annotationId}`);
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: {
          kind: "permission",
          action: "delete-annotation",
          subject: annotationSubject(annotation),
        },
        signal,
        onUpdate,
      });
      const approved = !answer.cancelled && answer.optionId === "approve";
      if (!approved) return { ...textResult({ deleted: false, reason: "User declined." }), details };
      await deps.annotations.removeAnnotation(annotationId as Id);
      return {
        ...textResult({ deleted: true, annotationId, annotationKind: annotation.kind }),
        details,
      };
    },
  };

  return [createAnnotation, editAnnotation, deleteAnnotation];
}
