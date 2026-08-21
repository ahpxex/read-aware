/**
 * Refactoring 真实读者问题集（工厂生产的长尾面）。
 *
 * 技术书的长尾：术语定义与英文拼写（中文问英文书的双向纪律）、更多
 * 手法目录定位、坏味道逐个解释、症状→诊断咨询（多轮）、测试与重构的
 * 关系、小步哲学、开篇例子、结构总览、前后章摘要、要点提炼、引句定位、
 * 使用指导（23 节读不完）、标注/统计/书架外推荐。术语实证于 fixture。
 */
import { assessmentFromChecks } from "../../assertions";
import type { AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { bookQuestion } from "./question-factories";

const fowler = realBook("refactoring");
const MID = 15;

export const refactoringQuestionScenarios: AgentEvalScenario[] = [
  bookQuestion({
    id: "refactoring-definition",
    description: "术语定义：重构到底是什么、和重写什么区别。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "『重构』的准确定义是什么？跟重写代码有什么本质区别？" }],
    coverage: { id: "answer.refactoring-definition", words: ["行为", "structure", "重构", "Refactoring"], min: 2 },
    noFence: true,
    criteria: { definition: "behavior-preserving structure change — book's own framing" },
    rubric: [
      "States the book's definition (changing structure without changing behavior) and the rewrite contrast as it draws them",
    ],
  }),
  bookQuestion({
    id: "smell-terms-english",
    description: "双语反向：中文问『坏味道』们用英文怎么说、分别什么意思。",
    tags: ["language", "digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "『坏味道』书里的这些名字用英文都怎么写？帮我列几个主要的，中文意思各是什么。" }],
    coverage: { id: "answer.smells-bilingual", words: ["Duplicated Code", "Long Function", "Feature Envy", "Shotgun Surgery", "Mysterious Name"], min: 3 },
    noFence: true,
    criteria: { bilingual: "English names preserved with Chinese glosses — chapter 9 vocabulary" },
    rubric: [
      "Lists several smells under the book's English names with one-line Chinese glosses, not translated-away names",
    ],
  }),
  bookQuestion({
    id: "catalog-split-variable",
    description: "手法目录定位：Split Variable 在哪讲、什么时候用。",
    tags: ["retrieval", "toc", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "Split Variable 这个手法书里在哪章讲的？什么情况下该用它？" }],
    mustContain: ["Split Variable"],
    retrieval: true,
    noFence: true,
    criteria: { catalog: "Split Variable #9 首现 — locate by the book's own numbering" },
    rubric: ["Names where the book covers it and the situation it addresses (a variable reused for two meanings)"],
  }),
  bookQuestion({
    id: "catalog-parameter-object",
    description: "手法目录定位：Introduce Parameter Object 在哪讲、怎么用。",
    tags: ["retrieval", "toc", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "Introduce Parameter Object 是干什么的？书里哪里讲了它？" }],
    mustContain: ["Introduce Parameter Object"],
    retrieval: true,
    noFence: true,
    criteria: { catalog: "#9 首现 — grouping clumped parameters" },
    rubric: ["Explains the refactoring and where the book presents it, in its own terms"],
  }),
  bookQuestion({
    id: "smell-feature-envy-explain",
    description: "坏味道解释：Feature Envy 是什么意思。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "Feature Envy 这个坏味道是什么意思？怎么判断我的函数有没有犯它？" }],
    mustContain: ["Feature Envy"],
    noFence: true,
    criteria: { smell: "chapter 9 vocabulary — the function more interested in another class's data" },
    rubric: ["Explains the smell and the tell-tale sign, with a one-line example"],
  }),
  bookQuestion({
    id: "smell-shotgun-surgery-explain",
    description: "坏味道解释：Shotgun Surgery 为什么叫这个名字。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "Shotgun Surgery 为什么起这么个名字？它和 Duplicated Code 是不是反着的？" }],
    mustContain: ["Shotgun Surgery"],
    noFence: true,
    criteria: { smell: "chapter 9 — one change scattered across many places, vs duplication's many-in-one" },
    rubric: ["Explains the metaphor and the inversion the book itself draws between the two smells"],
  }),
  bookQuestion({
    id: "consult-duplicated-code",
    description: "代码咨询：三个模块各有一份几乎一样的分页逻辑。",
    tags: ["digest", "retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "我们代码里三个模块各有一份几乎一样的分页逻辑，每次改需求要改三处。按这本书该怎么处理？" }],
    coverage: { id: "answer.consult-duplication", words: ["Duplicated Code", "Extract Function", "Pull Up Method"], min: 2 },
    noFence: true,
    criteria: { diagnosis: "Duplicated Code (#9) → the book's own consolidation moves" },
    rubric: [
      "Names the smell by the book's name and prescribes the consolidation path (extract, then pull up) with the testing caution the book attaches to it",
    ],
  }),
  bookQuestion({
    id: "legacy-code-without-tests",
    description: "实践问题：没有测试的老代码怎么开始重构。",
    tags: ["retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "我们那个老模块一行测试都没有，书里的手法是不是都用不上？Fowler 自己怎么说这种情况？" }],
    mustContain: ["test"],
    retrieval: true,
    noFence: true,
    criteria: { source: "Building Tests 章（#10）+ 开篇对测试的定位（#7-8）" },
    rubric: [
      "Reports the book's actual position (tests enable refactoring; how to start when there are none) from the retrieved text",
    ],
  }),
  bookQuestion({
    id: "small-steps-philosophy",
    description: "方法论：为什么全书强调小步。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "为什么这本书翻来覆去强调小步重构？一步到位改完为什么不行？" }],
    coverage: {
      id: "answer.small-steps",
      words: ["small step", "小步", "test", "测试", "behavior", "行为"],
      min: 2,
    },
    noFence: true,
    criteria: { philosophy: "small step #7 首现 — verifiable after every step" },
    rubric: ["Explains the payoff (each step stays verifiable, mistakes stay cheap) as the book argues it"],
  }),
  bookQuestion({
    id: "comments-opinion",
    description: "观点检索：Fowler 对写注释怎么看。",
    tags: ["retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "Fowler 这本书里对写代码注释是什么态度？有没有说过什么时候该写注释？" }],
    coverage: { id: "answer.comments", words: ["comment", "注释"], min: 1 },
    retrieval: true,
    noFence: true,
    criteria: { source: "comment #6 首现（坏味道章附近）" },
    rubric: ["Reports his actual stance from the retrieved text (when comments pay, when they mask bad names)"],
  }),
  bookQuestion({
    id: "first-example-video-store",
    description: "例证复述：开篇那个贯穿例子是什么。",
    tags: ["retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "这本书开篇一直用的那个贯穿示例程序是什么？讲的是什么业务？" }],
    // 第二版的贯穿例子是剧团账单（theater/plays/invoices）——video store
    // 是第一版，实证：正文 tragedy/comedy/performance 于开篇即现。
    coverage: { id: "answer.first-example", words: ["theater", "剧团", "剧院", "剧目", "play", "performance", "演出", "账单", "statement"], min: 2 },
    retrieval: true,
    noFence: true,
    criteria: { example: "video #7 首现 — the video store example" },
    rubric: ["Names the example program and its domain from the actual opening chapters"],
  }),
  bookQuestion({
    id: "whole-structure",
    description: "结构总览：23 节是怎么编排的。",
    tags: ["toc", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "这本书 23 节是怎么编排的？前面理论后面目录吗？帮我理一下结构。" }],
    retrieval: true,
    noFence: true,
    criteria: { structure: "开篇/测试/坏味道/目录/各主题章 — TOC facts" },
    rubric: ["Sketches the real arc (example-driven opening → tests → smells → catalog → topics) in plain words"],
  }),
  bookQuestion({
    id: "current-chapter-recap",
    description: "『这章讲什么』：光标章（Organizing Data）摘要。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "我正在读的这章（Organizing Data）讲的是什么？帮我捋一下要点。" }],
    retrieval: true,
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: `index ${MID} (Chapter 9 Organizing Data)` },
    rubric: ["Summarizes the chapter's theme (data-shaped refactorings) with two of its moves"],
  }),
  bookQuestion({
    id: "encapsulation-chapter-recap",
    description: "前章回忆：Encapsulation 章讲了什么。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "上一部分讲的封装（Encapsulation）那章，核心是什么来着？" }],
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: "index 13 (Chapter 7 Encapsulation)" },
    rubric: ["Retells the encapsulation chapter's core idea with one of its refactorings"],
  }),
  bookQuestion({
    id: "quote-find-and-explain",
    description: "引句定位：拿实句问哪章的、什么意思。",
    tags: ["retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [
      {
        text: `书里有这么一句："${fowler.pickSentence(9)}" 这是哪章的？这句话怎么理解？`,
      },
    ],
    retrieval: true,
    noFence: true,
    criteria: { quote: "chapter 9 area — located and explained in the book's context" },
    rubric: ["Names the chapter and reads the line within the book's argument"],
  }),
  bookQuestion({
    id: "when-not-refactor-cn",
    description: "方法论：中文问什么时候不该重构。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "有没有什么时候反而是不该重构的？Fowler 划的线在哪？" }],
    mustContain: ["重构"],
    noFence: true,
    criteria: { philosophy: "the when-not line from the opening chapters" },
    rubric: ["States the book's own boundaries (code that works and won't change again, rewrite economics) rather than generic caution"],
  }),
  bookQuestion({
    id: "how-to-use-this-book",
    description: "使用指导：23 节读不完，该怎么用这本书。",
    tags: ["toc", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "说实话 23 节我读不完。这本书当工具书查着用行吗？有没有建议的用法？" }],
    retrieval: true,
    noFence: true,
    criteria: { guidance: "catalog-as-reference is the book's own intent (Introducing the Catalog)" },
    rubric: [
      "Gives a real usage path (read the opening + smells, keep the catalog for lookup) grounded in the book's own structure, not a lecture about finishing books",
    ],
  }),
  bookQuestion({
    id: "code-consult-three-turns",
    description: "三轮代码咨询：症状 → 手法 → 风险与测试。",
    tags: ["continuity", "multi-turn", "retrieval", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [
      { text: "我们有个 400 行的订单校验函数，十几个 if 分支，怎么下手？" },
      { text: "用 Extract Function 拆的话，中间状态怎么办？没法一口气拆完。" },
      { text: "拆的过程中怎么保证没改坏行为？项目测试覆盖率一般。" },
    ],
    coverage: { id: "answer.consult-thread", words: ["Extract Function", "small", "小步", "test", "测试"], min: 2 },
    noFence: true,
    criteria: { drill: "turn3 must bring the book's testing discipline to bear on the stated weak coverage" },
    rubric: [
      "Each turn builds on the last; the final answer weaves the book's small-steps + tests position into the reader's real constraint",
    ],
  }),
  bookQuestion({
    id: "key-takeaways-top3",
    description: "要点提炼：到此最重要的三个收获。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "帮我提炼：读到现在，这本书最核心的三个思想是什么？" }],
    expectation: { tools: { maxCalls: 3 }, maxRounds: 4 },
    // 中文提问→中文回答：词表双语（英文术语或中文说法都算命中）
    coverage: { id: "answer.takeaways", words: ["behavior", "行为", "small", "小步", "smell", "坏味道", "test", "测试", "structure", "结构"], min: 3 },
    noFence: true,
    criteria: { synthesis: "digest-based" },
    rubric: ["Three load-bearing ideas, each one sentence, in the book's own terms"],
  }),
  bookQuestion({
    id: "long-function-cn-to-en",
    description: "双语正向：中文说『长函数』，书里英文叫什么。",
    tags: ["language", "digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "中文圈说的『长函数』，这本书里对应的英文坏味道名是什么？" }],
    mustContain: ["Long Function"],
    noFence: true,
    criteria: { bilingual: "Long Function — the book's own name" },
    rubric: ["Gives the English smell name exactly as the book spells it"],
  }),
  bookQuestion({
    id: "catalog-vs-smells-relationship",
    description: "跨章综合：坏味道章和手法目录怎么配合用。",
    tags: ["digest", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "坏味道那章和后面的手法目录是什么关系？是先查味道再查手法吗？" }],
    coverage: { id: "answer.smells-catalog-flow", words: ["smell", "坏味道", "catalog", "目录", "refactoring", "重构手法", "手法"], min: 2 },
    noFence: true,
    criteria: { synthesis: "smell → refactoring mapping is the book's intended workflow" },
    rubric: ["Explains the intended workflow (smells point at refactorings) as the book itself frames it"],
  }),
  bookQuestion({
    id: "highlight-current-passage-blue",
    description: "标注辅助：把指定句划成蓝色高亮（英文引句逐字）。",
    tags: ["state", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: `把这句划成蓝色高亮："${fowler.pickSentence(MID)}"` }],
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
    criteria: { verbatim: "highlight text equals the quoted English sentence, color blue" },
    extraEvaluate: (observation) => {
      const quoted = fowler.pickSentence(MID);
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
    description: "笔记辅助：把重构定义记成中文笔记（英文术语保留）。",
    tags: ["state", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "记条笔记：重构 = 在不改行为的前提下调整结构，每一步都要小到能验证。Extract Function 是最常用的起点。" }],
    expectation: {
      tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true, maxCalls: 2 },
    },
    observeState: ({ stores }) => ({
      notes: stores.annotations
        .filter((annotation) => annotation.kind === "note")
        .map((annotation) => (annotation.kind === "note" ? { body: annotation.body } : { body: "" })),
    }),
    criteria: { routing: "reader-visible note, English terms intact" },
    extraEvaluate: (observation) => {
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { notes?: Array<{ body?: string }> })
          : {};
      const notes = Array.isArray(state.notes) ? state.notes : [];
      const captured = notes.some(
        (note) =>
          typeof note.body === "string" &&
          /行为/.test(note.body) &&
          /结构/.test(note.body) &&
          note.body.includes("Extract Function"),
      );
      return assessmentFromChecks([
        {
          id: "state.note-captured",
          category: "state",
          passed: captured,
          message: captured ? "the note landed with English terms intact" : "no matching note was recorded",
          actual: notes.map((note) => note.body ?? ""),
        },
      ]);
    },
  }),
  bookQuestion({
    id: "reading-stats-query",
    description: "进度统计：这本书读了多久（中文问英文书）。",
    tags: ["economy", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "这本 Refactoring 我读了多久了？" }],
    extraSeed: {
      bookStats: [
        {
          bookId: fowler.bookId,
          progressPercent: 60,
          status: "reading",
          totalMs: 12 * 60 * 60 * 1000,
          daily: { "2026-08-17": 5 * 60 * 60 * 1000, "2026-08-18": 4 * 60 * 60 * 1000, "2026-08-19": 3 * 60 * 60 * 1000 },
        },
      ],
    },
    expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
    mustContain: ["12"],
    criteria: { seeded: "12h total" },
    rubric: ["Reports about twelve hours naturally, in Chinese"],
  }),
  bookQuestion({
    id: "off-shelf-recommendation",
    description: "书架外推荐：同领域还有什么值得读。",
    tags: ["honesty", "presentation", "refactoring", "book"],
    book: fowler,
    cursorChapter: MID,
    turns: [{ text: "读完这本，代码质量这个方向还有什么书值得接着读？" }],
    expectation: {
      tools: { forbidden: ["present_books"] },
      interactions: { forbiddenKinds: ["permission"] },
    },
    noFence: true,
    criteria: { honesty: "framed as general suggestions, in Chinese" },
    rubric: ["Recommends genuinely adjacent classics (working effectively with legacy code, design patterns adjacent) as world knowledge, answer in Chinese"],
  }),
];
