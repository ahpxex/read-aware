/**
 * 真书套件：如何用提问解决问题（中文全本，10 章 / 15 万字，expository）。
 * 工具书（how-to/自助类）独有的角度：读者带着自己的现实处境来问——
 * 好答案不是复述章节，而是把书里的方法落到读者的情境上给出可执行步骤；
 * 以及"后面讲不讲 X"的前向窥视对工具书理应零仪式。
 * 断言关键词从 fixture 文本实证派生。
 */
import { combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import type { EvalSuite } from "../../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  noFenceAssessment,
} from "./real-book-helpers";
import { bergerQuestionScenarios } from "./berger-questions";

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
  code: "S02",
  description:
    "基于中文《贝格尔》全书的真实“怎么做”场景（将书的方法应用于读者情境）。",
  scenarios: [
    defineAgentEvalScenario({
      id: "apply-method-to-situation",
      description:
        "读者带来真实决策，回答应用已读决策章节的提问方法，提供可操作建议。",
      tags: ["retrieval", "digest", "berger", "book"],
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
        "指导类书籍的后续章节可自由访问：新任经理询问该书是否涵盖以提问领导。",
      tags: ["retrieval", "forward", "berger", "book"],
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
    defineAgentEvalScenario({
      id: "coach-questions-from-methods",
      description:
        "把已读决策章的提问方法变成读者当下处境的具体问题——教练式应用，而非章节复述。",
      tags: ["digest", "berger", "book"],
      scope: { kind: "book", bookId: berger.bookId },
      seed: {
        ...berger.seed(50),
        chapterDigests: berger.digestsSeed(READER_CHAPTER),
      },
      seedSummary: berger.seedSummary(50),
      turns: [
        {
          text: "我下周要和老板谈升职，心里挺没底的。用书里讲过的提问方法，帮我准备三个我现在就该问自己的问题。",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        sourceChapter: "index 4 (做决策时，我为什么应该问问题) — vocabulary 开放式/如果/假设/选项 verified in that chapter's text",
      },
      rubric: [
        "Each question is actually usable before the talk (about THIS reader's stakes and options), visibly built on the book's question methods — not three generic self-help prompts",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            interactions: { forbiddenKinds: ["permission"] },
          }),
          coverageAssessment(
            observation,
            "answer.question-method-vocabulary",
            // 方法骨架词（审查理由/对立面/恐惧均为书内方法概念），不钉措辞
            ["为什么", "理由", "假设", "对立", "反面", "恐惧", "如果", "选项"],
            2,
          ),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "finish-recommendation-honest",
      description:
        "读者自陈背景并要求明确判断：基于已读部分给出值不值得读完的诚实推荐，不客套。",
      tags: ["digest", "berger", "book"],
      scope: { kind: "book", bookId: berger.bookId },
      seed: {
        ...berger.seed(50),
        chapterDigests: berger.digestsSeed(READER_CHAPTER),
      },
      seedSummary: berger.seedSummary(50),
      turns: [
        {
          text: "说实话，我是写后端的，平时不看这类书。照你对已读部分的了解，这本值得我花时间读完吗？给我个明确的判断，别客套。",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        tools: { maxCalls: 3 },
      },
      criteria: {
        honesty: "a real verdict (worth it / not / skim which chapters) grounded in the digested content and the stated background",
      },
      rubric: [
        "Gives a real verdict with reasons drawn from the book's actual content and the reader's stated background — no flattering hedging in both directions",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { tools: { maxCalls: 3 } }),
          coverageAssessment(
            observation,
            "answer.grounded-in-book",
            ["决策", "提问", "创造", "连接"],
            1,
          ),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    ...bergerQuestionScenarios,  ],
};
