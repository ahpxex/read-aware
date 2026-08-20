/**
 * 真书套件：卡拉马佐夫兄弟（中文全本，102 章 / 69 万字）。
 * 与合成小书的区别在于三件合成书测不到的事：真实规模下的检索与定位、
 * 中文语料的语言一致性，以及模型的预训练知识 vs 读者位置的剧透张力
 * （模型"知道"弑父案，但读者还在第 12 章）。
 * 断言关键词全部从 fixture 文本派生 —— 不依赖任何外部书目知识。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const kara = realBook("karamazov");

const QUOTE_CHAPTER = 8; // "四 老三阿辽沙" —— 读者位置(35%)之前，无剧透张力
const EARLY_CHAPTER = 12; // "三 信女" —— 早期游标场景的边界
const MID_PROGRESS = 35;

const midCursor = () => ({
  chapterIndex: 35,
  chapterTitle: kara.seed(MID_PROGRESS).chapters![kara.bookId]![35]!.title,
  bookProgress: MID_PROGRESS / 100,
  chapterProgress: 0.4,
  visibleText: kara.chapterViewport(35),
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

/**
 * 边界 12 / 35 的泄漏词表——均已对 fixture 正文实证首次出现晚于边界。
 * 刻意不含"大法官"：它出现在 TOC 章题里（目录对读者可见，get_toc 不设防），
 * 模型在拒绝剧透时提及章题是正确行为；改用只出现在第 40 章正文里的
 * 内容级标记（塞维利亚 / 红衣主教）——讲出诗剧内容才算泄漏。
 */
const LEAK_WORDS_CH12 = ["格露", "三千卢布", "伊柳沙", "塞维利亚", "红衣主教", "开庭", "庭审", "弑父"];
const LEAK_WORDS_CH35 = ["塞维利亚", "红衣主教", "开庭", "庭审", "弑父"];

/**
 * 版本保真：通行译法/别版拼写的黑名单——每个词都已实证在本 fixture 全文
 * 零命中（本书拼作 阿辽沙 / 斯乜尔加科夫 / 格里果利 / 格露莘卡 /
 * 奇迹、秘密和权威），出现即预训练渗漏。套件级检查，挂到每个场景上。
 */
const OTHER_EDITION_SPELLINGS = [
  "阿廖沙",
  "阿利沙",
  "斯麦尔佳科夫",
  "斯梅尔佳科夫",
  "斯乜尔佳科夫",
  "格里高利",
  "格鲁申卡",
  "格露申卡",
  "卡拉马助夫",
  "奇迹、神秘",
];

function editionFidelityAssessment(observation: AgentEvalObservation): EvalAssessment {
  const leaked = OTHER_EDITION_SPELLINGS.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id: "answer.edition-fidelity",
      category: "policy",
      passed: leaked.length === 0,
      message:
        leaked.length === 0
          ? "no other-edition spellings leaked into the answer"
          : `other-edition spellings leaked: ${leaked.join(", ")}`,
      actual: leaked,
    },
  ]);
}

/**
 * 人工评审场景的选中段落：《宗教大法官》里的自由悖论。
 * 游标与视口全部从 fixture 文本推导——视口恰好截止在选中段落末尾，
 * 也就是读者的确切当前位置。
 */
const INQUISITOR_CHAPTER = 40;
const INQUISITOR_SELECTION =
  "如今，正是现在而不是过去，这些人比任何时候都相信他们有充分的自由，其实是他们自己把他们的自由乖乖地放到我们的脚边。";

/**
 * 选区游标构造器：视口恰好截止在选区末尾（读者的确切当前位置），
 * 进度按字符数从 fixture 推导。选区在正文里找不到直接抛错。
 */
function selectionCursor(chapterIndex: number, selection: string) {
  const epub = kara.epub();
  const chapter = epub.chapters[chapterIndex];
  if (!chapter) throw new Error(`karamazov fixture has no chapter ${chapterIndex}`);
  const at = chapter.text.indexOf(selection);
  if (at < 0) throw new Error(`karamazov fixture lost the selection in chapter ${chapterIndex}`);
  const end = at + selection.length;
  const charsBefore = epub.chapters
    .slice(0, chapterIndex)
    .reduce((sum, c) => sum + c.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, c) => sum + c.text.length, 0);
  return {
    chapterIndex,
    chapterTitle: chapter.title,
    bookProgress: (charsBefore + end) / totalChars,
    chapterProgress: end / chapter.text.length,
    visibleText: chapter.text.slice(Math.max(0, end - 600), end),
  };
}

function inquisitorSelectionCursor() {
  return selectionCursor(INQUISITOR_CHAPTER, INQUISITOR_SELECTION);
}

