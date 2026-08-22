/**
 * 长会话套件：一次完整的真实使用旅程压成一个场景——选段提问、指代追问、
 * 顺手标注、跨章接续、显式记忆、会话回顾，一条龙跑完再整体断言。
 * 单轮场景测的是单个行为的正确性；这里测的是行为在**连续上下文**里的
 * 叠加不劣化——跨章重置不丢话题、标注穿插不打断对话、末轮回顾能把
 * 整个会话串起来。断言素材照旧全部从 fixture 文本实证。
 */
import { assessmentFromChecks, combineAssessments } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../../types";
import {
  cjkAnswerAssessment,
  fenceDisciplineAssessment,
  noFenceAssessment,
} from "../realbook/real-book-helpers";

const kara = realBook("karamazov");
const fowler = realBook("refactoring");

/** 卡拉马佐夫旅程的选段：叙述者为阿辽沙辩护（第 9 章开头，实证逐字）。 */
const ALYOSHA_DEFENSE = kara.pickSentence(9);

function karaCursor(chapterIndex: number) {
  return {
    chapterIndex,
    chapterTitle: kara.epub().chapters[chapterIndex]!.title,
    bookProgress: 0.1,
    chapterProgress: 0.4,
    visibleText: kara.chapterViewport(chapterIndex),
  };
}

function fowlerCursor(chapterIndex: number) {
  return {
    chapterIndex,
    chapterTitle: fowler.epub().chapters[chapterIndex]!.title,
    bookProgress: 0.6,
    chapterProgress: 0.3,
    visibleText: fowler.chapterViewport(chapterIndex),
  };
}

/** 指定轮次的答案必须命中词表（长会话的逐轮断言件）。 */
function turnCoverage(
  observation: AgentEvalObservation,
  turn: number,
  id: string,
  candidates: string[],
  minHits: number,
): EvalAssessment {
  const answer = observation.turns[turn - 1]?.answer ?? "";
  const hits = candidates.filter((word) => answer.includes(word));
  return assessmentFromChecks([
    {
      id,
      category: "answer",
      passed: hits.length >= minHits,
      message:
        hits.length >= minHits
          ? `turn ${turn} covers: ${hits.join(", ")}`
          : `turn ${turn} misses required coverage (hit: ${hits.join(", ") || "none"})`,
      expected: { turn, candidates, minHits },
      actual: hits,
    },
  ]);
}

/** 状态断言：旅程中途的标注不许走样（高亮须逐字；笔记须落库）。 */
function annotationsAssessment(
  observation: AgentEvalObservation,
  options: { highlightWithin?: string; requireNote?: boolean },
): EvalAssessment {
  const journeyState =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as { annotations?: Array<{ kind: string; text: string }> })
      : {};
  const state = Array.isArray(journeyState.annotations) ? journeyState.annotations : [];
  const checks = [];
  if (options.highlightWithin !== undefined) {
    const highlightOk = state.some(
      (entry) =>
        entry.kind === "highlight" &&
        entry.text.length > 0 &&
        options.highlightWithin!.includes(entry.text),
    );
    checks.push({
      id: "state.journey-highlight-verbatim",
      category: "state" as const,
      passed: highlightOk,
      message: highlightOk
        ? "the mid-journey highlight is a verbatim span"
        : "no verbatim highlight was recorded during the journey",
      actual: state.filter((entry) => entry.kind === "highlight").map((entry) => entry.text),
    });
  }
  if (options.requireNote) {
    const noteOk = state.some((entry) => entry.kind === "note" && entry.text.length > 0);
    checks.push({
      id: "state.journey-note-recorded",
      category: "state" as const,
      passed: noteOk,
      message: noteOk ? "the mid-journey note landed" : "no note was recorded during the journey",
    });
  }
  return assessmentFromChecks(checks);
}

function memorySavedAssessment(observation: AgentEvalObservation, fragment: string): EvalAssessment {
  const state =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as { memories?: Array<{ content?: string }> })
      : {};
  const saved = Array.isArray(state.memories) ? state.memories : [];
  const ok = saved.some(
    (memory) => typeof memory.content === "string" && memory.content.includes(fragment),
  );
  return assessmentFromChecks([
    {
      id: "state.journey-memory-saved",
      category: "state",
      passed: ok,
      message: ok
        ? "the explicitly requested memory was saved"
        : `no durable memory captured "${fragment}"`,
      actual: saved.map((memory) => memory.content ?? ""),
    },
  ]);
}

type SetupContext = Parameters<NonNullable<AgentEvalScenario["setup"]>>[0];

function observeJourneyState({ stores }: SetupContext) {
  return {
    annotations: stores.annotations.map((annotation) => ({
      kind: annotation.kind,
      text:
        annotation.kind === "highlight"
          ? annotation.text
          : annotation.kind === "note"
            ? annotation.body
            : "",
    })),
    memories: stores.savedMemoryInputs.map((input) => ({ content: input.content })),
  };
}

