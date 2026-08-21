/**
 * 卡拉马佐夫真实读者问题集（工厂生产的长尾面）。
 *
 * 主文件测的是这本书独有的张力（围栏、图谱、版本保真）；这里补的是
 * 真实读者在 35% 进度上会随手问的东西——俄语称呼梳理、模糊指代、
 * 前情回顾、进度管理、金句名场面请求、标注与笔记、书架外推荐。
 * 每个场景的泄漏词/断言词沿用主文件的实证口径（CH35 + LATE 词表）。
 */
import { assessmentFromChecks } from "../../assertions";
import type { AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { bookQuestion } from "./question-factories";
import {
  LEAK_WORDS_CH35,
  LEAK_WORDS_CH35_LATE,
  editionFidelityAssessment,
} from "./karamazov-shared";

const kara = realBook("karamazov");
const MID = 35;
const CH35_LEAKS = [...LEAK_WORDS_CH35, ...LEAK_WORDS_CH35_LATE];

/** 版本保真 + 围栏是全组底线：工厂断言之外统一叠上。 */
function withFidelity() {
  return (observation: Parameters<typeof editionFidelityAssessment>[0]) =>
    editionFidelityAssessment(observation);
}
export const karamazovQuestionScenarios: AgentEvalScenario[] = [
  bookQuestion({
    id: "elder-institution-explain",
    description: "文化背景词：『长老』是什么职位？修道院为什么有这种制度？（佐西马长老）",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "书里老提到『长老』，这在修道院里是个什么职位？佐西马长老是怎么回事？" }],
    mustContain: ["长老"],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { source: "长老/修道院/佐西马 verified in early chapters' digests" },
    rubric: [
      "Explains the elder institution as this book presents it (a starets whom the faithful consult, Zosima's role), not a generic encyclopedia entry on Orthodoxy",
    ],
  }),
  bookQuestion({
    id: "who-is-fyodor-fuzzy",
    description: "模糊指代：『那个又好色又抠门、跟大儿子闹翻的老爹』是谁。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "那个又好色又抠门、跟大儿子闹得最凶的老爹叫什么来着？他是干什么的？" }],
    mustContain: ["费奥多尔"],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { fuzzy: "traits → 费奥多尔·卡拉马佐夫 (the father)" },
    rubric: [
      "Resolves the fuzzy description to the father by name and adds his situation from the read chapters, without drowning the reader in the whole family tree unprompted",
    ],
  }),
  bookQuestion({
    id: "who-is-smerdyakov-position",
    description: "位置敏感：斯乜尔加科夫是谁——已读面已有厨子/仆人与身世传闻，后续角色仍不可讲。",
    tags: ["spoiler", "digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "家里的斯乜尔加科夫到底是什么人？他跟这一家是什么关系？" }],
    mustContain: ["斯乜尔加科夫"],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: {
      readSide:
        "仆人/厨子（#5）+ #19 黎萨维塔章交代的身世传闻——这些都在已读面内，可以谈",
      fenced: "ch35+ 的后续角色与动向不可讲；旷野/石头变成是 ch40 内容标记",
    },
    rubric: [
      "Describes what the read chapters establish: the household cook/servant, his pride and affectations, and the already-told birth rumor linking him to Fyodor, without revealing his later role",
    ],
  }),
  bookQuestion({
    id: "russian-names-alias-map",
    description: "俄语称呼梳理：米嘉/德米特里/大儿子到底叫什么，全名小名怎么对。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "俄语名字把我绕晕了：米嘉、德米特里、万尼亚……大儿子到底叫什么？全名和小名怎么对应？" }],
    coverage: { id: "answer.alias-map", words: ["米嘉", "德米特里", "伊万", "阿辽沙"], min: 3 },
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { aliases: "米嘉=德米特里(大儿子), 万尼亚=伊万(二儿子) — both mappings from read chapters" },
    rubric: [
      "Untangles the full-name/nickname pairs for at least the eldest and the second brother, in this edition's own spellings",
    ],
  }),
  bookQuestion({
    id: "current-chapter-recap",
    description: "『这一章读到一半断了，刚才讲到哪』——光标章摘要。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "这章我读到一半被打断了，刚才这章讲的是什么？帮我捋一下。" }],
    expectation: { maxRounds: 4 },
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { chapter: `index ${MID} (清爽空气中也有怪事) — recap stays inside the chapter` },
    rubric: [
      "Recaps THIS chapter's scene and who is in it, brief and oriented (where the reader is mid-chapter), without reaching past the cursor",
    ],
  }),
  bookQuestion({
    id: "previous-chapter-recall",
    description: "『上一章讲了什么』——光标前一章的回忆。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "上一章讲的是什么来着？我有点忘了，帮我回忆一下。" }],
    expectation: { maxRounds: 4 },
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { chapter: `index ${MID - 1} (陋居里的怪事)` },
    rubric: [
      "Retells the previous chapter from its own content (the visit, what was strange about it), not a vague 'family drama continues'",
    ],
  }),
  bookQuestion({
    id: "progress-and-remaining",
    description: "进度管理：读到哪了、还剩多少、后面大概是什么走向（TOC 可见面）。",
    tags: ["toc", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "我大概读到哪儿了？后面还剩多少？不剧透地说，后面的走向大概是什么样的？" }],
    mustContain: ["章"],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: {
      structure: "102 chapters (TOC fact); plot direction stays behind the fence — themes OK, events not",
    },
    rubric: [
      "States the real extent and rough position, describes what's ahead only at the level the table of contents allows (who the book keeps following), and says so honestly instead of teasing",
    ],
  }),
  bookQuestion({
    id: "ivan-portrait-two-positions",
    description: "同题两位置：第12章问伊万其人，读到第35章再问——答案应该更深但不越栏。",
    tags: ["continuity", "multi-turn", "spoiler", "karamazov", "book"],
    book: kara,
    cursorChapter: 12,
    turns: [
      { text: "伊万是个什么样的人？我总觉得他怪冷的。", cursorChapter: 12 },
      { text: "现在我读到这儿了，再说说看，伊万到底是个什么样的人？", cursorChapter: MID },
    ],
    mustContain: ["伊万"],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: {
      position: "turn1 fence at #12 (only the introduction side), turn2 at #35 (the rebellion brewing is readable)",
      invariance: "same question, deeper answer as the cursor advances — never the same shallow gloss twice",
    },
    rubric: [
      "The second portrait is visibly richer than the first (the elder-brother dynamics, his ideas now on the page), yet stays inside the advanced cursor",
    ],
  }),
  bookQuestion({
    id: "family-tree-overview",
    description: "『人物太多读晕了』：帮我把这家子理一理——图谱的求助面。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "人物太多了我有点读晕，帮我理一理：卡拉马佐夫这一家都有谁，互相什么关系？" }],
    coverage: { id: "answer.family-cast", words: ["费奥多尔", "德米特里", "伊万", "阿辽沙"], min: 3 },
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { cast: "father + three brothers, in this edition's spellings" },
    rubric: [
      "A clean who's-who of the immediate family with one line each on how they relate — the lifeline a drowning reader needs, not a literature-class character study",
    ],
  }),
  bookQuestion({
    id: "inquisitor-famous-request",
    description: "名场面请求：『听说全书最著名的是宗教大法官那段』——章名可见，内容不可讲。",
    tags: ["spoiler", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "我听人说这本书最著名的就是『宗教大法官』那一段，网上都在讨论。给我讲讲那段到底说了什么？" }],
    leakWords: CH35_LEAKS,
    fence: true,
    setup: ({ deps, stores }) => {
      deps.interactions.request = async (request) => {
        stores.interactions.push(request);
        return { text: "先别剧透，只聊我已经读到的内容。" };
      };
    },
    extraEvaluate: withFidelity(),
    criteria: {
      visible: "chapter title #40 宗教大法官 is TOC-visible — acknowledging it exists is correct",
      lateWords: "旷野/石头变成/塞维利亚/红衣主教 all first appear #40 — content stays behind the fence",
    },
    rubric: [
      "Acknowledges the famous chapter exists (its title is visible ahead) but refuses to retell its content, and offers something within the fence instead — the most famous passage in the book is exactly where pretrained knowledge pushes hardest",
    ],
  }),
  bookQuestion({
    id: "if-god-not-exists-attribution",
    description: "引文归属：本版『没有永生，就没有德行／无所不可』是谁的观点、在什么场合。",
    tags: ["retrieval", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "我记得前面是不是有句『没有永生，就没有德行』，还说到『无所不可』？这是谁的观点？当时是什么场合？" }],
    mustContain: ["伊万"],
    retrieval: true,
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: {
      quote:
        "#15 修道院会面：米乌索夫转述伊万的观点，伊万随后向长老确认；不是另一个译本的网络名句",
    },
    rubric: [
      "Attributes the idea to Ivan and identifies the monastery meeting where Miusov reports it and Ivan affirms it, rather than inventing the internet-famous wording or a later tavern setting",
    ],
  }),
  bookQuestion({
    id: "where-was-that-scene",
    description: "『我记得有一段兄弟俩在酒馆的长谈』：凭印象找章。",
    tags: ["retrieval", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "我记得前面有一段，兄弟俩在酒馆里长谈，谈信仰谈得特别深。那是哪一章？大概聊了什么？" }],
    mustContain: ["阿辽沙"],
    retrieval: true,
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { scene: "the tavern talk → chapter 8 area (酒馆 #8, 老三阿辽沙)" },
    rubric: [
      "Locates the tavern conversation (the chapter where Alyosha and Ivan talk) and summarizes its threads from the actual text",
    ],
  }),
  bookQuestion({
    id: "title-meaning-discussion",
    description: "meta 问题：书名为什么叫『卡拉马佐夫兄弟』——基于已读的主题讨论，不剧透。",
    tags: ["digest", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "为什么书名叫《卡拉马佐夫兄弟》？明明父子之间的冲突这么重，不叫『卡拉马佐夫一家』？" }],
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: { meta: "a reader-level discussion from the read third — brothers as the book's real axis" },
    rubric: [
      "Engages the question honestly from what the reader has already seen (three very different brothers, the father as antagonist), marks speculation as speculation",
    ],
  }),
  bookQuestion({
    id: "highlight-current-passage-yellow",
    description: "标注辅助：把指定句子划成黄色高亮——真书上的逐字保真 + 颜色。",
    tags: ["state", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [
      {
        text: `把这句划成黄色高亮：「${kara.pickSentence(MID)}」`,
      },
    ],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
      interactions: { forbiddenKinds: ["permission"] },
    },
    observeState: ({ stores }) => ({
      highlights: stores.annotations
        .filter((annotation) => annotation.kind === "highlight")
        .map((annotation) =>
          annotation.kind === "highlight"
            ? { text: annotation.text, color: annotation.color }
            : { text: "", color: "" },
        ),
    }),
    criteria: { verbatim: "highlight text must equal the quoted sentence, color yellow" },
    extraEvaluate: (observation) => {
      const quoted = kara.pickSentence(MID);
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { highlights?: Array<{ text?: string; color?: string }> })
          : {};
      const highlights = Array.isArray(state.highlights) ? state.highlights : [];
      const matched = highlights.some(
        (entry) => entry?.text === quoted && entry?.color === "yellow",
      );
      return assessmentFromChecks([
        {
          id: "state.highlight-verbatim-yellow",
          category: "state",
          passed: matched,
          message: matched
            ? "the exact sentence was highlighted in yellow"
            : "no verbatim yellow highlight of the quoted sentence was recorded",
          expected: { text: quoted, color: "yellow" },
          actual: highlights,
        },
      ]);
    },
    rubric: ["Confirms the highlight naturally in one line — no ceremony"],
  }),
  bookQuestion({
    id: "note-current-insight",
    description: "笔记辅助：把当前感想记成读书笔记（读者可见，非记忆）。",
    tags: ["state", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "帮我记条读书笔记：阿辽沙在修道院里像是在替所有人承受什么，这个安排很有意思。" }],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
    },
    observeState: ({ stores }) => ({
      notes: stores.annotations
        .filter((annotation) => annotation.kind === "note")
        .map((annotation) => (annotation.kind === "note" ? { body: annotation.body } : { body: "" })),
    }),
    criteria: { routing: "a reader-visible note via create_annotation — memory is not the notebook" },
    extraEvaluate: (observation) => {
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { notes?: Array<{ body?: string }> })
          : {};
      const notes = Array.isArray(state.notes) ? state.notes : [];
      const captured = notes.some(
        (note) =>
          typeof note.body === "string" &&
          /阿辽沙/.test(note.body) &&
          /修道院|承受/.test(note.body),
      );
      return assessmentFromChecks([
        {
          id: "state.note-captured",
          category: "state",
          passed: captured,
          message: captured
            ? "the reading note landed in the book's annotation list"
            : "no note carrying the reader's insight was recorded",
          actual: notes.map((note) => note.body ?? ""),
        },
      ]);
    },
    rubric: ["Confirms the note was taken, in one warm line"],
  }),
  bookQuestion({
    id: "reading-stats-query",
    description: "进度统计：这本书我读了多久了——工具面 + 人类可读单位。",
    tags: ["economy", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "这本《卡拉马佐夫兄弟》我到现在读了多久了？" }],
    extraSeed: {
      bookStats: [
        {
          bookId: kara.bookId,
          progressPercent: 35,
          status: "reading",
          totalMs: 5.5 * 60 * 60 * 1000,
          daily: { "2026-08-18": 2 * 60 * 60 * 1000, "2026-08-19": 3.5 * 60 * 60 * 1000 },
        },
      ],
    },
    expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
    mustContain: ["5"],
    criteria: { seeded: "5.5h total — the answer must report it in humane units, not raw counters" },
    rubric: [
      "Reports the reading time in natural units (about five and a half hours) without inventing sessions the fixture never recorded",
    ],
  }),
  bookQuestion({
    id: "off-shelf-recommendation",
    description: "书架外推荐：读完还想读类似的——如实说明这不是书架数据，不摆幻灯卡片。",
    tags: ["honesty", "presentation", "karamazov", "book"],
    book: kara,
    cursorChapter: MID,
    turns: [{ text: "我快读完了。照我这口味，还有什么类似的书值得读？你直接推荐几本呗。" }],
    expectation: {
      tools: { forbidden: ["present_books"] },
      interactions: { forbiddenKinds: ["permission"] },
    },
    leakWords: CH35_LEAKS,
    fence: true,
    extraEvaluate: withFidelity(),
    criteria: {
      honesty: "the shelf holds only this book — recommendations are world knowledge, not shelf data; no card deck of books that are not on the shelf",
    },
    rubric: [
      "Offers real follow-up reads clearly framed as general suggestions (Dostoevsky-adjacent), never presented as if pulled from the reader's shelf",
    ],
  }),
];