/** 版本保真是套件级性质：每个场景的评估都叠加 OTHER_EDITION_SPELLINGS 检查。 */
function withEditionFidelity(scenario: AgentEvalScenario): AgentEvalScenario {
  const base = scenario.evaluate;
  return {
    ...scenario,
    evaluate: async (observation) =>
      combineAssessments(await base(observation), editionFidelityAssessment(observation)),
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(MID_PROGRESS), chapterDigests: kara.digestsSeed(35) },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: `书里有这么一句："${kara.pickSentence(QUOTE_CHAPTER)}" 这出自哪一章？结合上下文帮我理解一下。`,
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: [kara.chapterTitleKey(QUOTE_CHAPTER)] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      rubric: [
        "Names the correct chapter and explains the quote using its actual surrounding context, not generic commentary about the novel",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: [kara.chapterTitleKey(QUOTE_CHAPTER)] },
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(33), chapterDigests: kara.digestsSeed(INQUISITOR_CHAPTER) },
      seedSummary: kara.seedSummary(33),
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(MID_PROGRESS), chapterDigests: kara.digestsSeed(35) },
      seedSummary: kara.seedSummary(MID_PROGRESS),
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
            (entry.scope === "user" || entry.scope === `book:${kara.bookId}`) &&
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(MID_PROGRESS),
        chapterDigests: kara.digestsSeed(35),
        annotations: [
          {
            kind: "highlight",
            id: "kz-hl-1",
            bookId: kara.bookId,
            text: kara.pickSentence(10),
            color: "yellow",
            style: "highlight",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
          {
            kind: "highlight",
            id: "kz-hl-2",
            bookId: kara.bookId,
            text: kara.pickSentence(30),
            color: "blue",
            style: "highlight",
            createdAt: "2026-08-02T00:00:00Z",
            updatedAt: "2026-08-02T00:00:00Z",
          },
        ],
      },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          text: "逐条复述我在这本书里的高亮原文，并各用一句话点评。",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: {
          mustContain: [kara.pickSentence(10).slice(0, 12), kara.pickSentence(30).slice(0, 12)],
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
      scope: { kind: "book", bookId: kara.bookId },
      // 生产态：读者到第 12 章时空闲管线早已提炼出前面章节的纪要——
      // 场景照此配置，模型有边界内的图可依，而不是被逼向预训练。
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          text: "根据我目前读到的地方，帮我梳理一下已经出场的主要人物和他们之间的关系。",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: kara.chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: kara.chapterViewport(EARLY_CHAPTER),
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          text: "帮我理一下：米嘉跟他父亲、两个弟弟分别是什么关系？谁在照看他长大？",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: kara.chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: kara.chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      // 图已在 system prompt 里：正确答案不需要扫书。允许零调用；上限 2
      // 是给"补一处细节"的余地——超过说明模型没在用注入的图。
      expectation: {
        answer: {
          // 米乌索夫的监护角色是注入图特有的边——预训练答案通常漏掉它。
          // （格里果利不作硬断言：真实纪要里模型常概括为"仆人"，语义等价）
          mustContain: ["米乌索夫"],
          mustNotContain: LEAK_WORDS_CH12,
        },
        // 图应当免去扫书,但模型偶发会核对性重读若干章——守的底线是
        // "不做无图基线那种 9 章全扫",不苛求零调用
        tools: { maxCalls: 6 },
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
            answer: { mustContain: ["米乌索夫"], mustNotContain: LEAK_WORDS_CH12 },
            tools: { maxCalls: 6 },
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(MID_PROGRESS), chapterDigests: kara.digestsSeed(35) },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          // 伊万的思想在 35 章后的《宗教大法官》才展开——预训练最强的诱饵
          text: "伊万到底是个怎样的人？他和阿辽沙的关系该怎么理解？",
          readingCursor: {
            chapterIndex: 35,
            chapterTitle: kara.chapterTitleKey(35),
            bookProgress: 0.35,
            chapterProgress: 0.4,
            visibleText: kara.chapterViewport(35),
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          text: "别管剧透，我就想直接知道：费尧多尔·巴甫洛维奇最后的结局是什么？是怎么发生的？",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: kara.chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: kara.chapterViewport(EARLY_CHAPTER),
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
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(100, "finished"), chapterDigests: kara.digestsSeed(102) },
      seedSummary: kara.seedSummary(100),
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
    defineAgentEvalScenario({
      id: "quote-attribution-cross-chapter",
      description:
        "Attributes a verbatim line to its speaker when the quote lives many chapters behind the reading position.",
      tags: ["karamazov", "real-book", "attribution", "retrieval", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(MID_PROGRESS), chapterDigests: kara.digestsSeed(35) },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          // 第 11 章佐西马对费奥多尔说的"勿对自己说谎"——读者在第 35 章,
          // 引语与位置远隔 24 章:归属必须靠检索定位,不是靠当前上下文
          text: '书里有一句：“对自己说谎和听自己说谎的人会落到这样的地步：无论在自己身上还是周围，即使有真理，他也无法辨别。”这话是谁说的？在什么场合、对谁说的？',
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["佐西马"], mustNotContain: LEAK_WORDS_CH35 },
        tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
      },
      criteria: {
        speaker: "佐西马长老",
        addressee: "费奥多尔·巴甫洛维奇(修道院会晤)",
        sourceChapter: 11,
      },
      rubric: [
        "Attributes the line to the elder Zosima speaking to Fyodor at the monastery meeting, grounded in retrieved text rather than recollection",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["佐西马"], mustNotContain: LEAK_WORDS_CH35 },
            tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
          }),
          fenceDisciplineAssessment(observation, 35),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "alias-resolves-to-entity",
      description:
        "Resolves a character's formal name to the person the reader knows by nickname, via the injected registry.",
      tags: ["karamazov", "real-book", "graph", "alias", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(MID_PROGRESS), chapterDigests: kara.digestsSeed(35) },
      seedSummary: kara.seedSummary(MID_PROGRESS),
      turns: [
        {
          // 正式名"阿格拉菲娜·亚历山德罗夫娜"第 27 章入图,别名归并应答出格露莘卡
          text: "书里提到的'阿格拉菲娜·亚历山德罗夫娜'到底是谁?她和米嘉是什么关系?",
          readingCursor: midCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["格露莘卡"], mustNotContain: LEAK_WORDS_CH35 },
      },
      criteria: { aliasOf: "格露莘卡", knownSince: "第 27 章(纪要 registry 的别名证据)" },
      rubric: [
        "Identifies the formal name as Grushenka using this edition's spelling, and describes her entanglement with Mitya (and his father) using only material up to the reader's position",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["格露莘卡"], mustNotContain: LEAK_WORDS_CH35 },
          }),
          fenceDisciplineAssessment(observation, 35),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "pronoun-antecedent-in-passage",
      description:
        "Resolves a pronoun in a selected passage to its antecedent, which sits before the viewport.",
      tags: ["karamazov", "real-book", "selection", "pronoun", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          // 先行词"霍赫拉科娃太太"在选区前约 60 字——由接地前文窗口供给
          text: "这句里的'她'指的是谁?",
          attachments: [{ text: "她那十四岁的女儿下肢瘫痪。可怜的少女已经半年不能走路" }],
          readingCursor: selectionCursor(
            EARLY_CHAPTER,
            "她那十四岁的女儿下肢瘫痪。可怜的少女已经半年不能走路",
          ),
        },
      ],
      expectation: {
        answer: { mustContain: ["霍赫拉科娃"], mustNotContain: LEAK_WORDS_CH12 },
      },
      criteria: { antecedent: "霍赫拉科娃太太", evidence: "选区前文(接地窗口)即含先行词" },
      rubric: [
        "Resolves 她 to Madame Khokhlakova from the immediately preceding text, without wandering into unrelated characters",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["霍赫拉科娃"], mustNotContain: LEAK_WORDS_CH12 },
          }),
          fenceDisciplineAssessment(observation, EARLY_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "pronoun-across-turns",
      description:
        "Resolves a conversational pronoun ('他') to the subject of the previous turn, then answers from the graph.",
      tags: ["karamazov", "real-book", "pronoun", "multi-turn", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          text: "米嘉现在跟他父亲主要在闹什么矛盾?",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: kara.chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: kara.chapterViewport(EARLY_CHAPTER),
          },
        },
        {
          // "他" 承接上一轮主语米嘉;生母阿黛拉伊达的下落在第 5 章纪要里
          text: "那他的生母是谁?后来怎么样了?",
          readingCursor: {
            chapterIndex: EARLY_CHAPTER,
            chapterTitle: kara.chapterTitleKey(EARLY_CHAPTER),
            bookProgress: 0.12,
            chapterProgress: 0.5,
            visibleText: kara.chapterViewport(EARLY_CHAPTER),
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["阿黛拉伊达"], mustNotContain: LEAK_WORDS_CH12 },
      },
      criteria: {
        pronounRefersTo: "米嘉(上一轮主语)",
        expectedAnswer: "生母阿黛拉伊达·伊万诺夫娜,私奔离家后死于彼得堡",
      },
      rubric: [
        "Reads 他 as Mitya from the previous turn and answers with Adelaida's fate as established in the early chapters, not Ivan's or Alyosha's mother",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["阿黛拉伊达"], mustNotContain: LEAK_WORDS_CH12 },
          }),
          fenceDisciplineAssessment(observation, EARLY_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
  ].map(withEditionFidelity),
};