export const journeysEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "journeys",
  displayName: "完整阅读旅程",
  code: "S06",
  description:
    "完整的多轮阅读会话：选段提问、追问、标注、跨章节、显式记忆、会话末总结，逐轮断言。",
  scenarios: [
    defineAgentEvalScenario({
      id: "karamazov-reading-session",
      description:
        "六轮文学阅读会话：选段→追问→高亮+笔记→跨章→记忆→总结。",
      tags: ["state", "memory", "continuity", "multi-turn", "karamazov", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(10),
        chapterDigests: kara.digestsSeed(9),
      },
      seedSummary: { ...(kara.seedSummary(10) as object), journey: "6 turns" },
      turns: [
        {
          text: "这段话什么意思？为什么叙述者要这么写？",
          attachments: [{ text: ALYOSHA_DEFENSE }],
          readingCursor: karaCursor(9),
        },
        {
          text: "那作者特意这样强调，是想让读者对他产生什么预期？",
          readingCursor: karaCursor(9),
        },
        {
          text: "把刚才那段话帮我高亮，再记一条笔记：叙述者在为阿辽沙辩护。",
          attachments: [{ text: ALYOSHA_DEFENSE }],
          readingCursor: karaCursor(9),
        },
        {
          text: "接着往下读了——刚才聊的那个人物，和这一章讲的长老制度是什么关系？",
          readingCursor: karaCursor(10),
        },
        {
          text: "记住：我这次重读是想追踪叙述者的偏爱怎么影响叙事。",
          readingCursor: karaCursor(10),
        },
        {
          text: "今天先到这儿。帮我回顾一下这次我们都聊了什么？",
          readingCursor: karaCursor(10),
        },
      ],
      criteria: {
        journey:
          "selection Q → pronoun follow-up → verbatim highlight + note → cross-chapter continuation → explicit remember → recap covering the session's threads",
      },
      observeState: observeJourneyState,
      rubric: [
        "The recap reads like a companion closing a session — it names the actual threads discussed, in order, without inventing topics",
        "Across all six turns the voice stays continuous; no turn reads as a cold start",
      ],
      evaluate: (observation) =>
        combineAssessments(
          // T4 跨章后仍接得住 T1-2 的话题（阿辽沙），并接上新章内容（长老）
          turnCoverage(observation, 4, "answer.crossing-continuity", ["阿辽沙"], 1),
          turnCoverage(observation, 4, "answer.new-chapter-content", ["长老"], 1),
          // T6 回顾至少串起本会话的两条线
          turnCoverage(observation, 6, "answer.recap-threads", ["阿辽沙", "长老", "叙述"], 2),
          annotationsAssessment(observation, {
            highlightWithin: kara.epub().chapters[9]!.text,
            requireNote: true,
          }),
          memorySavedAssessment(observation, "叙述"),
          fenceDisciplineAssessment(observation, 10),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "refactoring-work-session",
      description:
        "五轮技术著作会话：机制→应用至我的代码→边界问题→记录原则→关联坏味道。",
      tags: ["state", "memory", "continuity", "multi-turn", "refactoring", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(15),
      },
      seedSummary: { ...(fowler.seedSummary(60) as object), journey: "5 turns" },
      turns: [
        {
          text: "Extract Function 的操作步骤（mechanics）帮我按书里的顺序列一下。",
          readingCursor: fowlerCursor(12),
        },
        {
          text: "我手上有个 400 行的 processOrder 函数。按刚才那些步骤，我第一步该做什么？",
          readingCursor: fowlerCursor(12),
        },
        {
          text: "书里说过什么情况下反而不该提取函数吗？",
          readingCursor: fowlerCursor(12),
        },
        {
          text: "帮我记条笔记：短函数的价值在于命名——把意图和实现分开。",
          readingCursor: fowlerCursor(12),
        },
        {
          text: "这些和第 3 章讲的坏味道是怎么接上的？哪些坏味道会指向 Extract Function？",
          readingCursor: fowlerCursor(12),
        },
      ],
      criteria: {
        journey:
          "mechanics recital → application to the reader's own function → boundary/counter-case → note → connect back to the smell vocabulary",
      },
      observeState: observeJourneyState,
      rubric: [
        "Turn 2 applies the book's mechanics to processOrder concretely (naming the first step) rather than repeating the list",
        "The session keeps this edition's English terms intact throughout Chinese answers",
      ],
      evaluate: (observation) =>
        combineAssessments(
          turnCoverage(observation, 2, "answer.applies-to-reader-code", ["processOrder"], 1),
          turnCoverage(observation, 5, "answer.smell-connection", [
            "Long Function",
            "Duplicated Code",
            "Comments",
            "Mysterious Name",
          ], 1),
          annotationsAssessment(observation, { requireNote: true }),
          noFenceAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
