/**
 * 乌合之众真实读者问题集（工厂生产的长尾面）。
 *
 * 说明文没有围栏：概念理解可以自由前向检索。这里补真实读者在 68%
 * （第三卷之前）会问的：术语定义与辨析、译名词源（书内诚实）、历史
 * 例子复述、两处应用咨询、卷章结构、前后章摘要、关键论点提炼、
 * 引句定位、批判性讨论（时代局限）、模糊感受、同题两位置不变性、
 * 标注/统计/书架外推荐。术语全部实证于 digests 与正文。
 */
import { assessmentFromChecks } from "../../assertions";
import type { AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { bookQuestion } from "./question-factories";

const lebon = realBook("lebon");
const MID = 12;
const EARLY = 6;

export const lebonQuestionScenarios: AgentEvalScenario[] = [
  bookQuestion({
    id: "term-crowd-definition",
    description: "术语定义：勒庞的『群体』到底指什么，几个人算。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "勒庞说的『群体』到底是什么意思？随便几个人站在街上算吗？要多少人？" }],
    mustContain: ["群体"],
    noFence: true,
    criteria: { source: "卷一第一章（#5）心理群体 definition — digests" },
    rubric: [
      "Gives the book's own definition (a psychological crowd, not a physical gathering) and the conditions under which one forms",
    ],
  }),
  bookQuestion({
    id: "term-prestige-original-honest",
    description: "词源问题：『威望』的原文是什么——书内没标注时如实区分书内事实与书外知识。",
    tags: ["honesty", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "『威望』这个词原文是法语还是英语？书里有没有标原文？原文到底是什么词？" }],
    mustContain: ["威望"],
    noFence: true,
    criteria: {
      honesty: "fixture 全文无 prestige 标注（实证零命中）——正确答案：书里未标，词源属书外知识须声明",
    },
    rubric: [
      "Says plainly that this edition does not mark the original term, and may offer the French word (prestige) clearly as outside-the-book knowledge",
    ],
  }),
  bookQuestion({
    id: "psychological-vs-incidental-crowd",
    description: "概念辨析：心理群体和偶聚人群的区别。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "『心理群体』和一伙人刚好聚在一起，区别到底在哪？" }],
    mustContain: ["群体"],
    noFence: true,
    criteria: { source: "卷一第一章 distinction — digests" },
    rubric: [
      "Draws the line the book draws (mental unification, feeling/thinking alike) versus mere physical proximity",
    ],
  }),
  bookQuestion({
    id: "assertion-vs-reasoning",
    description: "概念辨析：对群体为什么断言胜过说理。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "为什么勒庞说对群体不要讲道理，断言和重复反而管用？他自己怎么论证的？" }],
    coverage: { id: "answer.assertion-case", words: ["断言", "重复", "传染", "理性"], min: 3 },
    noFence: true,
    criteria: { source: "卷二即时成因（#10）+ 领袖手段（#11）" },
    rubric: [
      "Explains the mechanism chain as argued (crowd cannot reason, assertion+repetition+contagion reach it) rather than asserting it as a slogan",
    ],
  }),
  bookQuestion({
    id: "contagion-mechanism",
    description: "术语理解：『传染』在书里是什么意思，和疾病什么关系。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "书里说的『传染』具体指什么？跟疾病传染是类比还是就是一回事？" }],
    mustContain: ["传染"],
    noFence: true,
    criteria: { fact: "传染 #5 首现（卷一情感章）" },
    rubric: [
      "Explains it as the book does — the spreading of feelings and actions through a crowd — and notes where the medical metaphor holds",
    ],
  }),
  bookQuestion({
    id: "leader-traits",
    description: "事实复述：勒庞眼里的领袖靠什么起作用。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "勒庞眼里的领袖人物靠什么支配群体？意志在他那儿重要吗？" }],
    coverage: { id: "answer.leader-traits", words: ["威望", "意志", "断言", "重复"], min: 2 },
    noFence: true,
    criteria: { source: "卷二领袖章（#11）— 威望/意志 verified" },
    rubric: [
      "Names the levers as the book states them (prestige, will, the means of persuasion) with their interplay",
    ],
  }),
  bookQuestion({
    id: "historical-examples-recital",
    description: "例证复述：书里举了什么历史例子。",
    tags: ["digest", "retrieval", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "勒庞在书里都举过哪些历史例子？挑一两个有代表性的讲讲他是怎么用的。" }],
    coverage: { id: "answer.historical-examples", words: ["拿破仑", "大革命", "法国"], min: 1 },
    retrieval: true,
    noFence: true,
    criteria: { facts: "拿破仑/大革命 #4-6 首现 — examples are read-side" },
    rubric: [
      "Retells one or two examples as the book deploys them (serving its argument), not as free-floating history trivia",
    ],
  }),
  bookQuestion({
    id: "apply-company-all-hands",
    description: "应用咨询：给全公司做宣讲，勒庞哪几条能用。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "我下周要给全公司八百人做产品宣讲。勒庞这本书里哪几条对我有用？怎么用？" }],
    coverage: { id: "answer.applied-means", words: ["断言", "重复", "形象", "威望"], min: 2 },
    noFence: true,
    criteria: { application: "means from #10-11 mapped onto a real all-hands talk" },
    rubric: [
      "Turns specific mechanisms into concrete moves for the talk (what to assert, what to repeat, what imagery to use) — and flags honestly what should NOT be imported",
    ],
  }),
  bookQuestion({
    id: "apply-marketing-copy",
    description: "应用咨询：写广告文案该用书里的什么手段。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "我在写一支产品的广告文案。按这本书的说法，文案应该怎么写才打动人？" }],
    coverage: { id: "answer.copy-mechanisms", words: ["断言", "重复", "形象", "传染"], min: 2 },
    noFence: true,
    criteria: { application: "means mapped onto ad copy" },
    rubric: [
      "Applies the actual mechanisms (assertion over argument, vivid images, repetition) to copywriting with one worked example line",
    ],
  }),
  bookQuestion({
    id: "volume-structure-overview",
    description: "结构总览：全书分几卷、各卷讲什么。",
    tags: ["toc", "digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "这本书整体结构是什么样的？分几卷？各卷都在讲什么？" }],
    coverage: { id: "answer.volume-structure", words: ["卷", "引言", "群体"], min: 2 },
    retrieval: true,
    noFence: true,
    criteria: { structure: "引言 + 三卷（#4-8 特征 / #9-12 意见 / #13-17 类别）— TOC facts" },
    rubric: [
      "Sketches the real three-volume arc (crowd traits → opinion mechanisms → crowd categories) in plain language",
    ],
  }),
  bookQuestion({
    id: "current-chapter-recap",
    description: "『这章讲什么』：光标章（可变范围章）摘要。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "我现在读的这章讲的是什么？标题没看懂，帮我捋一下。" }],
    retrieval: true,
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: `index ${MID} (群体的信仰和意见的可变范围)` },
    rubric: ["Explains what this chapter actually argues, with one or two of its own examples"],
  }),
  bookQuestion({
    id: "previous-chapter-recall",
    description: "『上一章讲什么』：领袖章的回忆。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "上一章讲什么来着？感觉跟这章连着，我想不起来上一章的要点了。" }],
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: `index ${MID - 1} (群体的领袖和他们的说服手段)` },
    rubric: ["Retells the leadership chapter's core and connects it forward to the current one"],
  }),
  bookQuestion({
    id: "forward-what-remains",
    description: "前向结构：后面几章还讲什么类别。",
    tags: ["toc", "forward", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "后面几章都讲什么？我读到现在，还剩哪些内容？" }],
    retrieval: true,
    forward: true,
    noFence: true,
    criteria: { forward: "卷三类别（犯罪群体/陪审员/选民/议会 #13-17）— zero ceremony" },
    rubric: [
      "Previews the remaining category chapters from the TOC/content, matter-of-factly — an expository book's future is content, not spoilers",
    ],
  }),
  bookQuestion({
    id: "key-takeaways-top3",
    description: "要点提炼：到目前为止最重要的三个论点。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "帮我提炼一下：读到现在，这本书最重要的三个论点是什么？每个一句话。" }],
    expectation: { tools: { maxCalls: 3 }, maxRounds: 4 },
    coverage: { id: "answer.takeaways", words: ["群体", "暗示", "传染", "威望", "断言", "理性"], min: 3 },
    noFence: true,
    criteria: { synthesis: "digest graph synthesis, no full-book re-read (maxCalls 3)" },
    rubric: [
      "Three genuinely load-bearing claims in the book's own terms, each one sentence — not a chapter list in disguise",
    ],
  }),
  bookQuestion({
    id: "quote-find-and-explain",
    description: "引句定位：拿实句问『哪章的、什么意思』。",
    tags: ["retrieval", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [
      {
        text: `书里有这么一句："${lebon.pickSentence(10)}" 这是哪一章的？这句话在书里是什么意思？`,
      },
    ],
    retrieval: true,
    noFence: true,
    criteria: { quote: "chapter 10 area — located and explained in context" },
    rubric: ["Names the chapter and explains the line within the book's argument, not as a standalone aphorism"],
  }),
  bookQuestion({
    id: "translator-voice",
    description: "辅文检索：译者序怎么评价这本书。",
    tags: ["retrieval", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "这版的译者怎么看这本书？译者序里说了什么？" }],
    retrieval: true,
    noFence: true,
    criteria: { source: "译者序 #1（辅文，可检索不注入纪要）" },
    rubric: [
      "Reports the translator's actual preface points (why another translation, how he frames the book) from the retrieved text",
    ],
  }),
  bookQuestion({
    id: "education-critique-recital",
    description: "事实复述：勒庞怎么看教育。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "书里是不是有一段说教育坑了年轻人？勒庞的原话是怎么说的？" }],
    mustContain: ["教育"],
    noFence: true,
    criteria: { fact: "教育 #5 首现（卷一）" },
    rubric: [
      "Retells his argument as written (what education produces in his view) with its own framing, marking it as his claim",
    ],
  }),
  bookQuestion({
    id: "era-limitations-honest",
    description: "批判讨论：书里哪些说法带着时代的局限。",
    tags: ["honesty", "digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "读到现在感觉有些说法挺冒犯的，比如谈种族那些。这些是不是他的时代局限？书里具体怎么说的？" }],
    coverage: { id: "answer.era-terms", words: ["种族", "遗传", "时代", "局限"], min: 2 },
    noFence: true,
    criteria: {
      honesty: "种族/遗传 #4 首现 — report what the book actually says, then mark it critically",
    },
    rubric: [
      "Reports the offending passages faithfully (what he actually claims about race/heredity) and frames them as their era's limitations without either endorsing or laundering them",
    ],
  }),
  bookQuestion({
    id: "vague-repetitive-feeling",
    description: "模糊感受：『后面几章是不是在重复』——结构梳理回应。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "怎么感觉卷二翻来覆去都在讲同一件事？是我理解错了还是他真的在重复？" }],
    noFence: true,
    criteria: { structure: "卷二三层的递进（成因/手段/范围）vs 表面相似" },
    rubric: [
      "Takes the feeling seriously and shows the actual progression across the volume-2 chapters (remote causes → immediate means → scope) — the repetition is structure, and the answer shows it",
    ],
  }),
  bookQuestion({
    id: "prestige-two-positions-invariance",
    description: "同题两位置不变性：早期(25%)问威望分类须前向检索，后期直接答——两处答案一致。",
    tags: ["forward", "digest", "multi-turn", "lebon", "book"],
    book: lebon,
    cursorChapter: EARLY,
    turns: [
      { text: "『威望』在书里分几类？我现在读到卷一。", cursorChapter: EARLY },
      { text: "现在读到卷二了，再回答我一遍：威望分几类？", cursorChapter: MID },
    ],
    mustContain: ["威望"],
    forward: true,
    noFence: true,
    criteria: {
      invariance: "威望分类在 #11（#6 之后）—— turn1 的正确路径是前向检索；两轮答案的实质内容一致",
    },
    rubric: [
      "Both turns give the same substantive taxonomy (the edition's own categories); the first earns it by looking ahead without ceremony",
    ],
  }),
  bookQuestion({
    id: "belief-religious-form",
    description: "事实复述：信念的宗教形式章讲了什么。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "卷一最后说信念有『宗教形式』是什么意思？宗教在这儿是个比喻吗？" }],
    mustContain: ["宗教"],
    noFence: true,
    criteria: { chapter: "index 8 (群体信念的宗教形式) — read side" },
    rubric: [
      "Explains the claim as the chapter makes it (how crowd belief takes religious shape) and whether it is metaphor",
    ],
  }),
  bookQuestion({
    id: "immediate-vs-remote-causes",
    description: "结构理解：卷二的『遥远成因』与『即时成因』怎么分。",
    tags: ["digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "卷二开头分『遥远成因』和『即时成因』，这两个到底怎么区分？各举一例。" }],
    coverage: { id: "answer.causes-split", words: ["遥远", "即时", "成因"], min: 2 },
    noFence: true,
    criteria: { structure: "卷二第一二章（#9-10）" },
    rubric: ["Draws the distinction as drawn (slow soil vs immediate triggers) with one example each from the chapters"],
  }),
  bookQuestion({
    id: "criminal-crowd-recap",
    description: "前向主题：『所谓的犯罪群体』章讲了什么（已过 #14？——不，在后面，走前向）。",
    tags: ["forward", "digest", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "后面有一章叫『所谓的犯罪群体』吧？那章讲什么？勒庞认为群体犯罪是怎么回事？" }],
    retrieval: true,
    forward: true,
    noFence: true,
    criteria: { forward: "chapter 14 (所谓的犯罪群体) — beyond cursor, expository free access" },
    rubric: ["Summarizes that chapter's actual argument from its text, zero spoiler ceremony"],
  }),
  bookQuestion({
    id: "highlight-current-passage-blue",
    description: "标注辅助：把指定句划成蓝色高亮。",
    tags: ["state", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: `把这句划成蓝色高亮：「${lebon.pickSentence(MID)}」` }],
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
    criteria: { verbatim: "highlight text equals the quoted sentence, color blue" },
    extraEvaluate: (observation) => {
      const quoted = lebon.pickSentence(MID);
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { highlights?: Array<{ text?: string; color?: string }> })
          : {};
      const highlights = Array.isArray(state.highlights) ? state.highlights : [];
      const matched = highlights.some((entry) => entry?.text === quoted && entry?.color === "blue");
      return assessmentFromChecks([
        {
          id: "state.highlight-verbatim-blue",
          category: "state",
          passed: matched,
          message: matched ? "the exact sentence was highlighted in blue" : "no verbatim blue highlight was recorded",
          expected: { text: quoted, color: "blue" },
          actual: highlights,
        },
      ]);
    },
  }),
  bookQuestion({
    id: "note-takeaway-current",
    description: "笔记辅助：把威望要点记成读书笔记。",
    tags: ["state", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "记条笔记：威望分被赋予的和个人的两类，被赋予的来自头衔财富，个人的来自本人。" }],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
    },
    observeState: ({ stores }) => ({
      notes: stores.annotations
        .filter((annotation) => annotation.kind === "note")
        .map((annotation) => (annotation.kind === "note" ? { body: annotation.body } : { body: "" })),
    }),
    criteria: { routing: "reader-visible note" },
    extraEvaluate: (observation) => {
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { notes?: Array<{ body?: string }> })
          : {};
      const notes = Array.isArray(state.notes) ? state.notes : [];
      const captured = notes.some(
        (note) => typeof note.body === "string" && /威望/.test(note.body) && /赋予|个人/.test(note.body),
      );
      return assessmentFromChecks([
        {
          id: "state.note-captured",
          category: "state",
          passed: captured,
          message: captured ? "the note landed in the annotation list" : "no note was recorded",
          actual: notes.map((note) => note.body ?? ""),
        },
      ]);
    },
  }),
  bookQuestion({
    id: "reading-stats-query",
    description: "进度统计：这本书读了多久。",
    tags: ["economy", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "这本《乌合之众》我读了多久了？" }],
    extraSeed: {
      bookStats: [
        {
          bookId: lebon.bookId,
          progressPercent: 68,
          status: "reading",
          totalMs: 3.5 * 60 * 60 * 1000,
          daily: { "2026-08-19": 3.5 * 60 * 60 * 1000 },
        },
      ],
    },
    expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
    mustContain: ["3"],
    criteria: { seeded: "3.5h total" },
    rubric: ["Reports about three and a half hours naturally"],
  }),
  bookQuestion({
    id: "off-shelf-recommendation",
    description: "书架外推荐：同类还有什么值得读。",
    tags: ["honesty", "presentation", "lebon", "book"],
    book: lebon,
    cursorChapter: MID,
    turns: [{ text: "读完这本想接着读群体心理方面的书，有什么推荐？" }],
    expectation: {
      tools: { forbidden: ["present_books"] },
      interactions: { forbiddenKinds: ["permission"] },
    },
    noFence: true,
    criteria: { honesty: "framed as general suggestions, not shelf data" },
    rubric: ["Recommends genuinely adjacent reads (Le Bon's contemporaries and critics) framed as outside-the-shelf knowledge"],
  }),
];
