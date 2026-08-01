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
  const createNote: AgentTool = {
    name: "create_note",
    label: "Create note",
    description:
      "Create a reading note when the user explicitly asks. It can be unanchored, or anchored when quotedText plus an anchor/chapterHref are known. bookId defaults to the current book.",
    parameters: Type.Object({
      body: Type.String(),
      bookId: Type.Optional(Type.String()),
      quotedText: Type.Optional(Type.String()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { body, bookId, quotedText, anchor, chapterHref } = params as {
        body: string;
        bookId?: string;
        quotedText?: string;
        anchor?: string;
        chapterHref?: string;
      };
      if (!body.trim()) throw new Error("note body must not be empty");
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      return textResult(
        await deps.annotations.createNote({
          bookId: target,
          body: body.trim(),
          quotedText: quotedText?.trim() || undefined,
          anchor,
          chapter: chapterHref,
        }),
      );
    },
  };

  const updateNote: AgentTool = {
    name: "update_note",
    label: "Update note",
    description: "Replace an existing note's body when the user clearly identifies the note.",
    parameters: Type.Object({ noteId: Type.String(), body: Type.String() }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { noteId, body } = params as { noteId: string; body: string };
      if (!body.trim()) throw new Error("note body must not be empty");
      const note = (await deps.annotations.listAnnotations()).find(
        (annotation) => annotation.id === noteId,
      );
      if (!note || note.kind !== "note") throw new Error(`note not found: ${noteId}`);
      await deps.annotations.updateNote(noteId as Id, body.trim());
      return textResult({ updated: true, noteId, body: body.trim() });
    },
  };

  const createHighlight: AgentTool = {
    name: "create_highlight",
    label: "Create highlight",
    description:
      "Create a highlight from exact quoted text when the user explicitly asks. Pass anchor/chapterHref when they are known; otherwise the highlight is saved without a location. bookId defaults to the current book.",
    parameters: Type.Object({
      text: Type.String(),
      bookId: Type.Optional(Type.String()),
      anchor: Type.Optional(Type.String()),
      chapterHref: Type.Optional(Type.String()),
      color: Type.Optional(highlightColorSchema),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { text, bookId, anchor, chapterHref, color } = params as {
        text: string;
        bookId?: string;
        anchor?: string;
        chapterHref?: string;
        color?: HighlightColor;
      };
      if (!text.trim()) throw new Error("highlight text must not be empty");
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
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

  const recolorHighlight: AgentTool = {
    name: "recolor_highlight",
    label: "Recolor highlight",
    description: "Change the color of an existing highlight.",
    parameters: Type.Object({
      highlightId: Type.String(),
      color: highlightColorSchema,
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { highlightId, color } = params as {
        highlightId: string;
        color: HighlightColor;
      };
      const highlight = (await deps.annotations.listAnnotations()).find(
        (annotation) => annotation.id === highlightId,
      );
      if (!highlight || highlight.kind !== "highlight") {
        throw new Error(`highlight not found: ${highlightId}`);
      }
      await deps.annotations.recolorHighlight(highlightId as Id, color);
      return textResult({ updated: true, highlightId, color });
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

  return [createNote, updateNote, createHighlight, recolorHighlight, deleteAnnotation];
}
