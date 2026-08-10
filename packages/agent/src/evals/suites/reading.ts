import type { Id } from "@read-aware/core";
import type { BookOverview } from "../../ports";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const NARRATIVE_BOOK_ID = "eval-locked-room" as Id;
const narrativeBook: BookOverview = {
  id: NARRATIVE_BOOK_ID,
  title: "The Locked Room: A Novel",
  author: "Mira Vale",
  progressPercent: 18,
  status: "reading",
};
const narrativeChapters = [
  {
    title: "Wet Footprints",
    hrefs: ["chapter-1.xhtml"],
    text: "Victor is found dead in a locked study. Mara notices wet footprints, a stopped brass clock, and an unopened letter. Nobody has yet been accused. Later that night, beyond the reader's current position, Mara secretly finds Rowan's silver key beneath the study window.",
  },
  {
    title: "The Confession",
    hrefs: ["chapter-2.xhtml"],
    text: "In the final confession, the detective proves that Rowan killed Victor and staged the locked room with a hidden wire.",
  },
];

function stableCursorContextAssessment(observation: AgentEvalObservation): EvalAssessment {
  const first = observation.modelRequests[0];
  const second = observation.modelRequests[1];
  const stable =
    typeof first?.context.systemPrompt === "string" &&
    first.context.systemPrompt === second?.context.systemPrompt;
  const newestContext = JSON.stringify(second?.context.messages ?? []);
  return assessmentFromChecks([
    {
      id: "context.stable-system-prefix",
      category: "state",
      passed: stable,
      message: stable
        ? "same-chapter system prompt remained byte-stable"
        : "same-chapter system prompt changed between turns",
    },
    {
      id: "context.latest-cursor",
      category: "state",
      passed: newestContext.includes("SECOND-MARKER"),
      message: newestContext.includes("SECOND-MARKER")
        ? "latest cursor reached the second model request"
        : "latest cursor was missing from the second model request",
      expected: "SECOND-MARKER",
    },
  ]);
}

export const readingEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "reading",
  description: "Reading-cursor grounding, narrative spoiler policy, and expository retrieval.",
  scenarios: [
    defineAgentEvalScenario({
      id: "narrative-no-spoiler",
      description: "Respects the current cursor and avoids retrieving later narrative reveals.",
      tags: ["reading", "cursor", "spoiler", "narrative"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Based only on what I have read so far, help me reason about the clues without spoiling who killed Victor.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            bookProgress: 0.18,
            chapterProgress: 0.55,
            visibleText:
              "Victor is found dead in a locked study. Mara notices wet footprints and a stopped brass clock. Nobody has yet been accused.",
          },
        },
      ],
      expectation: {
        answer: { mustNotContain: ["Rowan", "silver key", "hidden wire", "final confession"] },
        tools: { forbidden: ["read_chapter", "search_book_text"] },
      },
      rubric: [
        "Actively helps the reader reason about the visible clues (footprints, stopped clock, unopened letter) instead of deflecting or refusing",
        "Gives no hint about the culprit or evidence beyond the reader's position, not even indirectly",
        "Reads like a thoughtful reading companion: concrete, engaged with this book, no filler",
      ],
    }),
    defineAgentEvalScenario({
      id: "explicit-spoiler",
      description: "Allows a requested spoiler but grounds it in the actual book text.",
      tags: ["reading", "spoiler", "retrieval", "narrative"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Spoil the novel for me: who killed Victor, and how was the locked room staged?",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            bookProgress: 0.18,
            chapterProgress: 0.55,
            visibleText: "Victor is found dead in a locked study.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["Rowan", "wire"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "cursor-grounding",
      description: "Answers a page-specific question from visible reader text.",
      tags: ["reading", "cursor", "grounding"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "What precise clock detail is on the page I am looking at?",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.55,
            visibleText: "The brass clock stopped at seventeen minutes past nine.",
          },
        },
      ],
      expectation: { answer: { mustContain: ["seventeen", "nine"] } },
    }),
    defineAgentEvalScenario({
      id: "expository-can-look-ahead",
      description: "Retrieves later material when forward lookup is useful and non-spoilery.",
      tags: ["reading", "retrieval", "expository"],
      scope: { kind: "book", bookId: "eval-data-structures" as Id },
      seed: {
        books: [
          {
            id: "eval-data-structures" as Id,
            title: "Practical Data Structures",
            author: "A. N. Author",
            progressPercent: 20,
            status: "reading",
          },
        ],
        chapters: {
          "eval-data-structures": [
            {
              title: "Arrays",
              hrefs: ["arrays.xhtml"],
              text: "Arrays store elements in contiguous memory and offer constant-time indexed access.",
            },
            {
              title: "Balanced Trees",
              hrefs: ["trees.xhtml"],
              text: "This chapter implements red-black trees and explains rotations, recoloring, and logarithmic lookup.",
            },
          ],
        },
      },
      turns: [
        {
          text: "Does this book later cover red-black trees? Check the actual book before answering.",
          readingCursor: {
            chapter: "arrays.xhtml",
            chapterTitle: "Arrays",
            bookProgress: 0.2,
            chapterProgress: 0.7,
            visibleText: "Arrays store elements in contiguous memory.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["red-black"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "same-chapter-cursor-refresh",
      description: "Refreshes the live cursor each turn without invalidating the stable prompt prefix.",
      tags: ["reading", "cursor", "multi-turn", "cache"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Reply with only the marker visible on this page.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.2,
            visibleText: "The page marker is FIRST-MARKER.",
          },
        },
        {
          text: "I turned the page. Reply with only the marker visible now.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.3,
            visibleText: "The page marker is SECOND-MARKER.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["SECOND-MARKER"], mustNotContain: ["FIRST-MARKER"] },
        tools: { forbidden: ["read_chapter", "search_book_text"] },
      },
      criteria: {
        stableSystemPromptWithinChapter: true,
        secondRequestContainsLatestCursor: true,
      },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: {
              mustContain: ["SECOND-MARKER"],
              mustNotContain: ["FIRST-MARKER"],
            },
            tools: { forbidden: ["read_chapter", "search_book_text"] },
          }),
          stableCursorContextAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "cross-book-search",
      description: "Answers a which-of-my-books question by searching prose across the shelf.",
      tags: ["reading", "retrieval", "cross-book", "global"],
      scope: { kind: "global", threadId: "reading-cross-book" },
      seed: {
        books: [
          {
            id: "cross-harbor" as Id,
            title: "The Quiet Harbor",
            author: "L. Shore",
            status: "reading",
          },
          {
            id: "cross-mountain" as Id,
            title: "Mountain Paths",
            author: "R. Hale",
            status: "finished",
          },
        ],
        chapters: {
          "cross-harbor": [
            {
              title: "The Keeper",
              text: "Every evening the old lighthouse keeper climbed the spiral stairs to trim the lamp before the fog rolled in.",
            },
          ],
          "cross-mountain": [
            {
              title: "Ridge Line",
              text: "The climbers roped together before crossing the glacier under a cloudless sky.",
            },
          ],
        },
      },
      turns: [{ text: "Which of my books mentions a lighthouse? Quote the spot." }],
      expectation: {
        answer: { mustContain: ["Quiet Harbor"] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      rubric: [
        "Names The Quiet Harbor as the match and quotes or paraphrases the actual lighthouse passage, without attributing it to the other book",
      ],
    }),
  ],
};
