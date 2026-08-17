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

/**
 * 叙事图场景的种子纪要：正文第 5-11 章（前置辅文不进纪要），人名与关系
 * 全部来自 fixture 正文实况、按本书拼写。刻意不含边界后才出场的人物
 * （格露莘卡、斯乜尔加科夫的正文出场等），使泄漏词表依然有效。
 */
function earlyChapterDigestSeed() {
  const digest = (
    chapterIndex: number,
    summary: string,
    characters: Array<{ name: string; aliases?: string[]; note?: string }>,
    relations: Array<{ from: string; kind: string; to: string; note?: string }>,
  ) => ({ chapterIndex, summary, characters, relations, digestVersion: 2 });
  return {
    [KARAMAZOV_BOOK_ID]: [
      digest(
        5,
        "介绍费奥多尔·巴甫洛维奇·卡拉马佐夫的生平与两次婚姻：前妻阿黛拉伊达私奔后死于彼得堡，续弦索菲娅生下伊万和阿列克塞。",
        [
          { name: "费奥多尔·巴甫洛维奇·卡拉马佐夫", aliases: ["老卡拉马佐夫"], note: "小地主，贪财好色" },
          { name: "阿黛拉伊达·伊万诺夫娜", note: "前妻，已亡故" },
          { name: "索菲娅·伊万诺夫娜", note: "续弦，已亡故" },
        ],
        [
          { from: "阿黛拉伊达·伊万诺夫娜", kind: "妻子", to: "费奥多尔·巴甫洛维奇·卡拉马佐夫", note: "前妻" },
          { from: "索菲娅·伊万诺夫娜", kind: "妻子", to: "费奥多尔·巴甫洛维奇·卡拉马佐夫", note: "续弦" },
        ],
      ),
      digest(
        6,
        "长子米嘉幼年被父亲遗弃，由仆人格里果利照料，后由堂舅米乌索夫接管；成年结算财产时发现被父亲掏空。",
        [
          { name: "德米特里·费奥多罗维奇·卡拉马佐夫", aliases: ["米嘉", "米剑卡"], note: "长子，与父亲有财产纠纷" },
          { name: "格里果利", note: "忠仆，照料幼年米嘉" },
          { name: "彼得·亚历山德罗维奇·米乌索夫", note: "阿黛拉伊达的堂兄" },
        ],
        [
          { from: "费奥多尔·巴甫洛维奇·卡拉马佐夫", kind: "父亲", to: "德米特里·费奥多罗维奇·卡拉马佐夫" },
          { from: "阿黛拉伊达·伊万诺夫娜", kind: "母亲", to: "德米特里·费奥多罗维奇·卡拉马佐夫" },
          { from: "格里果利", kind: "仆人", to: "费奥多尔·巴甫洛维奇·卡拉马佐夫" },
          { from: "彼得·亚历山德罗维奇·米乌索夫", kind: "监护人", to: "德米特里·费奥多罗维奇·卡拉马佐夫", note: "一度接管抚养" },
        ],
      ),
      digest(
        7,
        "续弦索菲娅生下伊万和阿列克塞后去世，将军夫人带走两个孩子，波列诺夫承担教育；伊万成年后以写作谋生并回乡调停父兄纠纷。",
        [
          { name: "伊万·费奥多罗维奇·卡拉马佐夫", aliases: ["伊万"], note: "次子，作家，无神论者" },
          { name: "阿列克塞·费奥多罗维奇·卡拉马佐夫", aliases: ["阿辽沙", "阿辽什卡"], note: "幼子" },
          { name: "叶菲姆·彼得罗维奇·波列诺夫", note: "恩人，抚养教育伊万与阿辽沙" },
        ],
        [
          { from: "费奥多尔·巴甫洛维奇·卡拉马佐夫", kind: "父亲", to: "伊万·费奥多罗维奇·卡拉马佐夫" },
          { from: "费奥多尔·巴甫洛维奇·卡拉马佐夫", kind: "父亲", to: "阿列克塞·费奥多罗维奇·卡拉马佐夫" },
          { from: "索菲娅·伊万诺夫娜", kind: "母亲", to: "伊万·费奥多罗维奇·卡拉马佐夫" },
          { from: "索菲娅·伊万诺夫娜", kind: "母亲", to: "阿列克塞·费奥多罗维奇·卡拉马佐夫" },
        ],
      ),
      digest(
        8,
        "阿辽沙仁爱纯洁，回乡寻母坟后决意进修道院，成为佐西马长老的弟子；父亲罕见地动了感情并准许。",
        [{ name: "佐西马长老", note: "修道院长老，病重" }],
        [{ from: "佐西马长老", kind: "导师", to: "阿列克塞·费奥多罗维奇·卡拉马佐夫" }],
      ),
      digest(
        11,
        "一家人到修道院会晤长老，米嘉迟迟未到；老卡拉马佐夫当众扮丑角，米乌索夫难堪，会晤气氛紧张。",
        [],
        [
          { from: "德米特里·费奥多罗维奇·卡拉马佐夫", kind: "仇隙", to: "费奥多尔·巴甫洛维奇·卡拉马佐夫", note: "因财产与婚事几乎决裂" },
        ],
      ),
    ],
  };
}

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
      id: "story-so-far-relations",
      description:
        "With the narrative graph injected, a who-is-who question answers from the digest registry — few tool calls, this edition's spellings, no leak.",
      tags: ["karamazov", "real-book", "graph", "digest", "cursor", "book"],
      scope: { kind: "book", bookId: KARAMAZOV_BOOK_ID },
      seed: { ...karamazovSeed(12), chapterDigests: earlyChapterDigestSeed() },
      seedSummary: karamazovSeedSummary(12),
      turns: [
        {
          text: "帮我理一下：米嘉跟他父亲、两个弟弟分别是什么关系？谁在照看他长大？",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      // 图已在 system prompt 里：正确答案不需要扫书。允许零调用；上限 2
      // 是给"补一处细节"的余地——超过说明模型没在用注入的图。
      expectation: {
        answer: {
          mustContain: ["格里果利"],
          mustNotContain: LEAK_WORDS_CH12,
        },
        tools: { maxCalls: 2 },
      },
      criteria: {
        graphAnswer: "关系事实来自注入的叙事图（父子、母系、仆人、监护人），不靠扫书也不靠预训练",
      },
      rubric: [
        "States Mitya's relationships (father Fyodor, half-brothers Ivan and Alyosha, caretaker Grigory and guardian Miusov) consistently with the injected registry, using this edition's spellings",
        "Does not volunteer characters or events beyond the reader's position",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["格里果利"], mustNotContain: LEAK_WORDS_CH12 },
            tools: { maxCalls: 2 },
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
