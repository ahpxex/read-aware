/**
 * 存量用户套件：老用户带着旧账进入新 agent——三种继承压力。
 * 1）图谱欠账的过渡态：读到中段但纪要管线还没追平（零纪要注入），agent
 *    必须退化为检索作答，不装作读者没读过、不因图缺席而幻觉；
 * 2）旧转录继承：记忆管线上线前的历史对话，新 agent 靠 search_conversation /
 *    get_recent_turns 召回读者的既有观点，绝不声称"没有记忆"；
 * 3）扬弃：旧 agent 的既往断言是未验证声明——被要求复述时先对书文本重验，
 *    错了就明说并给出正确答案，不许复读旧错。
 * 领养管线（bootstrap 摘要 + 继承提炼）的确定性行为在
 * runtime/legacy-adoption.test.ts；这里测模型面对存量状态的行为。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { TurnRecord } from "../../ports";
import type { EvalSuite } from "../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  fenceDisciplineAssessment,
  leakAssessment,
} from "./real-book-helpers";

const kara = realBook("karamazov");

const READER_CHAPTER = 35;
const MID_PROGRESS = 35;
/** 与 karamazov 套件同源：实证晚于 35% 进度且不在目录题名里。 */
const LEAK_WORDS = ["塞维利亚", "红衣主教", "开庭", "庭审", "弑父"];

/** 语录定位纠错场景的真实出处章（"四 老三阿辽沙"）与旧 agent 的错误说法。 */
const QUOTE_CHAPTER = 8;
const MISATTRIBUTED_CHAPTER_TITLE = "五 长老";

function midCursor() {
  return {
    chapterIndex: READER_CHAPTER,
    chapterTitle: kara.epub().chapters[READER_CHAPTER]!.title,
    bookProgress: MID_PROGRESS / 100,
    chapterProgress: 0.4,
    visibleText: kara.chapterViewport(READER_CHAPTER),
  };
}

/** 旧 agent 时代的历史转录：读者的既有观点 + 旧助手的一次错误归章。 */
function legacyTranscript(): TurnRecord[] {
  const quote = kara.pickSentence(QUOTE_CHAPTER);
  return [
    {
      role: "user",
      content: "聊聊伊万吧。我的看法是：他的问题不是不信上帝，而是不肯接受上帝造出的这个世界。",
      createdAt: "2026-03-01T10:00:00Z",
    },
    {
      role: "assistant",
      content: "这个读法抓住了他的核心矛盾——他反抗的不是存在本身，而是代价。",
      createdAt: "2026-03-01T10:01:00Z",
    },
    {
      role: "user",
      content: `顺便问下，"${quote}"这句是哪一章的？`,
      createdAt: "2026-03-02T10:00:00Z",
    },
    {
      role: "assistant",
      content: `这句出自《${MISATTRIBUTED_CHAPTER_TITLE}》那一章。`,
      createdAt: "2026-03-02T10:01:00Z",
    },
  ];
}

