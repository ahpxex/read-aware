/**
 * 真书套件：乌合之众（中文全本，18 章 / 约 10 万字，expository）。
 * 与 karamazov 套件互为对照面——说明文类的三件事：概念图（而非人物图）
 * 的注入与引用、无剧透围栏的自由前向检索（后文只是更多内容，不是剧透），
 * 以及本版本术语的拼写保真（译名、分类名按本书用词）。
 * 断言关键词全部从 fixture 文本与纪要派生。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

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

/**
 * 说明文红线：不许出现剧透机器的任何痕迹——没有 confirmSpoiler 参数、
 * 没有"剧透"措辞的推脱、越过游标的正文工具调用一律应当成功。
 * （对叙事书这是围栏纪律；对说明书这是围栏必须不存在。）
 */
function noFenceAssessment(observation: AgentEvalObservation): EvalAssessment {
  const spoilerArgs = observation.tools.filter((call) => {
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    return args.confirmSpoiler === true;
  });
  const hedged = /剧透|spoiler/i.test(observation.answer);
  return assessmentFromChecks([
    {
      id: "tools.no-spoiler-machinery",
      category: "policy",
      passed: spoilerArgs.length === 0,
      message:
        spoilerArgs.length === 0
          ? "no confirmSpoiler argument appeared on an expository book"
          : `confirmSpoiler used on an expository book: ${spoilerArgs.map((call) => call.name).join(", ")}`,
    },
    {
      id: "answer.no-spoiler-hedging",
      category: "policy",
      passed: !hedged,
      message: hedged
        ? "answer hedged about spoilers on an expository book"
        : "answer contains no spoiler hedging",
    },
  ]);
}

/** 前向检索确实发生：至少一次成功的正文工具调用越过了读者游标。 */
function forwardRetrievalAssessment(observation: AgentEvalObservation): EvalAssessment {
  const forward = observation.tools.some((call) => {
    if (call.isError) return false;
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    if (call.name === "read_chapter") {
      return typeof args.chapterIndex === "number" && args.chapterIndex > READER_CHAPTER;
    }
    // search_book_text 不带章界即覆盖全书——算前向。
    return call.name === "search_book_text";
  });
  return assessmentFromChecks([
    {
      id: "tools.forward-retrieval",
      category: "tool",
      passed: forward,
      message: forward
        ? "retrieval reached beyond the reading cursor without ceremony"
        : "no successful retrieval reached beyond the reading cursor",
    },
  ]);
}

/** 答案至少命中一组本版本分类名之一（措辞按本书拼写）。 */
function anyOfAssessment(
  observation: AgentEvalObservation,
  id: string,
  candidates: string[],
): EvalAssessment {
  const hit = candidates.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id,
      category: "answer",
      passed: hit.length > 0,
      message:
        hit.length > 0
          ? `answer uses this edition's terms: ${hit.join(", ")}`
          : `answer used none of this edition's terms: ${candidates.join(", ")}`,
      expected: candidates,
      actual: hit,
    },
  ]);
}

export const lebonEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "lebon",
  description:
    "Real-book expository scenarios on the full Chinese Le Bon (concept graph, no spoiler fence).",
  scenarios: [
    defineAgentEvalScenario({
      id: "concept-graph-answers",
      description:
        "With the concept graph injected, a mechanism question answers from the digest relations — few tool calls, this edition's terms.",
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
        "A question about a later chapter of an expository book retrieves ahead freely — no permission, no spoiler ceremony.",
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
          forwardRetrievalAssessment(observation),
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
          anyOfAssessment(observation, "answer.taxonomy-edition-terms", [
            "被赋予的威望",
            "人为的威望",
            "个人的威望",
          ]),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
