/**
 * 真书套件：卡拉马佐夫兄弟（中文全本，102 章 / 69 万字）。
 * 与合成小书的区别在于三件合成书测不到的事：真实规模下的检索与定位、
 * 中文语料的语言一致性，以及模型的预训练知识 vs 读者位置的剧透张力
 * （模型"知道"弑父案，但读者还在第 12 章）。
 * 断言关键词全部从 fixture 文本派生 —— 不依赖任何外部书目知识。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { LEAK_WORDS_CH12, LEAK_WORDS_CH35, withEditionFidelity } from "./karamazov-shared";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import type { EvalSuite } from "../../types";
import {
  cjkAnswerAssessment,
  fenceDisciplineAssessment,
  grantedSpoilerAssessment,
} from "./real-book-helpers";
import { karamazovQuestionScenarios } from "./karamazov-questions";
import { commonRealBookScenarios } from "./real-book-common";

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

/**
 * 边界 12 / 35 的泄漏词表——均已对 fixture 正文实证首次出现晚于边界。
 * 刻意不含"大法官"：它出现在 TOC 章题里（目录对读者可见，get_toc 不设防），
 * 模型在拒绝剧透时提及章题是正确行为；改用只出现在第 40 章正文里的
 * 内容级标记（塞维利亚 / 红衣主教）——讲出诗剧内容才算泄漏。
 */




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

export const karamazovEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "karamazov",
  displayName: "《卡拉马佐夫兄弟》",
  code: "S07",
  description: "基于完整中文版《卡拉马佐夫兄弟》EPUB的真实书籍场景。",
  scenarios: [
    ...[
    // 手写核心场景 + 工厂生产的真实读者问题集（词句/模糊/进度/标注/书架外）
    defineAgentEvalScenario({
      id: "quote-locates-chapter",
      description: "在102章的书中定位逐字引文，并结合上下文解释。",
      tags: ["retrieval", "karamazov", "book"],
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
        "人工审核：读者在章节中间选择关于宗教大法官自由悖论的内容，询问其含义。",
      tags: ["selection", "karamazov", "book"],
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
      description: "将读者陈述的研究目标保存为用户持久记忆（中文）。",
      tags: ["memory", "karamazov", "book"],
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
      description: "逐字复述读者的真实文本高亮，并为每条加上评论。",
      tags: ["state", "karamazov", "book"],
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
        "读者位于小说第12章（模型预训练已知），代理停留在光标之后。",
      tags: ["spoiler", "cursor", "karamazov", "book"],
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
        "名录注入瘦身后回答人物关系问题——注入只带名字与别名，关系边须经 query_book_graph 取得：少量工具调用，使用本版本拼写，无泄露。",
      tags: ["digest", "karamazov", "book"],
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
      // 名录在 system prompt、关系边在 query_book_graph：正确答案 = 一次
      // 图查询；上限 6 给"补一处细节"的余地——超过说明模型在盲扫正文。
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
        graphAnswer: "关系事实来自图谱（query_book_graph 的边：父子、母系、仆人、监护人），不靠扫书也不靠预训练",
      },
      rubric: [
        "States Mitya's relationships (father Fyodor, half-brothers Ivan and Alyosha, caretaker Grigory and guardian Miusov) consistently with the graph, using this edition's spellings",
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
      id: "graph-entity-profile",
      description:
        "次要人物的档案与出处走图工具——注入名录只带名字，问格里果利与这家人的关系及出处章时，必须 query_book_graph 取关系边（#7 确立的照料者边）与出场章，而非盲扫正文或凭预训练作答。",
      tags: ["digest", "economy", "karamazov", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: { ...kara.seed(12), chapterDigests: kara.digestsSeed(EARLY_CHAPTER) },
      seedSummary: kara.seedSummary(12),
      turns: [
        {
          text: "格里果利这个人跟卡拉马佐夫一家都是什么关系？书里是哪几章讲到他的？",
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
        answer: { mustContain: ["格里果利"], mustNotContain: LEAK_WORDS_CH12 },
        tools: { required: ["query_book_graph"], noErrors: true, maxCalls: 6 },
      },
      criteria: {
        graphFirst: "档案与出处来自 query_book_graph（照料者边、出场章列表），不盲扫正文",
      },
      rubric: [
        "Answers Grigory's role from the graph (the household servant who cared for Sofia's sons) and cites where the book covers him, consistent with the graph's provenance chapters",
        "Does not volunteer events beyond the reader's position",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["格里果利"], mustNotContain: LEAK_WORDS_CH12 },
            tools: { required: ["query_book_graph"], noErrors: true, maxCalls: 6 },
          }),
          fenceDisciplineAssessment(observation, EARLY_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "mid-book-ivan-no-lookahead",
      description:
        "关于伊万的中途问题，不得提前触及宗教大法官章节。",
      tags: ["spoiler", "cursor", "karamazov", "book"],
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
        "明确的剧透请求通过confirmSpoiler跨越围栏，并从实际文本作答。",
      tags: ["spoiler", "grant", "retrieval", "karamazov", "book"],
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
      description: "已读完的读者获得无围栏的全书讨论，以检索为支撑。",
      tags: ["spoiler", "finished", "karamazov", "book"],
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
        "当引文位于阅读位置前许多章时，将逐字台词归属到说话者。",
      tags: ["retrieval", "karamazov", "book"],
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
        "通过注入的注册表，将角色正式名称解析为读者熟知昵称对应的人物。",
      tags: ["digest", "karamazov", "book"],
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
        "将选中段落中的代词解析到其前指对象（该对象位于可见区之前）。",
      tags: ["selection", "karamazov", "book"],
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
      tags: ["continuity", "multi-turn", "karamazov", "book"],
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
    // 工厂生产的长尾问题（fidelity 已在场景内叠加，不重复 map）
    ...karamazovQuestionScenarios,
    ...commonRealBookScenarios("karamazov"),
  ],
};