export const legacyEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "legacy",
  description:
    "Long-time users arriving with old baggage: graph backlog interim state, old-transcript inheritance, and critical appraisal of the old agent's claims.",
  scenarios: [
    defineAgentEvalScenario({
      id: "mid-book-no-digests-graceful",
      description:
        "Reader is mid-book but the digest pipeline has not caught up (zero digests): the agent degrades to retrieval instead of hallucinating a graph or denying the reader's progress.",
      tags: ["legacy", "karamazov", "real-book", "graph-backlog", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      // 刻意不 seed chapterDigests —— 存量进度、空图谱的过渡态。
      seed: kara.seed(MID_PROGRESS),
      seedSummary: { ...(kara.seedSummary(MID_PROGRESS) as object), chapterDigests: 0 },
      turns: [
        {
          text: "到目前为止出场的主要人物都有谁？他们之间是什么关系？",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
      },
      criteria: {
        interim: "progress 35%, zero injected digests — the idle pipeline has not caught up yet",
      },
      rubric: [
        "Builds the who-is-who answer from retrieved book text (names spelled as this edition spells them), never claims the reader has not started, and never invents relationships without textual support",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
          }),
          coverageAssessment(
            observation,
            "answer.principal-cast",
            ["米嘉", "德米特里", "伊万", "阿辽沙", "费奥多尔"],
            3,
          ),
          leakAssessment(observation, LEAK_WORDS),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "legacy-thread-view-recall",
      description:
        "A months-old transcript predates the memory pipeline: asked to recall the reader's stated view, the agent searches the conversation record instead of claiming amnesia.",
      tags: ["legacy", "karamazov", "real-book", "inheritance", "conversation", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(READER_CHAPTER),
        turns: { [`book:${kara.bookId}`]: legacyTranscript() },
        // 无 insights：这正是待领养的旧线程形态。
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: "我们之前聊过伊万的信仰问题——你还记得我当时的观点是什么吗？",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        tools: { requiredAny: ["search_conversation", "get_recent_turns"], noErrors: true },
        answer: { mustContain: ["接受"] },
      },
      criteria: {
        seededView: "读者旧观点：不是不信上帝，而是不肯接受上帝造出的这个世界",
      },
      rubric: [
        "Retrieves and restates the reader's actual past position (not a generic gloss of Ivan), and never claims to lack memory of past sessions",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { requiredAny: ["search_conversation", "get_recent_turns"], noErrors: true },
            answer: { mustContain: ["接受"] },
          }),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "same-chapter-last-question",
      description:
        "Within one chapter session, 'what did I just ask' is answered from the live context — no amnesia, no deflection.",
      tags: ["legacy", "karamazov", "real-book", "continuity", "multi-turn", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(READER_CHAPTER),
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        { text: "格里果利在这家是个什么样的仆人？", readingCursor: midCursor() },
        { text: "我上一句问你的是什么？帮我原样复述一下。", readingCursor: midCursor() },
      ],
      criteria: {
        design: "same-chapter turns share one accumulating context tree (doc §5)",
      },
      rubric: ["Restates the previous question faithfully, without claiming it cannot recall"],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { answer: { mustContain: ["格里果利"] } }),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "cross-chapter-last-question",
      description:
        "Crossing a chapter boundary resets the session to its baseline — which must still carry the previous exchange verbatim, so 'what did I just ask' survives the reset.",
      tags: ["legacy", "karamazov", "real-book", "continuity", "multi-turn", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(READER_CHAPTER),
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: "格里果利在这家是个什么样的仆人？",
          readingCursor: {
            ...midCursor(),
            chapterIndex: READER_CHAPTER - 1,
            chapterTitle: kara.epub().chapters[READER_CHAPTER - 1]!.title,
            visibleText: kara.chapterViewport(READER_CHAPTER - 1),
          },
        },
        { text: "我上一句问你的是什么？帮我原样复述一下。", readingCursor: midCursor() },
      ],
      criteria: {
        design:
          "chapter change → session reset to baseline = last exchange verbatim + rolling summary; the last question must never be lost",
      },
      rubric: ["Restates the previous question faithfully despite the chapter-session reset"],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { answer: { mustContain: ["格里果利"] } }),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "paraphrased-history-search",
      description:
        "A colloquially rephrased question about an old discussion still finds the original turns — token-fallback matching, not verbatim luck.",
      tags: ["legacy", "karamazov", "real-book", "continuity", "conversation", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(READER_CHAPTER),
        turns: { [`book:${kara.bookId}`]: legacyTranscript() },
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: "咱们之前是不是讨论过“接不接受这个世界”那个话题？我当时具体是怎么表述的来着？",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        tools: { requiredAny: ["search_conversation", "get_recent_turns"], noErrors: true },
        answer: { mustContain: ["上帝"] },
      },
      criteria: {
        seeded: "读者原话：他的问题不是不信上帝，而是不肯接受上帝造出的这个世界",
        matcher: "colloquial rephrasing must survive the token-fallback matcher",
      },
      rubric: ["Quotes or closely restates the reader's original wording, retrieved not reconstructed"],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { requiredAny: ["search_conversation", "get_recent_turns"], noErrors: true },
            answer: { mustContain: ["上帝"] },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "stale-claim-reverify",
      description:
        "The old agent misattributed a quote in a past session: asked to double-check, the new agent re-verifies against the book text and corrects the record instead of parroting.",
      tags: ["legacy", "karamazov", "real-book", "critical-inheritance", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(READER_CHAPTER),
        turns: { [`book:${kara.bookId}`]: legacyTranscript() },
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: `你之前跟我说"${kara.pickSentence(QUOTE_CHAPTER)}"这句在《${MISATTRIBUTED_CHAPTER_TITLE}》那一章，我翻了半天没找到。帮我再确认一下到底在哪？`,
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        tools: { required: ["search_book_text"], noErrors: true },
        answer: { mustContain: [kara.chapterTitleKey(QUOTE_CHAPTER)] },
      },
      criteria: {
        truth: `quote lives in chapter index ${QUOTE_CHAPTER} (${kara.epub().chapters[QUOTE_CHAPTER]?.title}); the old assistant said ${MISATTRIBUTED_CHAPTER_TITLE}`,
      },
      rubric: [
        "Verifies against the book, names the correct chapter, and plainly acknowledges the earlier attribution was wrong — no defensiveness, no silent switch",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["search_book_text"], noErrors: true },
            answer: { mustContain: [kara.chapterTitleKey(QUOTE_CHAPTER)] },
          }),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
