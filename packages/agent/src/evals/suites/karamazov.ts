/**
 * 真书套件：卡拉马佐夫兄弟（中文全本，102 章 / 69 万字）。
 * 与合成小书的区别在于三件合成书测不到的事：真实规模下的检索与定位、
 * 中文语料的语言一致性，以及模型的预训练知识 vs 读者位置的剧透张力
 * （模型"知道"弑父案，但读者还在第 12 章）。
 * 断言关键词全部从 fixture 文本派生 —— 不依赖任何外部书目知识。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import {
  KARAMAZOV_BOOK_ID,
  chapterTitleKey,
  chapterViewport,
  karamazovSeed,
  karamazovSeedSummary,
  pickSentence,
} from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const QUOTE_CHAPTER = 8; // "四 老三阿辽沙" —— 读者位置(35%)之前，无剧透张力
const EARLY_CHAPTER = 12; // "三 信女" —— 早期游标场景的边界
const MID_PROGRESS = 35;

const midCursor = () => ({
  chapterTitle: karamazovSeed(MID_PROGRESS).chapters![KARAMAZOV_BOOK_ID]![35]!.title,
  bookProgress: MID_PROGRESS / 100,
  chapterProgress: 0.4,
  visibleText: chapterViewport(35),
});

function cjkAnswerAssessment(observation: AgentEvalObservation): EvalAssessment {
  const cjk = /[一-鿿]/.test(observation.answer);
  return assessmentFromChecks([
    {
      id: "answer.language-chinese",
      category: "quality",
      passed: cjk,
      message: cjk
        ? "answer is in Chinese for a Chinese reader"
        : "answer to a Chinese question contains no Chinese",
    },
  ]);
}

/** 早期游标下，所有正文工具调用必须停在边界章之内。 */
function boundedRetrievalAssessment(
  observation: AgentEvalObservation,
  ceiling: number,
): EvalAssessment {
  const violations: string[] = [];
  for (const call of observation.tools) {
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    if (call.name === "read_chapter") {
      const index = args.chapterIndex;
      if (typeof index !== "number" || index > ceiling) {
        violations.push(`read_chapter(${String(index)})`);
      }
    }
    if (call.name === "search_book_text") {
      const through = args.throughChapterIndex;
      if (typeof through !== "number" || through > ceiling) {
        violations.push(`search_book_text(through=${String(through)})`);
      }
    }
  }
  return assessmentFromChecks([
    {
      id: "tools.retrieval-within-boundary",
      category: "policy",
      passed: violations.length === 0,
      message:
        violations.length === 0
          ? `all book-text retrieval stayed at or before chapter index ${ceiling}`
          : `retrieval crossed the reader's position: ${violations.join(", ")}`,
      actual: violations,
    },
  ]);
}

export const karamazovEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "karamazov",
  description: "Real-book scenarios on the full Chinese Brothers Karamazov EPUB.",
  scenarios: [
    defineAgentEvalScenario({
      id: "quote-locates-chapter",
      description: "Locates a verbatim quote in the 102-chapter book and explains it in context.",
      tags: ["karamazov", "real-book", "retrieval", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(MID_PROGRESS),
      seedSummary: karamazovSeedSummary(MID_PROGRESS),
      turns: [
        {
          text: `书里有这么一句："${pickSentence(QUOTE_CHAPTER)}" 这出自哪一章？结合上下文帮我理解一下。`,
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: [chapterTitleKey(QUOTE_CHAPTER)] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      rubric: [
        "Names the correct chapter and explains the quote using its actual surrounding context, not generic commentary about the novel",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: [chapterTitleKey(QUOTE_CHAPTER)] },
            tools: { required: ["search_book_text"], noErrors: true },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "remember-reading-goal",
      description: "Saves the reader's stated research goal as a durable user memory, in Chinese.",
      tags: ["karamazov", "real-book", "memory", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(MID_PROGRESS),
      seedSummary: karamazovSeedSummary(MID_PROGRESS),
      turns: [
        {
          text: "记住：我读这本书是想研究陀思妥耶夫斯基如何书写信仰与怀疑。",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        tools: { required: ["remember"], noErrors: true, maxCalls: 2 },
      },
      criteria: { savedScope: "user", contentContains: "信仰" },
      observeState: ({ stores }) => ({ saved: stores.savedMemoryInputs }),
      evaluate: (observation) => {
        const state =
          observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
            ? (observation.state as { saved?: Array<{ scope?: string; content?: string }> })
            : {};
        const saved = state.saved ?? [];
        const match = saved.some(
          (entry) => entry.scope === "user" && (entry.content ?? "").includes("信仰"),
        );
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["remember"], noErrors: true, maxCalls: 2 },
          }),
          assessmentFromChecks([
            {
              id: "state.goal-memorized-in-chinese",
              category: "state",
              passed: match,
              message: match
                ? "the research goal landed in user memory, in the reader's language"
                : "no user-scope memory captured the stated goal",
              actual: saved.map((entry) => `${entry.scope}: ${entry.content}`),
            },
          ]),
          cjkAnswerAssessment(observation),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "highlights-recited",
      description: "Recites the reader's real-text highlights verbatim with a comment each.",
      tags: ["karamazov", "real-book", "annotations", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: {
        ...karamazovSeed(MID_PROGRESS),
        annotations: [
          {
            kind: "highlight",
            id: "kz-hl-1",
            bookId: KARAMAZOV_BOOK_ID,
            text: pickSentence(10),
            color: "yellow",
            style: "highlight",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
          {
            kind: "highlight",
            id: "kz-hl-2",
            bookId: KARAMAZOV_BOOK_ID,
            text: pickSentence(30),
            color: "blue",
            style: "highlight",
            createdAt: "2026-08-02T00:00:00Z",
            updatedAt: "2026-08-02T00:00:00Z",
          },
        ],
      },
      seedSummary: karamazovSeedSummary(MID_PROGRESS),
      turns: [
        {
          text: "逐条复述我在这本书里的高亮原文，并各用一句话点评。",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: {
          mustContain: [pickSentence(10).slice(0, 12), pickSentence(30).slice(0, 12)],
        },
        tools: { required: ["get_annotations"], noErrors: true },
      },
      rubric: [
        "Quotes both highlights faithfully and comments on each in a way grounded in this book, without inventing extra highlights",
      ],
    }),
    defineAgentEvalScenario({
      id: "early-cursor-no-spoiler",
      description:
        "With the reader at chapter 12 of a novel the model knows from pretraining, stays behind the cursor.",
      tags: ["karamazov", "real-book", "spoiler", "cursor", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(12),
      seedSummary: karamazovSeedSummary(12),
      turns: [
        {
          text: "根据我目前读到的地方，帮我梳理一下已经出场的主要人物和他们之间的关系。",
          readingCursor: {
            chapterTitle: chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      // 模型预训练里"知道"弑父案与审判；读者在第 12 章。deterministic 禁词
      // + 轨迹边界 + rubric 三层围堵。
      expectation: {
        answer: { mustNotContain: ["凶手", "审判", "开庭", "弑父"] },
      },
      rubric: [
        "Maps only characters and relationships introduced up to the reader's position, drawing nothing (not even hints) from later events the model knows from pretraining",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustNotContain: ["凶手", "审判", "开庭", "弑父"] },
          }),
          boundedRetrievalAssessment(observation, EARLY_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
