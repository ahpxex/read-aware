/**
 * 贝格尔（如何用提问解决问题）真实读者问题集（工厂生产的长尾面）。
 *
 * 工具书的长尾问题：框架复述（为什么/如果/如何）、各类问题的使用时机、
 * 例证复述、多情境应用（复盘会/亲子/团队创造）、辅文（自测页）检索、
 * 前向章节预览、要点提炼、引句定位、模糊批判（太理想化）、同意图多
 * 措辞、三轮深挖、标注/统计/书架外推荐。词汇全部实证于正文（#3 起）。
 */
import { assessmentFromChecks } from "../../assertions";
import type { AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { bookQuestion } from "./question-factories";

const berger = realBook("berger");
const MID = 5;

export const bergerQuestionScenarios: AgentEvalScenario[] = [
  bookQuestion({
    id: "framework-recite",
    description: "框架复述：全书的核心提问框架是什么。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "这本书的核心框架到底是什么？为什么各章标题都是『为什么/为什么要』开头？" }],
    coverage: { id: "answer.framework", words: ["为什么", "如果", "如何", "提问"], min: 3 },
    noFence: true,
    criteria: { framework: "Why / What if / How — 章题即框架，实证于 TOC" },
    rubric: [
      "States the book's own three-move framework (why → what if → how) and how the chapters walk it, in one breath",
    ],
  }),
  bookQuestion({
    id: "question-types-when-to-use",
    description: "使用时机：为什么型、如果型、如何型各在什么时候用。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "『为什么』类问题和『如果』类问题、『如何』类问题，分别什么时候该用哪个？" }],
    coverage: { id: "answer.types-usage", words: ["为什么", "如果", "如何"], min: 3 },
    noFence: true,
    criteria: { usage: "framework chapters' own division" },
    rubric: ["Maps each question family to its stage (see/act/build) as the book divides them, with one example each"],
  }),
  bookQuestion({
    id: "decision-chapter-example",
    description: "例证复述：讲决策的那章举了什么例子。",
    tags: ["digest", "retrieval", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "讲做决策那章里举了什么例子？挑一个印象深的讲讲。" }],
    retrieval: true,
    noFence: true,
    criteria: { chapter: "index 4 (做决策时，我为什么应该问问题) — read side" },
    rubric: ["Retells an actual example from that chapter and what it is meant to demonstrate"],
  }),
  bookQuestion({
    id: "apply-retrospective-meeting",
    description: "应用咨询：复盘会总变甩锅会，用书里方法怎么改。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "我们团队的复盘会每次都变成互相甩锅。用这本书的方法，这个会应该怎么开？" }],
    coverage: { id: "answer.applied-questions", words: ["为什么", "如果", "如何", "开放式", "问题"], min: 2 },
    noFence: true,
    criteria: { application: "methods turned into a concrete meeting redesign" },
    rubric: [
      "Rebuilds the meeting around the book's question methods (which questions open blame into inquiry), with an agenda the reader can run tomorrow",
    ],
  }),
  bookQuestion({
    id: "apply-parenting-talk",
    description: "应用咨询：跟青春期孩子没话说，提问方法能用吗。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "我跟上初中的儿子现在没什么话说，一开口他就烦。这本书的提问方法在亲子沟通里能用吗？怎么用？" }],
    coverage: { id: "answer.applied-parenting", words: ["开放式", "为什么", "如果", "问题", "提问"], min: 2 },
    noFence: true,
    criteria: { application: "methods translated into a parenting register" },
    rubric: [
      "Adapts the methods honestly (which question types fit a teenager, which feel like interrogation) — practical, not preachy",
    ],
  }),
  bookQuestion({
    id: "apply-team-creativity",
    description: "应用咨询：想让团队更有创造力，创造章有什么方法。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "我想让团队更有创造力、敢提新想法。书里讲创造的那章有什么我能直接用的？" }],
    mustContain: ["如果"],
    noFence: true,
    criteria: { chapter: "index 5 (我们为什么要创造) — the reader's current chapter" },
    rubric: ["Pulls the chapter's actual creativity methods (what-if framing) into two or three team moves"],
  }),
  bookQuestion({
    id: "connection-chapter-forward",
    description: "前向预览：『与他人建立连接』那章讲什么。",
    tags: ["forward", "digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "下一章《为什么要与他人建立连接》讲什么？跟提问有什么关系？" }],
    retrieval: true,
    forward: true,
    noFence: true,
    criteria: { forward: "index 6 — beyond cursor, how-to book zero ceremony" },
    rubric: ["Previews that chapter's actual content from its text, matter-of-factly"],
  }),
  bookQuestion({
    id: "self-test-page-recall",
    description: "辅文检索：书开头的自测页测了什么。",
    tags: ["retrieval", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "书开头那个『测一测你是否会用提问解决问题』的自测，都测了些什么？我忘了自己当时怎么答的。" }],
    retrieval: true,
    noFence: true,
    criteria: { source: "自测页 #2（辅文，可检索不注入纪要）" },
    rubric: ["Retells what the self-test actually probes from the retrieved page"],
  }),
  bookQuestion({
    id: "pocket-question-checklist",
    description: "生成任务：把全书方法整理成随身问题清单。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "帮我把这本书的方法整理成一张随身问题清单，遇到事就能掏出来看的那种。" }],
    coverage: { id: "answer.checklist-coverage", words: ["为什么", "如果", "如何", "开放式", "假设"], min: 3 },
    noFence: true,
    criteria: { synthesis: "framework vocabulary compressed into a usable list" },
    rubric: [
      "A genuinely usable card (a handful of questions grouped by situation), not a chapter summary wearing a checklist costume",
    ],
  }),
  bookQuestion({
    id: "quote-find-and-explain",
    description: "引句定位：拿实句问哪章的、什么意思。",
    tags: ["retrieval", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [
      {
        text: `书里有这么一句："${berger.pickSentence(4)}" 这是哪章的？在书里是什么意思？`,
      },
    ],
    retrieval: true,
    noFence: true,
    criteria: { quote: "chapter 4 area — located and explained" },
    rubric: ["Names the chapter and explains the line within the book's method"],
  }),
  bookQuestion({
    id: "author-background",
    description: "辅文检索：作者是谁、凭什么写这本书。",
    tags: ["retrieval", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "这个伯格（还是贝格尔？）是谁？他的背景凭什么讲提问这件事？" }],
    retrieval: true,
    noFence: true,
    criteria: { source: "作者背景散见于前言/正文（伯格 #5、贝格尔 #4 均实证）" },
    rubric: ["Reports the author's actual background as the book presents it, and uses this edition's own name spelling"],
  }),
  bookQuestion({
    id: "finish-plan",
    description: "收尾规划：还剩两章，怎么安排读完。",
    tags: ["forward", "toc", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "还剩两三章就读完了。后面讲什么？值不值得专门抽时间，还是顺手翻完就行？" }],
    retrieval: true,
    forward: true,
    noFence: true,
    criteria: { forward: "indexes 6-8（连接/领导/结语）" },
    rubric: ["Previews the remaining chapters from their content and gives a real read/skim verdict"],
  }),
  bookQuestion({
    id: "key-takeaways-top3",
    description: "要点提炼：到此最重要的三个收获。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "帮我提炼下：读到现在，这本书给我的三个最重要的收获是什么？" }],
    expectation: { tools: { maxCalls: 3 }, maxRounds: 4 },
    coverage: {
      id: "answer.takeaways",
      words: [
        "为什么",
        "如果",
        "如何",
        "提问",
        "问题",
        "开放式",
        "假设",
        "选项",
        "偏见",
        "智力谦逊",
        "慢思考",
        "侦察兵",
      ],
      min: 3,
    },
    noFence: true,
    criteria: { synthesis: "digest-based, no re-reading" },
    rubric: ["Three takeaways a reader could act on tomorrow, each one sentence"],
  }),
  bookQuestion({
    id: "current-chapter-recap",
    description: "『这章讲什么』：光标章（创造章）摘要。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "这章读到一半，帮我捋一下这章到底在讲什么。" }],
    retrieval: true,
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: `index ${MID} (我们为什么要创造)` },
    rubric: ["Recaps the chapter's argument and where the reader is in it"],
  }),
  bookQuestion({
    id: "previous-chapter-recall",
    description: "『上一章讲什么』：决策章回忆。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "上一章讲什么来着？跟这章有联系吗？" }],
    retrieval: true,
    expectation: { maxRounds: 4 },
    noFence: true,
    criteria: { chapter: `index ${MID - 1} (做决策时，我为什么应该问问题)` },
    rubric: ["Retells the decision chapter's core and links it to the current one"],
  }),
  bookQuestion({
    id: "whole-structure",
    description: "结构总览：全书怎么编排的。",
    tags: ["toc", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "这本书整体是怎么排的？前言之后那几章是什么关系？" }],
    retrieval: true,
    noFence: true,
    criteria: { structure: "前言 → 决策/创造/连接/领导 → 结语（TOC facts）" },
    rubric: ["Sketches the real chapter arc in plain language"],
  }),
  bookQuestion({
    id: "too-idealistic-pushback",
    description: "模糊批判：『方法太理想化，职场用不了』——认真接招。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "说实话我感觉这些方法挺理想化的。真到了职场，老板要答案，你光会提问有什么用？" }],
    noFence: true,
    criteria: { pushback: "engage the objection with the book's own material (when to ask vs when to answer), no defensiveness" },
    rubric: [
      "Takes the challenge seriously: where the book itself draws the ask-vs-answer line, and where the reader's skepticism is fair — a conversation, not a defense brief",
    ],
  }),
  bookQuestion({
    id: "same-intent-three-wordings",
    description: "同意图多措辞：『怎么做决策/决策时问什么/帮我决定』——三问一答质量一致。",
    tags: ["continuity", "multi-turn", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [
      { text: "书里教人怎么做决策？" },
      { text: "换个问法：按这本书，决策的时候我该问自己什么问题？" },
      { text: "再换个问法：我正犹豫要不要换工作，你别替我决定，给我一套问法。" },
    ],
    coverage: { id: "answer.paraphrase-consistency", words: ["为什么", "如果", "如何", "选项", "假设", "开放式"], min: 2 },
    noFence: true,
    criteria: {
      paraphrase: "same intent, three phrasings (abstract/operational/personal) — the third is the real test: methods applied to THIS decision",
    },
    rubric: [
      "All three answers carry the same substantive method; the third turns it into questions about the reader's actual job change",
    ],
  }),
  bookQuestion({
    id: "drill-down-three-turns",
    description: "三轮深挖：提问>给答案 → 那何时该直接给 → 举个书里的例子。",
    tags: ["continuity", "multi-turn", "digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [
      { text: "书里是不是说提问比直接给答案好？为什么？" },
      { text: "那什么时候反而该直接给答案？" },
      { text: "书里有没有这种该直接给答案的例子？给我找一个。" },
    ],
    retrieval: true,
    noFence: true,
    criteria: { drill: "turn3 must ground the example in the book's actual text" },
    rubric: ["Each turn goes deeper, and the final example comes from the retrieved book, not invented"],
  }),
  bookQuestion({
    id: "why-question-benefits",
    description: "单一框架面：『为什么』类问题的好处到底是什么。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "老问『为什么』不会招人烦吗？书里说它到底好在哪？" }],
    mustContain: ["为什么"],
    noFence: true,
    criteria: { framework: "the why-family's actual payoff as the book states it" },
    rubric: ["Explains the payoff (seeing/root-cause) as argued, and honestly notes the book's own caveat about interrogation tone"],
  }),
  bookQuestion({
    id: "what-if-usage",
    description: "单一框架面：『如果』类问题怎么用。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "『如果……会怎样』这种问题书里怎么教人用的？跟空想有什么区别？" }],
    mustContain: ["如果"],
    noFence: true,
    criteria: { framework: "what-if family — hypothesis framing" },
    rubric: ["Explains what-if's role (breaking frames) with one of the book's own illustrations"],
  }),
  bookQuestion({
    id: "how-question-usage",
    description: "单一框架面：『如何』类问题怎么用。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "『如何』类问题是干什么的？什么时候才轮到它出场？" }],
    mustContain: ["如何"],
    noFence: true,
    criteria: { framework: "the how family — acting/building stage" },
    rubric: ["Places how-questions at the action stage of the framework, with an example"],
  }),
  bookQuestion({
    id: "decision-creation-link",
    description: "跨章综合：决策章与创造章是什么关系。",
    tags: ["digest", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "决策那章和创造那章，讲的是两件事还是一件事？它们怎么接上的？" }],
    coverage: { id: "answer.cross-chapter", words: ["决策", "创造", "提问", "问题"], min: 3 },
    noFence: true,
    criteria: { synthesis: "indexes 4 & 5 — one method, two applications" },
    rubric: ["Shows the shared spine (question-led thinking) and where the two chapters diverge"],
  }),
  bookQuestion({
    id: "highlight-current-passage-green",
    description: "标注辅助：把指定句划成绿色高亮。",
    tags: ["state", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: `把这句划成绿色高亮：「${berger.pickSentence(MID)}」` }],
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
    criteria: { verbatim: "highlight text equals the quoted sentence, color green" },
    extraEvaluate: (observation) => {
      const quoted = berger.pickSentence(MID);
      const state =
        observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
          ? (observation.state as { highlights?: Array<{ text?: string; color?: string }> })
          : {};
      const highlights = Array.isArray(state.highlights) ? state.highlights : [];
      const matched = highlights.some((entry) => entry?.text === quoted && entry?.color === "green");
      return assessmentFromChecks([
        {
          id: "state.highlight-verbatim-green",
          category: "state",
          passed: matched,
          message: matched ? "the exact sentence was highlighted in green" : "no verbatim green highlight was recorded",
          expected: { text: quoted, color: "green" },
          actual: highlights,
        },
      ]);
    },
  }),
  bookQuestion({
    id: "note-takeaway-current",
    description: "笔记辅助：把框架要点记成读书笔记。",
    tags: ["state", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "记条笔记：这套书的骨架是 为什么—如果—如何 三步提问法，缺一步都会卡住。" }],
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
        (note) => typeof note.body === "string" && /为什么/.test(note.body) && /如果/.test(note.body) && /如何/.test(note.body),
      );
      return assessmentFromChecks([
        {
          id: "state.note-captured",
          category: "state",
          passed: captured,
          message: captured ? "the framework note landed in the annotation list" : "no framework note was recorded",
          actual: notes.map((note) => note.body ?? ""),
        },
      ]);
    },
  }),
  bookQuestion({
    id: "reading-stats-query",
    description: "进度统计：这本书读了多久。",
    tags: ["economy", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "这本《如何用提问解决问题》我读了多久了？" }],
    extraSeed: {
      bookStats: [
        {
          bookId: berger.bookId,
          progressPercent: 50,
          status: "reading",
          totalMs: 2 * 60 * 60 * 1000,
          daily: { "2026-08-19": 2 * 60 * 60 * 1000 },
        },
      ],
    },
    expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
    mustContain: ["2"],
    criteria: { seeded: "2h total" },
    rubric: ["Reports about two hours naturally"],
  }),
  bookQuestion({
    id: "off-shelf-recommendation",
    description: "书架外推荐：同类思维书推荐。",
    tags: ["honesty", "presentation", "berger", "book"],
    book: berger,
    cursorChapter: MID,
    turns: [{ text: "喜欢这种讲思维方法的小书。还有什么同类推荐？" }],
    expectation: {
      tools: { forbidden: ["present_books"] },
      interactions: { forbiddenKinds: ["permission"] },
    },
    noFence: true,
    criteria: { honesty: "framed as general suggestions" },
    rubric: ["Recommends genuinely adjacent books (question-led thinking) as world knowledge"],
  }),
];
