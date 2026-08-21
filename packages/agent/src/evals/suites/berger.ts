/**
 * 真书套件：如何用提问解决问题（中文全本，10 章 / 15 万字，expository）。
 * 工具书（how-to/自助类）独有的角度：读者带着自己的现实处境来问——
 * 好答案不是复述章节，而是把书里的方法落到读者的情境上给出可执行步骤；
 * 以及"后面讲不讲 X"的前向窥视对工具书理应零仪式。
 * 断言关键词从 fixture 文本实证派生。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { EvalSuite } from "../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  noFenceAssessment,
} from "./real-book-helpers";

const berger = realBook("berger");

/** 读者位置：第二章 我们为什么要创造（index 5，~50%）——决策章（4）已读完。 */
const READER_CHAPTER = 5;
/** 前向目标：为什么要做提问型领导者（index 7，读者位置之后）。 */
const LEADER_CHAPTER = 7;

function readerCursor() {
  const epub = berger.epub();
  const charsBefore = epub.chapters
    .slice(0, READER_CHAPTER)
    .reduce((sum, chapter) => sum + chapter.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  return {
    chapterIndex: READER_CHAPTER,
    chapterTitle: epub.chapters[READER_CHAPTER]!.title,
    bookProgress: charsBefore / totalChars,
    chapterProgress: 0.2,
    visibleText: berger.chapterViewport(READER_CHAPTER),
  };
}

export const bergerEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "berger",
  description:
    "Real-book how-to scenarios on the full Chinese Berger (applying the book's methods to the reader's situation).",
  scenarios: [
    defineAgentEvalScenario({
      id: "apply-method-to-situation",
      description:
        "The reader brings a real decision; the answer applies the finished decision chapter's questioning methods to it, actionably.",
      tags: ["berger", "real-book", "how-to", "application", "book"],
      scope: { kind: "book", bookId: berger.bookId },
      seed: {
        ...berger.seed(50),
        chapterDigests: berger.digestsSeed(READER_CHAPTER),
      },
      seedSummary: berger.seedSummary(50),
      turns: [
        {
          text: "我下周要在两个工作 offer 之间做选择，压力很大。书里讲决策的那部分有什么提问方法是我现在就能拿来用的？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        sourceChapter: "index 4 (做决策时，我为什么应该问问题) — already finished by the reader",
        vocabulary: "开放式 / 如果 / 假设 —— verified present in that chapter's text",
      },
      rubric: [
        "Turns the book's decision-chapter methods into concrete questions the reader can ask about the two offers, instead of summarizing the chapter",
        "Reads as a companion helping with THIS decision — engages the reader's stakes, not a book report",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            interactions: { forbiddenKinds: ["permission"] },
          }),
          coverageAssessment(observation, "answer.method-vocabulary", ["开放式", "如果", "假设", "选项"], 2),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "forward-peek-for-new-manager",
      description:
        "A how-to book's later chapter is fair game: a new manager asks whether the book covers leading with questions.",
      tags: ["berger", "real-book", "how-to", "forward", "book"],
      scope: { kind: "book", bookId: berger.bookId },
      seed: {
        ...berger.seed(50),
        chapterDigests: berger.digestsSeed(READER_CHAPTER),
      },
      seedSummary: berger.seedSummary(50),
      turns: [
        {
          text: "我刚升做经理。这本书后面有没有讲怎么用提问来带团队？值得跳过去先看吗？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["领导"] },
        tools: {
          requiredAny: ["search_book_text", "read_chapter", "get_toc"],
          noErrors: true,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        target: `chapter index ${LEADER_CHAPTER} (为什么要做提问型领导者), beyond the cursor at ${READER_CHAPTER}`,
      },
      rubric: [
        "Confirms the leadership chapter exists (by its own title), previews what it argues from its actual content, and gives a direct read/skip recommendation",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["领导"] },
            tools: {
              requiredAny: ["search_book_text", "read_chapter", "get_toc"],
              noErrors: true,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
