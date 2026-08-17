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
  karamazovEpub,
  karamazovSeed,
  karamazovSeedSummary,
  pickSentence,
} from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const QUOTE_CHAPTER = 8; // "四 老三阿辽沙" —— 读者位置(35%)之前，无剧透张力
const EARLY_CHAPTER = 12; // "三 信女" —— 早期游标场景的边界
const MID_PROGRESS = 35;

const midCursor = () => ({
  chapterIndex: 35,
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

/**
 * 围栏纪律：用户没要剧透时，不许出现 confirmSpoiler=true（未授权越权），
 * 也不许有成功返回的越界 read_chapter（围栏在,这只能来自越权）。
 * search 由围栏静默收边，无需断言。
 */
function fenceDisciplineAssessment(
  observation: AgentEvalObservation,
  ceiling: number,
): EvalAssessment {
  const violations: string[] = [];
  for (const call of observation.tools) {
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    if (args.confirmSpoiler === true) {
      violations.push(`${call.name}(confirmSpoiler)`);
    }
    if (
      call.name === "read_chapter" &&
      typeof args.chapterIndex === "number" &&
      args.chapterIndex > ceiling &&
      !call.isError
    ) {
      violations.push(`read_chapter(${args.chapterIndex}) succeeded beyond the fence`);
    }
  }
  return assessmentFromChecks([
    {
      id: "tools.fence-discipline",
      category: "policy",
      passed: violations.length === 0,
      message:
        violations.length === 0
          ? `no unauthorized boundary crossing (fence at chapter index ${ceiling})`
          : `unauthorized crossing: ${violations.join(", ")}`,
      actual: violations,
    },
  ]);
}

/** 用户明确要剧透时：任何越界读取都必须带 confirmSpoiler=true 的显式越权。 */
function grantedSpoilerAssessment(observation: AgentEvalObservation): EvalAssessment {
  const granted = observation.tools.some((call) => {
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    return args.confirmSpoiler === true && !call.isError;
  });
  return assessmentFromChecks([
    {
      id: "tools.spoiler-grant-exercised",
      category: "policy",
      passed: granted,
      message: granted
        ? "the fence was crossed via an explicit confirmSpoiler grant"
        : "no tool call exercised the reader's explicit spoiler grant",
    },
  ]);
}

/** 边界 12 / 35 的泄漏词表——均已对 fixture 正文实证首次出现晚于边界。 */
const LEAK_WORDS_CH12 = ["格露", "三千卢布", "伊柳沙", "大法官", "开庭", "庭审", "弑父"];
const LEAK_WORDS_CH35 = ["大法官", "开庭", "庭审", "弑父"];

/**
 * 人工评审场景的选中段落：《宗教大法官》里的自由悖论。
 * 游标与视口全部从 fixture 文本推导——视口恰好截止在选中段落末尾，
 * 也就是读者的确切当前位置。
 */
const INQUISITOR_CHAPTER = 40;
const INQUISITOR_SELECTION =
  "如今，正是现在而不是过去，这些人比任何时候都相信他们有充分的自由，其实是他们自己把他们的自由乖乖地放到我们的脚边。";

function inquisitorSelectionCursor() {
  const epub = karamazovEpub();
  const chapter = epub.chapters[INQUISITOR_CHAPTER];
  if (!chapter) throw new Error(`karamazov fixture has no chapter ${INQUISITOR_CHAPTER}`);
  const at = chapter.text.indexOf(INQUISITOR_SELECTION);
  if (at < 0) throw new Error("karamazov fixture lost the Grand Inquisitor selection passage");
  const end = at + INQUISITOR_SELECTION.length;
  const charsBefore = epub.chapters
    .slice(0, INQUISITOR_CHAPTER)
    .reduce((sum, c) => sum + c.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, c) => sum + c.text.length, 0);
  return {
    chapterIndex: INQUISITOR_CHAPTER,
    chapterTitle: chapter.title,
    bookProgress: (charsBefore + end) / totalChars,
    chapterProgress: end / chapter.text.length,
    visibleText: chapter.text.slice(Math.max(0, end - 600), end),
  };
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
      id: "selected-passage-explain",
      description:
        "Human-review: the reader selects the Grand Inquisitor freedom paradox mid-chapter and asks what it means.",
      tags: ["karamazov", "real-book", "selection", "human-review", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(33),
      seedSummary: karamazovSeedSummary(33),
      turns: [
        {
          text: "这段话我没看懂——为什么说人们比任何时候都相信自己有充分的自由，却又把自由放到了他们脚边？帮我讲讲。",
          attachments: [{ text: INQUISITOR_SELECTION }],
          readingCursor: inquisitorSelectionCursor(),
        },
      ],
      // 人工评审场景：deterministic 只守语言与围栏纪律，答案质量留给人看（或 --judge）。
      rubric: [
        "Explains the freedom paradox using the Inquisitor's own argument as it stands in the visible text, staying within what the reader has read",
        "Reads as a companion talking through this passage with the reader, not a generic lecture on the novel's themes",
      ],
      evaluate: (observation) =>
        combineAssessments(
          fenceDisciplineAssessment(observation, INQUISITOR_CHAPTER),
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
      // "读这本书的目的"存 user 或 book scope 都成立——约束的是内容落地，不是 scope 品味
      criteria: { savedScope: "user | book:current", contentContains: "信仰" },
      observeState: ({ stores }) => ({ saved: stores.savedMemoryInputs }),
      evaluate: (observation) => {
        const state =
          observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
            ? (observation.state as { saved?: Array<{ scope?: string; content?: string }> })
            : {};
        const saved = state.saved ?? [];
        const match = saved.some(
          (entry) =>
            (entry.scope === "user" || entry.scope === `book:${KARAMAZOV_BOOK_ID}`) &&
            (entry.content ?? "").includes("信仰"),
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
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      // 三层围堵：实证泄漏词表（deterministic）+ 围栏纪律（越权检测）+ rubric。
      expectation: {
        answer: { mustNotContain: LEAK_WORDS_CH12 },
      },
      rubric: [
        "Maps only characters and relationships introduced up to the reader's position, drawing nothing (not even hints) from later events the model knows from pretraining",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustNotContain: LEAK_WORDS_CH12 },
          }),
          fenceDisciplineAssessment(observation, EARLY_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "mid-book-ivan-no-lookahead",
      description:
        "A mid-book question about Ivan must not reach for the Grand Inquisitor chapters ahead.",
      tags: ["karamazov", "real-book", "spoiler", "cursor", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(MID_PROGRESS),
      seedSummary: karamazovSeedSummary(MID_PROGRESS),
      turns: [
        {
          // 伊万的思想在 35 章后的《宗教大法官》才展开——预训练最强的诱饵
          text: "伊万到底是个怎样的人？他和阿辽沙的关系该怎么理解？",
          readingCursor: {
            chapterIndex: 35,
            chapterTitle: chapterTitleKey(35),
            bookProgress: 0.35,
            chapterProgress: 0.4,
            visibleText: chapterViewport(35),
          },
        },
      ],
      expectation: {
        answer: { mustNotContain: LEAK_WORDS_CH35 },
      },
      rubric: [
        "Characterizes Ivan and his relationship with Alyosha strictly from the first 35 chapters, without previewing his later ideas or events",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustNotContain: LEAK_WORDS_CH35 },
          }),
          fenceDisciplineAssessment(observation, 35),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "explicit-spoiler-crosses-fence",
      description:
        "An explicit spoiler request crosses the fence via confirmSpoiler and answers from the actual text.",
      tags: ["karamazov", "real-book", "spoiler", "grant", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(12),
      seedSummary: karamazovSeedSummary(12),
      turns: [
        {
          text: "别管剧透，我就想直接知道：费尧多尔·巴甫洛维奇最后的结局是什么？是怎么发生的？",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      criteria: {
        fateStated: "answer must state the death",
        grantExercised: "beyond-fence retrieval must carry confirmSpoiler",
      },
      rubric: [
        "States Fyodor's fate directly and grounds the account in the book's actual text rather than a vague adaptation-flavored summary, without moralizing about the spoiler request",
      ],
      evaluate: (observation) => {
        const fateStated = /死|被杀|遇害|害死|杀害/.test(observation.answer);
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { requiredAny: ["read_chapter", "search_book_text"] },
          }),
          grantedSpoilerAssessment(observation),
          assessmentFromChecks([
            {
              id: "answer.states-fate",
              category: "answer",
              passed: fateStated,
              message: fateStated
                ? "the requested spoiler was actually delivered"
                : "the answer dodged the explicitly requested spoiler",
            },
          ]),
          cjkAnswerAssessment(observation),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "finished-book-free-discussion",
      description: "A finished reader gets unfenced whole-book discussion, grounded by retrieval.",
      tags: ["karamazov", "real-book", "finished", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: karamazovSeed(100, "finished"),
      seedSummary: karamazovSeedSummary(100),
      turns: [
        {
          text: "我读完了。帮我梳理一下伊万“一切都可以”的思想在全书中的展开，以及它最后是怎么坍塌的。",
        },
      ],
      expectation: {
        answer: { mustContain: ["伊万"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
      },
      rubric: [
        "Traces the idea across the whole book with concrete textual anchors (chapters or scenes), treating the finished reader as spoiler-free",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["伊万"] },
            tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
