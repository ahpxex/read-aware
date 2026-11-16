/**
 * 标注套件：create_annotation / edit_annotation 的产品行为。
 * 重点盯两类失败：高亮没有用原文精确文本（改写/意译），
 * 以及编辑前没有先检索定位到正确的标注。
 */
import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../../types";

const BOOK_ID = "eval-annotation-book" as Id;
const CHAPTER_TEXT =
  "Victor is found dead in a locked study. Mara notices the brass clock stopped at nine minutes past two, wet footprints leading nowhere, and an unopened letter on the desk. The housekeeper insists every door was bolted from inside.";
const STOPPED_CLOCK_SENTENCE =
  "Mara notices the brass clock stopped at nine minutes past two, wet footprints leading nowhere, and an unopened letter on the desk.";
const HOUSEKEEPER_NOTE = "the bolted doors make the housekeeper the only person who could stage this.";

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
      : {
          kind: annotation.kind,
          id: annotation.id,
          text: annotation.kind === "highlight" ? annotation.text : "",
        },
  );
}

function stateAnnotations(observation: AgentEvalObservation): Array<Record<string, unknown>> {
  return Array.isArray(observation.state) ? (observation.state as Array<Record<string, unknown>>) : [];
}

function highlightVerbatimAssessment(observation: AgentEvalObservation): EvalAssessment {
  const highlights = stateAnnotations(observation).filter((entry) => entry.kind === "highlight");
  const verbatim =
    highlights.length === 1 &&
    highlights[0]?.text === STOPPED_CLOCK_SENTENCE &&
    CHAPTER_TEXT.includes(STOPPED_CLOCK_SENTENCE);
  return assessmentFromChecks([
    {
      id: "state.highlight-verbatim",
      category: "state",
      passed: verbatim,
      message: verbatim
        ? "the requested stopped-clock sentence was written verbatim"
        : "the requested stopped-clock sentence was not written exactly",
      expected: STOPPED_CLOCK_SENTENCE,
      actual: highlights.map((entry) => entry.text ?? null) as (string | null)[],
    },
  ]);
}

export const annotationsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "annotations",
  displayName: "标注与笔记",
  code: "S01",
  description: "创建、编辑用户笔记和高亮，并基于它们进行推理。",
  scenarios: [
    defineAgentEvalScenario({
      id: "highlight-verbatim-text",
      description: "用书籍的精确措辞高亮请求的段落。",
      tags: ["smoke", "state", "book"],
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
      criteria: { highlightMustEqual: STOPPED_CLOCK_SENTENCE },
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
      description: "保存用户的想法作为笔记，不编造内容。",
      tags: ["state", "book"],
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
      criteria: { noteMustEqual: HOUSEKEEPER_NOTE },
      observeState: observeAnnotations,
      evaluate: (observation) => {
        const notes = stateAnnotations(observation).filter((entry) => entry.kind === "note");
        const bodies = notes.map((entry) => (typeof entry.body === "string" ? entry.body : ""));
        const captured = bodies.some((body) => body.toLowerCase().includes("housekeeper"));
        const exact = notes.length === 1 && bodies[0] === HOUSEKEEPER_NOTE;
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
            {
              id: "state.note-body-preserved",
              category: "state",
              passed: exact,
              message: exact
                ? "the saved note preserves the user's complete dictated body"
                : "the saved note changed or dropped part of the user's dictated body",
              expected: HOUSEKEEPER_NOTE,
              actual: bodies,
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "edit-note-after-lookup",
      description: "先找到现有笔记，然后就地扩展。",
      tags: ["state", "economy", "book"],
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
        tools: { required: ["get_annotations", "apply_annotation_changes"], noErrors: true },
      },
      criteria: { noteMustGain: "alibi" },
      observeState: observeAnnotations,
      evaluate: (observation) => {
        const note = stateAnnotations(observation).find((entry) => entry.id === "note-clock");
        const noteBody = typeof note?.body === "string" ? note.body : "";
        const extended = noteBody.toLowerCase().includes("alibi");
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["get_annotations", "apply_annotation_changes"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "state.note-extended",
              category: "state",
              passed: extended,
              message: extended
                ? "the clock note now mentions the alibi window"
                : "the clock note was not extended with the requested detail",
              actual: noteBody,
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "summarize-highlights-grounded",
      description: "从记录中总结读者的高亮，而非凭想象。",
      tags: ["retrieval", "book"],
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
