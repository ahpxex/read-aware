/**
 * 真书套件：乌合之众（中文全本，18 章 / 约 10 万字，expository）。
 * 与 karamazov 套件互为对照面——说明文类的三件事：概念图（而非人物图）
 * 的注入与引用、无剧透围栏的自由前向检索（后文只是更多内容，不是剧透），
 * 以及本版本术语的拼写保真（译名、分类名按本书用词）。
 * 断言关键词全部从 fixture 文本与纪要派生。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { EvalSuite } from "../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  forwardRetrievalAssessment as forwardBeyond,
  noFenceAssessment,
} from "./real-book-helpers";

const lebon = realBook("lebon");

/** 读者位置：第三卷之前——已读完领袖/说服手段章（11），概念图已成形。 */
const READER_CHAPTER = 12;
const READER_PROGRESS = 68;
/** 前向检索的目标章：议会（全书最后一章，远在读者位置之后）。 */
const PARLIAMENT_CHAPTER = 17;

function readerCursor() {
  const epub = lebon.epub();
  const charsBefore = epub.chapters
    .slice(0, READER_CHAPTER)
    .reduce((sum, chapter) => sum + chapter.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  return {
    chapterIndex: READER_CHAPTER,
    chapterTitle: epub.chapters[READER_CHAPTER]!.title,
    bookProgress: charsBefore / totalChars,
    chapterProgress: 0.2,
    visibleText: lebon.chapterViewport(READER_CHAPTER),
  };
}

export const lebonEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "lebon",
  code: "S08",
  description:
    "基于完整中文勒庞图书的真实场景（概念图，无剧透栅栏）。",
  scenarios: [
    defineAgentEvalScenario({
      id: "concept-graph-answers",
      description:
        "注入概念图后，机制问题从摘要关系回答——少量工具调用，本版术语。",
      tags: ["lebon", "real-book", "graph", "digest", "expository", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(READER_PROGRESS),
        chapterDigests: lebon.digestsSeed(READER_CHAPTER),
      },
      seedSummary: lebon.seedSummary(READER_PROGRESS),
      turns: [
        {
          text: "读到现在，勒庞讲的“断言”“重复”“传染”这几个手段之间是什么关系？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["断言", "重复", "传染"] },
        tools: { maxCalls: 3 },
        maxRounds: 4,
      },
      criteria: {
        source: "digest concept graph (断言 → 重复 → 传染 → 舆论 chain from chapter 11)",
      },
      rubric: [
        "Explains the chain as the book states it (assertion needs repetition, repetition breeds contagion, contagion produces opinion) rather than generic persuasion theory",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["断言", "重复", "传染"] },
            tools: { maxCalls: 3 },
            maxRounds: 4,
          }),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "forward-retrieval-unfenced",
      description:
        "关于说明性图书后续章节的问题自由向前检索——无需权限，无剧透仪式。",
      tags: ["lebon", "real-book", "expository", "forward", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(READER_PROGRESS),
        chapterDigests: lebon.digestsSeed(READER_CHAPTER),
      },
      seedSummary: lebon.seedSummary(READER_PROGRESS),
      turns: [
        {
          text: "这本书后面是不是讲到了议会？勒庞怎么看议会制度？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["议会"] },
        tools: {
          requiredAny: ["search_book_text", "read_chapter", "get_toc"],
          noErrors: true,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        target: `chapter ${PARLIAMENT_CHAPTER} (议会), far beyond the reading cursor at ${READER_CHAPTER}`,
      },
      rubric: [
        "Answers from the parliament chapter's actual content (crowd traits of assemblies, leaders' prestige), not from general knowledge about Le Bon",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["议会"] },
            tools: {
              requiredAny: ["search_book_text", "read_chapter", "get_toc"],
              noErrors: true,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          noFenceAssessment(observation),
          forwardBeyond(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "term-taxonomy-fidelity",
      description:
        "Recites a term's in-book taxonomy using this edition's own category names (威望 → 被赋予的/个人的).",
      tags: ["lebon", "real-book", "expository", "fidelity", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(READER_PROGRESS),
        chapterDigests: lebon.digestsSeed(READER_CHAPTER),
      },
      seedSummary: lebon.seedSummary(READER_PROGRESS),
      turns: [
        {
          text: "勒庞说的“威望”具体指什么？他把威望分成了哪几类？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["威望"] },
      },
      criteria: {
        taxonomy: "被赋予的威望（人为的威望）/ 个人的威望 — as spelled in chapter 11",
      },
      rubric: [
        "States the two categories with this edition's own names and grounds the definition in the book's wording, not a dictionary gloss",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { answer: { mustContain: ["威望"] } }),
          coverageAssessment(observation, "answer.taxonomy-edition-terms", [
            "被赋予的威望",
            "人为的威望",
            "个人的威望",
          ], 1),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
