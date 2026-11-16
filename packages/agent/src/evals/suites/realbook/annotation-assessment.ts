import type { Id } from "@read-aware/core";
import type { AnnotationItem, RuntimeDeps } from "../../../ports";
import { assessmentFromChecks } from "../../assertions";
import type { EvalEnvironment } from "../../host";
import type { EvalAssessment } from "../../types";

/** Source text and extracted text differ in whitespace, never in what they say. */
const compact = (text: string) => text.replace(/\s+/g, "");

/**
 * Seed an active selection through the same versioned range path the reader
 * exposes to the Agent. Real-book scenarios must not describe a selection only
 * as an attachment while leaving reader.getSession().selection null. The
 * location comes from the environment: what its reader would issue for the passage.
 */
export async function selectEvalRange(input: {
  context: Pick<EvalEnvironment, "deps" | "rangeOf">;
  bookId: Id;
  chapterIndex: number;
  text: string;
}) {
  const range = await input.context.rangeOf(input.bookId, input.chapterIndex, input.text);
  const page = await input.context.deps.bookText.readRange({ range, limit: 12000, contextChars: 0 });
  // A reader's range carries the source's own whitespace; the passage is the same text.
  if (compact(page.text) !== compact(input.text) || page.nextOffset !== null) {
    throw new Error("selection source mismatch");
  }
  await input.context.deps.reader.selectRange(page.range);
  return page.range;
}

export async function observeSelectionAnnotations(stores: { annotations: AnnotationItem[] }, deps: RuntimeDeps) {
  return Promise.all(
    stores.annotations.map(async (annotation) => {
      const range = "range" in annotation ? annotation.range : undefined;
      let sourceText: string | undefined, sourceChapterIndex: number | undefined;
      if (range) {
        try {
          let offset = 0;
          sourceText = "";
          do {
            const page = await deps.bookText.readRange({ range, offset, limit: 12000, contextChars: 0 });
            sourceText += page.text;
            if (page.nextOffset === null) break;
            offset = page.nextOffset;
          } while (true);
          // Which chapter the range lies in, as the book's own text locates it.
          sourceChapterIndex = (await deps.bookText.locate?.(range.bookId as Id, range))?.start.chapterIndex;
        } catch {
          sourceText = undefined;
          sourceChapterIndex = undefined;
        }
      }
      return {
        kind: annotation.kind,
        bookId: annotation.bookId,
        anchor: annotation.anchor,
        range,
        text: annotation.kind === "highlight" ? annotation.text : annotation.kind === "note" ? annotation.body : "",
        quotedText: annotation.kind === "note" ? annotation.quotedText : undefined,
        sourceText,
        sourceChapterIndex,
      };
    }),
  );
}

export function highlightVerbatimAssessment(
  observation: { state?: unknown },
  chapterText: string,
  selectedText: string,
  bookId: string,
  chapterIndex: number,
  expectedNoteBody = "这里值得回头再读。",
): EvalAssessment {
  const state = Array.isArray(observation.state)
    ? (observation.state as Awaited<ReturnType<typeof observeSelectionAnnotations>>)
    : [];
  const highlights = state.filter((entry) => entry.kind === "highlight");
  const notes = state.filter((entry) => entry.kind === "note");
  const attached = (entry: (typeof state)[number]) =>
    !!entry.range &&
    entry.bookId === bookId &&
    entry.range.bookId === bookId &&
    entry.anchor === entry.range.cfi &&
    entry.sourceText !== undefined &&
    compact(entry.sourceText) === compact(selectedText) &&
    entry.sourceChapterIndex === chapterIndex;
  return assessmentFromChecks([
    {
      id: "state.highlight-selection-boundary",
      category: "state",
      passed: highlights.length === 1 && highlights[0]!.text === selectedText,
      message: "highlight must match exactly the attached selection, without adjacent text",
      expected: selectedText,
      actual: highlights.map((entry) => entry.text),
    },
    {
      id: "state.highlight-verbatim",
      category: "state",
      passed:
        highlights.length > 0 && highlights.every((entry) => entry.text.length > 0 && chapterText.includes(entry.text)),
      message: "highlight must preserve source text",
      actual: highlights.map((entry) => entry.text),
    },
    {
      id: "state.note-recorded",
      category: "state",
      passed: notes.length === 1 && notes[0]!.text === expectedNoteBody,
      message: "exactly one note must preserve the requested body",
      expected: expectedNoteBody,
      actual: notes.map((entry) => entry.text),
    },
    {
      id: "state.selection-source-attached",
      category: "state",
      passed:
        highlights.length === 1 &&
        notes.length === 1 &&
        [...highlights, ...notes].every(attached) &&
        notes[0]!.quotedText === selectedText &&
        highlights[0]!.range?.cfi === notes[0]!.range?.cfi,
      message:
        "highlight and note must persist the same verified selected source range in the requested book and chapter",
    },
  ]);
}
