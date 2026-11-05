import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  AppError,
  normalizeBookRangeQuery,
  type BookTextRange,
  type HighlightColor,
  type HighlightStyle,
  type Id,
} from "@read-aware/core";
import type { AnnotationItem, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";
import { bookRangeSchema } from "./book-range-schema";
import type { AgentTurnState } from "./turn-state";
import { buildAnnotationBatchTool } from "./annotation-batch-tool";
import { obj, oneOf, opt, str } from "@earendil-works/pi-schema";

const highlightColorSchema = oneOf(["yellow", "green", "blue", "pink"], { description: "Highlight color" });

function annotationSubject(annotation: AnnotationItem): string {
  if (annotation.kind === "note") return annotation.body.slice(0, 80) || "Untitled note";
  return annotation.text.slice(0, 80) || `${annotation.kind} ${annotation.id}`;
}

/**
 * The host has already captured this exact range from the current reader.
 * That source is usable for the requested annotation even when the turn's
 * narrative fence blocks arbitrary future-range reads.  Matching the CFI,
 * book and source version keeps the exemption tied to this active selection;
 * source validation below still checks the supplied quote.
 */
async function isCurrentReaderSelection(deps: RuntimeDeps, bookId: string, range: BookTextRange): Promise<boolean> {
  const session = await deps.reader.getSession();
  const selected = session.selection?.range;
  return (
    session.status === "ready" &&
    session.bookId === bookId &&
    session.location?.bookId === bookId &&
    session.location.contentVersion === range.contentVersion &&
    selected?.bookId === range.bookId &&
    selected.contentVersion === range.contentVersion &&
    selected.cfi === range.cfi
  );
}

export function buildAnnotationTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  const createAnnotation: AgentTool = {
    name: "create_annotation",
    label: "Create annotation",
    description:
      'Create a note or a highlight when the user explicitly asks. When the reader asks to note something down ("记条笔记", "note this", "帮我记一下"), THIS is the tool — the note must land in the book\'s annotation list where the reader can see it; the remember tool (invisible long-term memory) is never a substitute for a requested note. kind=note needs body (quotedText optional); kind=highlight needs text (the exact quoted passage, color optional). For a selected passage or a quoted attachment, first obtain its complete source range from get_reading_session. If no matching active selection exists, find_book_locations must search the entire quoted passage including punctuation; copy the returned range unchanged for both the highlight and its attached note. A match range covers only the query match, not surrounding excerpt text: textQuote cannot extend it. Never shorten the requested passage or rewrite its CFI to make a write succeed. Supply the complete exact source text and do not pass separate anchor/chapterHref with range. The source version and quote are validated and preserved. Unanchored notes are for standalone notes without a requested source attachment; an unanchored write does not fulfill a request to mark or attach a note to a passage and must not be reported as attached. Legacy anchor inputs remain supported. bookId defaults to the current book.',
    parameters: obj({
      kind: oneOf(["note", "highlight"], {
        description: "note = the user's own words; highlight = exact book text",
      }),
      body: opt(
        str({
          description:
            "Note body (kind=note). When the user dictates the note text, preserve their words and punctuation exactly; compose or rewrite only when requested.",
        }),
      ),
      text: opt(str({ description: "Exact quoted book text (kind=highlight)" })),
      quotedText: opt(str({ description: "Book text the note refers to (kind=note)" })),
      color: opt(highlightColorSchema),
      style: opt(
        oneOf(["highlight", "underline"], {
          description:
            "Mark style (kind=highlight); defaults to highlight. Use underline when the user requests underlining.",
        }),
      ),
      range: opt(bookRangeSchema),
      bookId: opt(str()),
      anchor: opt(str()),
      chapterHref: opt(str()),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const {
        kind,
        body,
        text,
        quotedText,
        color,
        style,
        bookId,
        anchor,
        chapterHref,
        range: rawRange,
      } = params as {
        kind: "note" | "highlight";
        range?: BookTextRange;
        body?: string;
        text?: string;
        quotedText?: string;
        color?: HighlightColor;
        style?: HighlightStyle;
        bookId?: string;
        anchor?: string;
        chapterHref?: string;
      };
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      const range = rawRange === undefined ? undefined : normalizeBookRangeQuery({ range: rawRange }).range;
      if (range) {
        if (range.bookId !== target || anchor !== undefined || chapterHref !== undefined) {
          throw new AppError(
            "annotations/invalid-input",
            "Range must identify the target book without separate anchor fields",
          );
        }
        const activeSelection =
          scope.kind === "book" && target === scope.bookId && state?.spoilerFence && !state.spoilerGranted
            ? await isCurrentReaderSelection(deps, target, range)
            : false;
        signal?.throwIfAborted();
        await deps.bookText.readRange(
          {
            range,
            limit: 2,
            contextChars: 0,
            ...(scope.kind === "book" &&
            target === scope.bookId &&
            state?.spoilerFence &&
            !state.spoilerGranted &&
            !activeSelection
              ? { throughChapterIndex: state.spoilerFence.throughChapterIndex }
              : {}),
          },
          signal,
        );
      }
      signal?.throwIfAborted();
      if (kind === "note") {
        if (!body?.trim()) throw new Error("kind=note requires a non-empty body");
        return textResult(
          await deps.annotations.createNote(
            {
              bookId: target,
              body: body.trim(),
              quotedText: range ? quotedText : quotedText?.trim() || undefined,
              range,
              anchor,
              chapter: chapterHref,
            },
            signal,
          ),
        );
      }
      if (!text?.trim()) throw new Error("kind=highlight requires non-empty text");
      return textResult(
        await deps.annotations.createHighlight(
          {
            bookId: target,
            text: range ? text : text.trim(),
            range,
            anchor,
            chapter: chapterHref,
            color,
            style,
          },
          signal,
        ),
      );
    },
  };

  const deleteAnnotation: AgentTool = {
    name: "delete_annotation",
    label: "Delete annotation",
    description:
      "Permanently delete a note, highlight, or recorded question. The host ALWAYS asks the user for permission before deletion.",
    parameters: obj({ annotationId: str() }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { annotationId } = params as { annotationId: string };
      const snapshot = await deps.annotations.inspectAnnotation(annotationId as Id);
      if (!snapshot) throw new AppError("annotations/not-found", `annotation not found: ${annotationId}`);
      const annotation = snapshot.annotation;
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
      await deps.annotations.applyChanges(
        [{ op: "remove", annotationId, kind: annotation.kind, expectedRevision: snapshot.revision }],
        signal,
      );
      return {
        ...textResult({ deleted: true, annotationId, annotationKind: annotation.kind }),
        details,
      };
    },
  };

  return [createAnnotation, deleteAnnotation, buildAnnotationBatchTool(scope, deps)];
}
