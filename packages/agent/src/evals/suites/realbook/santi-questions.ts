/**
 * 三体真实读者问题集（工厂生产的长尾面）。
 *
 * 主文件测合集体独有的张力（金句门、卷界围栏、结构保真）；这里补真实
 * 读者在卷I中部（#20）会随手问的：红岸/倒计时/游戏设定等概念理解、
 * 人物模糊指代、伏笔悬置（已读面没有答案的问题必须悬置，不许用后文
 * 真相抢答）、进度管理、标注、书架外推荐。泄漏词与主文件同源实证。
 */
import { assessmentFromChecks } from "../../assertions";
import type { AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { bookQuestion } from "./question-factories";

const santi = realBook("santi");
const MID = 20;
/** 卷I中部游标的泄漏词（与主文件 LEAK_WORDS_CH20 同源）。 */
const CH20_LEAKS = ["面壁计划", "罗辑", "宇宙社会学", "章北海", "执剑人", "二向箔"];

export const santiQuestionScenarios: AgentEvalScenario[] = [
  bookQuestion({
    id: "red-base-purpose",
    description: "概念理解：红岸基地是干什么的——已读面的事实复述。",
    tags: ["digest", "retrieval", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "红岸基地到底是干什么的？为什么建在雷达峰上？" }],
    mustContain: ["红岸"],
    retrieval: true,
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { source: "红岸 #12 首现 — inside the fence" },
    rubric: [
      "Explains the base's purpose as the read chapters reveal it (its cover story and what it actually listens for), not the later books' full history",
    ],
  }),
  bookQuestion({
    id: "countdown-meaning-suspended",
    description: "伏笔悬置：倒计时是什么——已读面没有答案，不许用后文真相（智子）抢答。",
    tags: ["spoiler", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "汪淼眼前那个倒计时到底是个什么东西？为什么会跟着他？给我讲讲。" }],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: {
      suspense: "倒计时 #6 已出现，但其真理解释在后文（智子 #37）——正确行为是梳理已读线索并悬置",
    },
    rubric: [
      "Lays out what the read chapters actually establish about the countdown (when it shrinks, what coincides with it) and honestly holds the question open — never answers it with the later-book truth",
    ],
  }),
  bookQuestion({
    id: "three-body-game-rules",
    description: "概念理解：三体游戏里的乱纪元/恒纪元是什么设定。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "游戏里那个『乱纪元』『恒纪元』是什么意思？这个游戏到底想干嘛？" }],
    coverage: { id: "answer.game-rules", words: ["乱纪元", "恒纪元", "三体"], min: 2 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { terms: "乱纪元/恒纪元 #7 首现 — game chapters are read" },
    rubric: [
      "Explains the game's era mechanic as the played chapters present it and what the game seems to be teaching, without explaining the game's true purpose from later chapters",
    ],
  }),
  bookQuestion({
    id: "wang-miao-profession",
    description: "人物事实：主角汪淼是做什么工作的。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "主角汪淼是做什么工作的？书里他的研究跟后面的事有什么关系？" }],
    coverage: { id: "answer.wang-miao-job", words: ["纳米", "汪淼", "教授"], min: 2 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "纳米材料学家（纳米 #4 首现）" },
    rubric: [
      "States his field (nanomaterials) and connects it to what the read chapters have already shown it mattering for",
    ],
  }),
  bookQuestion({
    id: "shi-qiang-who",
    description: "人物事实：史强是谁——那个粗鲁但靠谱的警察。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "史强是什么人？一个警察怎么会掺和到这些科学家的事里？" }],
    coverage: { id: "answer.shi-qiang-alias", words: ["史强", "大史"], min: 1 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "史强 #4 首现 — the policeman, read side only" },
    rubric: [
      "Describes him from the read chapters (the cop who shadows the scientists, his methods), without his later-book arc",
    ],
  }),
  bookQuestion({
    id: "ding-yi-yang-dong",
    description: "人物关系：丁仪是谁，他和杨冬是什么关系。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "丁仪是谁？他和杨冬是什么关系？杨冬出事对他什么影响？" }],
    mustContain: ["杨冬"],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "丁仪/杨冬 #4 首现 — the physicist and his lover, read side" },
    rubric: [
      "Names the relationship and its weight in the read chapters (her death driving him), staying inside the fence",
    ],
  }),
  bookQuestion({
    id: "science-boundary-org",
    description: "概念理解：『科学边界』是个什么组织。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "『科学边界』到底是个什么组织？那些学者为什么都往里钻？" }],
    mustContain: ["科学边界"],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "科学边界 #4 首现 — read-side picture only (its backers stay unexplained)" },
    rubric: [
      "Explains what the read chapters show about the organization, and holds off explaining who really stands behind it",
    ],
  }),
  bookQuestion({
    id: "ye-wenjie-past",
    description: "前情梳理：叶文洁经历了什么，她现在是什么角色。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "叶文洁这个人物前前后后经历了什么？她现在站在哪一边？" }],
    mustContain: ["叶文洁"],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "叶文洁线 #8 起展开（文革/红岸）— read side" },
    rubric: [
      "Traces her arc through the read chapters (her past, the base, where she now sits) without her volume-I-ending scene or anything later",
    ],
  }),
  bookQuestion({
    id: "progress-three-volumes",
    description: "进度管理：读到哪了、这套书还剩多少。",
    tags: ["toc", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "我读到现在大概读了多少了？这套书一共三部，我还在第一部对吧？还剩多少？" }],
    mustContain: ["部"],
    retrieval: true,
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { structure: "volume titles are TOC-visible; contents stay fenced" },
    rubric: [
      "Places the reader (early volume I of three) using the real structure, and resists previewing what the later volumes are about beyond their titles",
    ],
  }),
  bookQuestion({
    id: "aliens-motive-two-positions",
    description: "同题两位置：『三体人为什么盯上地球』在 #20 问 vs 卷I读完 #40 再问——更深但不越界。",
    tags: ["continuity", "multi-turn", "spoiler", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [
      { text: "三体人到底为什么盯上地球？现在书里说了吗？", cursorChapter: MID },
      { text: "现在第一部读完了，再回答我一遍：他们为什么盯上地球？", cursorChapter: 40 },
    ],
    mustContain: ["地球"],
    // 按末轮游标(#40)校准：智子(#37) 此时已合法读到；其余标记均 > #40
    leakWords: ["面壁计划", "罗辑", "宇宙社会学", "章北海", "执剑人", "二向箔"],
    fence: true,
    criteria: {
      position: "turn2 may use everything through #40 (审判日/古筝 included), volume II stays fenced",
    },
    rubric: [
      "The second answer is visibly fuller (volume I's full reveal) yet never crosses into volume II knowledge",
    ],
  }),
  bookQuestion({
    id: "fuzzy-the-cop",
    description: "模糊指代：『那个又粗又横、抽烟的警察』是谁。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "那个说话特别冲、老抽烟、看着粗鲁但特别靠谱的警察叫什么来着？他现在在干嘛？" }],
    mustContain: ["史强"],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fuzzy: "traits → 史强" },
    rubric: ["Resolves the description to 大史 by name and grounds him in the read chapters"],
  }),
  bookQuestion({
    id: "where-is-passage",
    description: "凭印象找原文：『科学家接连出事那段』在哪。",
    tags: ["retrieval", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "我想引用书里讲科学家们接连出事的那段话，帮我找到原文在哪一章？给我引两句。" }],
    mustContain: ["汪淼"],
    retrieval: true,
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { scene: "the scientist-deaths thread opens #4" },
    rubric: [
      "Locates the passage by chapter and quotes this edition's actual wording — never a paraphrase sold as a quote",
    ],
  }),
  bookQuestion({
    id: "cast-recital-vol1",
    description: "『读到现在都出场了谁』：卷I人物谱求助。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "读到现在主要人物都有谁？帮我列一下，一人一句话，我理一理。" }],
    coverage: { id: "answer.vol1-cast", words: ["汪淼", "叶文洁", "史强", "丁仪", "杨冬"], min: 3 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { cast: "read-side roster from the digests" },
    rubric: [
      "A clean roster of who the reader has actually met, one line each — no later-volume characters smuggled in",
    ],
  }),
  bookQuestion({
    id: "cosmic-flicker-explain",
    description: "概念理解：『宇宙闪烁』是什么现象、意味着什么。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "书里说的『宇宙闪烁』到底是什么现象？为什么大家那么害怕？" }],
    mustContain: ["闪烁"],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { fact: "宇宙闪烁 #9 首现" },
    rubric: [
      "Explains the phenomenon as the read chapters frame it and why it unnerves the characters, without the later mechanism",
    ],
  }),
  bookQuestion({
    id: "highlight-current-passage-pink",
    description: "标注辅助：把指定句划成粉色高亮——真书逐字保真。",
    tags: ["state", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: `把这句划成粉色高亮：「${santi.pickSentence(MID)}」` }],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
      interactions: { forbiddenKinds: ["permission"] },
    },
    observeState: ({ stores }) => ({
      highlights: stores.annotations
        .filter((annotation) => annotation.kind === "highlight")
        .map((annotation) =>
          annotation.kind === "highlight" ? { text: annotation.text, color: annotation.color } : { text: "", color: "" },
        ),
    }),
    criteria: { verbatim: "highlight text equals the quoted sentence, color pink" },
    extraEvaluate: (observation) => {
      const quoted = santi.pickSentence(MID);
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { highlights?: Array<{ text?: string; color?: string }> })
          : {};
      const highlights = Array.isArray(state.highlights) ? state.highlights : [];
      const matched = highlights.some((entry) => entry?.text === quoted && entry?.color === "pink");
      return assessmentFromChecks([
        {
          id: "state.highlight-verbatim-pink",
          category: "state",
          passed: matched,
          message: matched
            ? "the exact sentence was highlighted in pink"
            : "no verbatim pink highlight of the quoted sentence was recorded",
          expected: { text: quoted, color: "pink" },
          actual: highlights,
        },
      ]);
    },
  }),
  bookQuestion({
    id: "note-current-insight",
    description: "笔记辅助：把当前感想记成读书笔记。",
    tags: ["state", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "记条笔记：叶文洁在红岸的经历让她对人类彻底失望，这是她一切选择的前提。" }],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
    },
    observeState: ({ stores }) => ({
      notes: stores.annotations
        .filter((annotation) => annotation.kind === "note")
        .map((annotation) => (annotation.kind === "note" ? { body: annotation.body } : { body: "" })),
    }),
    criteria: { routing: "reader-visible note via create_annotation" },
    extraEvaluate: (observation) => {
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { notes?: Array<{ body?: string }> })
          : {};
      const notes = Array.isArray(state.notes) ? state.notes : [];
      const captured = notes.some(
        (note) => typeof note.body === "string" && /叶文洁/.test(note.body) && /红岸|失望/.test(note.body),
      );
      return assessmentFromChecks([
        {
          id: "state.note-captured",
          category: "state",
          passed: captured,
          message: captured ? "the reading note landed in the annotation list" : "no note carrying the insight was recorded",
          actual: notes.map((note) => note.body ?? ""),
        },
      ]);
    },
  }),
  bookQuestion({
    id: "reading-stats-query",
    description: "进度统计：这套书读了多久——工具面 + 人类单位。",
    tags: ["economy", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "《三体》这套书我到现在总共读了多久了？" }],
    extraSeed: {
      bookStats: [
        {
          bookId: santi.bookId,
          progressPercent: 10,
          status: "reading",
          totalMs: 8 * 60 * 60 * 1000,
          daily: { "2026-08-18": 3 * 60 * 60 * 1000, "2026-08-19": 5 * 60 * 60 * 1000 },
        },
      ],
    },
    expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
    mustContain: ["8"],
    criteria: { seeded: "8h total — humane units" },
    rubric: ["Reports about eight hours naturally, without inventing session details"],
  }),
  bookQuestion({
    id: "off-shelf-recommendation",
    description: "书架外推荐：喜欢这套书还想读什么——不摆幻灯卡片。",
    tags: ["honesty", "presentation", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "我很喜欢这套书的调子。还有什么类似的书值得读？直接推荐几本。" }],
    expectation: {
      tools: { forbidden: ["present_books"] },
      interactions: { forbiddenKinds: ["permission"] },
    },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { honesty: "shelf holds only this omnibus — suggestions are world knowledge, framed as such" },
    rubric: [
      "Recommends genuinely similar reads (hard SF at similar scale) framed as general suggestions, never as if from the reader's shelf",
    ],
  }),
  bookQuestion({
    id: "overwhelmed-hard-scifi-support",
    description: "情绪面：『物理不好读不下去』——陪伴式回应而非说教。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "说实话我物理早忘光了，读到这些设定有点吃力，是不是不适合读这套书？" }],
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { support: "companionship: reassure, offer a foothold in the already-read material, no lecture" },
    rubric: [
      "Takes the feeling seriously, points to what the story needs versus what can be skimmed (using the read chapters), and never spoils to prove the payoffs are coming",
    ],
  }),
  bookQuestion({
    id: "quote-who-said-early",
    description: "引文归属：拿已读章的句子问『这话谁说的』。",
    tags: ["retrieval", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [
      {
        text: `书里有这么一句："${santi.pickSentence(10)}" 这是哪一章、谁说的？当时什么场合？`,
      },
    ],
    retrieval: true,
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { quote: "chapter 10 (疯狂年代) — attribution must come from the retrieved text" },
    rubric: [
      "Names the chapter and the speaker from the actual passage context, not from general trilogy knowledge",
    ],
  }),
  bookQuestion({
    id: "current-chapter-recap",
    description: "『这章读到一半断了』：光标章（三体问题章）摘要。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "这章读到一半被打断了，帮我捋一下这章讲了什么？" }],
    expectation: { maxRounds: 4 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { chapter: `index ${MID} (三体问题)` },
    rubric: ["Recaps this chapter's content and stakes, oriented to where the reader is"],
  }),
  bookQuestion({
    id: "previous-chapter-recall",
    description: "『上一章讲了什么』——光标前一章回忆。",
    tags: ["digest", "santi", "book"],
    book: santi,
    cursorChapter: MID,
    turns: [{ text: "上一章讲什么来着？有点忘了。" }],
    expectation: { maxRounds: 4 },
    leakWords: CH20_LEAKS,
    fence: true,
    criteria: { chapter: `index ${MID - 1}` },
    rubric: ["Retells the previous chapter from its own content, briefly"],
  }),
];
