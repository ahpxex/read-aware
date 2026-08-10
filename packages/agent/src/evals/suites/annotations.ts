/**
 * 标注套件：create_annotation / edit_annotation 的产品行为。
 * 重点盯两类失败：高亮没有用原文精确文本（改写/意译），
 * 以及编辑前没有先检索定位到正确的标注。
 */
import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const BOOK_ID = "eval-annotation-book" as Id;
const CHAPTER_TEXT =
  "Victor is found dead in a locked study. Mara notices the brass clock stopped at nine minutes past two, wet footprints leading nowhere, and an unopened letter on the desk. The housekeeper insists every door was bolted from inside.";

const seed = () => ({
  books: [
    {
      id: BOOK_ID,
      title: "The Locked Room",
      author: "Mira Vale",
      progressPercent: 22,
      status: "reading" as const,
    },
  ],
  chapters: {
    [BOOK_ID]: [{ title: "Wet Footprints", text: CHAPTER_TEXT, hrefs: ["chapter-1.xhtml"] }],
  },
});

const cursor = {
  chapter: "chapter-1.xhtml",
  chapterTitle: "Wet Footprints",
  bookProgress: 0.22,
  chapterProgress: 0.6,
  visibleText: CHAPTER_TEXT,
};

type SetupContext = Parameters<NonNullable<AgentEvalScenario["setup"]>>[0];

function observeAnnotations({ stores }: SetupContext) {
  return stores.annotations.map((annotation) =>
    annotation.kind === "note"
      ? { kind: annotation.kind, id: annotation.id, body: annotation.body }
      : { kind: annotation.kind, id: annotation.id, text: annotation.kind === "highlight" ? annotation.text : "" },
  );
}

function stateAnnotations(observation: AgentEvalObservation): Array<Record<string, string>> {
  return Array.isArray(observation.state)
    ? (observation.state as Array<Record<string, string>>)
    : [];
}

function highlightVerbatimAssessment(observation: AgentEvalObservation): EvalAssessment {
  const highlights = stateAnnotations(observation).filter((entry) => entry.kind === "highlight");
  const verbatim =
    highlights.length > 0 &&
    highlights.every((entry) => typeof entry.text === "string" && CHAPTER_TEXT.includes(entry.text));
  return assessmentFromChecks([
    {
      id: "state.highlight-verbatim",
      category: "state",
      passed: verbatim,
      message: verbatim
        ? "highlight text is a verbatim span of the chapter"
        : "highlight is missing or paraphrases the book text",
      actual: highlights.map((entry) => entry.text ?? "") as string[],
    },
  ]);
}

export const annotationsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "annotations",
  description: "Creating, editing, and grounding on the user's notes and highlights.",
  scenarios: [
    defineAgentEvalScenario({
      id: "highlight-verbatim-text",
      description: "Highlights the requested passage using the book's exact words.",
      tags: ["annotations", "highlight", "state"],
      scope: { kind: "book", bookId: BOOK_ID },
      seed: seed(),
      turns: [
        {
          text: "Please highlight the sentence about the stopped clock for me.",
          readingCursor: cursor,
        },
      ],
      expectation: {
        tools: { required: ["create_annotation"], noErrors: true },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
      criteria: { highlightMustBeVerbatimSpanOf: "chapter text" },
      observeState: observeAnnotations,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["create_annotation"], noErrors: true },
            interactions: { forbiddenKinds: ["question", "permission"] },
          }),
          highlightVerbatimAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "note-on-request",
      description: "Saves the user's thought as a note without inventing content.",
      tags: ["annotations", "note", "state"],
      scope: { kind: "book", bookId: BOOK_ID },
      seed: seed(),
      turns: [
        {
          text: "Save a note for me: the bolted doors make the housekeeper the only person who could stage this.",
          readingCursor: cursor,
        },
      ],
      expectation: {
        tools: { required: ["create_annotation"], noErrors: true },
      },
      criteria: { noteMustMention: "housekeeper" },
      observeState: observeAnnotations,
      evaluate: (observation) => {
        const notes = stateAnnotations(observation).filter((entry) => entry.kind === "note");
        const captured = notes.some((entry) => (entry.body ?? "").toLowerCase().includes("housekeeper"));
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["create_annotation"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "state.note-captures-thought",
              category: "state",
              passed: captured,
              message: captured
                ? "the saved note captures the user's thought"
                : "no note captured the user's stated thought",
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "edit-note-after-lookup",
      description: "Finds the existing note first, then extends it in place.",
      tags: ["annotations", "edit", "trajectory"],
      scope: { kind: "book", bookId: BOOK_ID },
      seed: {
        ...seed(),
        annotations: [
          {
            kind: "note",
            id: "note-clock" as Id,
            bookId: BOOK_ID,
            body: "The clock stopped at 2:09.",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
        ],
      },
      turns: [
        {
          text: "Update my note about the clock: add that the time matches the housekeeper's alibi window.",
          readingCursor: cursor,
        },
      ],
      expectation: {
        tools: { required: ["get_annotations", "edit_annotation"], noErrors: true },
      },
      criteria: { noteMustGain: "alibi" },
      observeState: observeAnnotations,
      evaluate: (observation) => {
        const note = stateAnnotations(observation).find((entry) => entry.id === "note-clock");
        const extended = Boolean(note?.body && note.body.toLowerCase().includes("alibi"));
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["get_annotations", "edit_annotation"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "state.note-extended",
              category: "state",
              passed: extended,
              message: extended
                ? "the clock note now mentions the alibi window"
                : "the clock note was not extended with the requested detail",
              actual: note?.body ?? null,
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "summarize-highlights-grounded",
      description: "Summarizes the reader's highlights from the record, not from imagination.",
      tags: ["annotations", "grounding", "quality"],
      scope: { kind: "book", bookId: BOOK_ID },
      seed: {
        ...seed(),
        annotations: [
          {
            kind: "highlight",
            id: "hl-clock" as Id,
            bookId: BOOK_ID,
            text: "the brass clock stopped at nine minutes past two",
            color: "yellow",
            style: "highlight",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
          {
            kind: "highlight",
            id: "hl-doors" as Id,
            bookId: BOOK_ID,
            text: "every door was bolted from inside",
            color: "blue",
            style: "highlight",
            createdAt: "2026-08-02T00:00:00Z",
            updatedAt: "2026-08-02T00:00:00Z",
          },
        ],
      },
      turns: [{ text: "Summarize what I've highlighted in this book so far.", readingCursor: cursor }],
      expectation: {
        answer: { mustContain: ["clock", "bolted"] },
        tools: { required: ["get_annotations"], noErrors: true },
      },
      rubric: [
        "Summarizes only what the recorded highlights actually say, adding no invented highlights or themes",
        "Connects the highlights into a readable summary rather than dumping them as a raw list",
      ],
    }),
  ],
};
