/**
 * 真书套件：三体全集（中文全本三部曲，61 章 / 约 90 万字，narrative）。
 * karamazov 之外的第二本叙事真书，专测它测不到的三件事：预训练知名度
 * 拉满的书（模型对全套剧情如数家珍）在早期游标下的剧透张力、
 * 合集/多卷本的目录导航（卷题对读者可见，卷内内容不可见）、以及
 * mobiunpack 类转制书的真实结构（卷级 NCX + 正文 h2 章题、
 * 第二三部整部一节的超长章节）。断言关键词全部从 fixture 文本实证派生。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { EvalSuite } from "../types";
import {
  cjkAnswerAssessment,
  fenceDisciplineAssessment,
  grantedSpoilerAssessment,
  leakAssessment as leakAgainst,
} from "./real-book-helpers";

const santi = realBook("santi");

/** 读者位置：第一部中段（第十七章 三体问题）——智子/古筝行动都在前方。 */
const READER_CHAPTER = 20;
/** 语录定位场景的取句章：疯狂年代（读者位置之前，无剧透张力）。 */
const QUOTE_CHAPTER = 10;
/** 显式剧透场景的目标章：古筝行动（章题对读者可见，内容不可见）。 */
const SPOILER_CHAPTER = 35;

/**
 * 泄漏词表：每个词都已对 fixture 全文实证首次出现晚于读者位置（#20），
 * 且不出现在任何章题/卷题里。刻意不含"黑暗森林"与"面壁者"（都在目录
 * 卷题/部题里，目录对读者可见——模型拒绝剧透时提及它们是正确行为，
 * 实测模型正是这么用的）、不含"水滴"（通用词，正常行文可能误伤）；
 * 剩下的全是只在后文正文里出现的内容级标记——讲出它们才算泄漏。
 */
const LEAK_WORDS_CH20 = [
  "智子", // 正文首现 #37；目录无
  "面壁计划", // 正文首现 #45；目录无
  "罗辑", // 正文首现 #44；目录无
  "宇宙社会学", // 正文首现 #44；目录无
  "章北海", // 正文首现 #45；目录无
  "执剑人", // 正文首现 #53；目录无
  "二向箔", // 正文首现 #56；目录无
];

function cursorAt(chapterIndex: number) {
  const epub = santi.epub();
  const chapter = epub.chapters[chapterIndex];
  if (!chapter) throw new Error(`santi fixture has no chapter ${chapterIndex}`);
  const charsBefore = epub.chapters
    .slice(0, chapterIndex)
    .reduce((sum, entry) => sum + entry.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, entry) => sum + entry.text.length, 0);
  return {
    chapterIndex,
    chapterTitle: chapter.title,
    bookProgress: charsBefore / totalChars,
    chapterProgress: 0.3,
    visibleText: santi.chapterViewport(chapterIndex),
  };
}

const readerProgress = () => Math.round(cursorAt(READER_CHAPTER).bookProgress * 100);

export const santiEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "santi",
  code: "S15",
  description:
    "基于完整中文《三体》三部曲合集的真实场景（预训练知名，多卷本）。",
  scenarios: [
    defineAgentEvalScenario({
      id: "famous-book-early-cursor-no-leak",
      description:
        "当读者在卷I中部，模型完全通过预训练了解该书时，回答停留在光标之后。",
      tags: ["santi", "real-book", "spoiler", "cursor", "book"],
      scope: { kind: "book", bookId: santi.bookId },
      seed: {
        ...santi.seed(readerProgress()),
        chapterDigests: santi.digestsSeed(READER_CHAPTER),
      },
      seedSummary: santi.seedSummary(readerProgress()),
      turns: [
        {
          text: "三体人到底是什么样的存在？他们为什么盯上了地球？",
          readingCursor: cursorAt(READER_CHAPTER),
        },
      ],
      criteria: {
        boundary: `reading cursor at chapter index ${READER_CHAPTER}`,
        leakWords: LEAK_WORDS_CH20,
      },
      rubric: [
        "Answers only from what the first twenty chapters establish (the game, the countdown, Ye Wenjie's past so far) and honestly frames the rest as not yet revealed, without listing later-book facts",
      ],
      evaluate: (observation) =>
        combineAssessments(
          leakAgainst(observation, LEAK_WORDS_CH20),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "quote-locates-chapter-omnibus",
      description:
        "在合集规模（61节、三本书）中定位逐字引用并命名正确章节。",
      tags: ["santi", "real-book", "retrieval", "book"],
      scope: { kind: "book", bookId: santi.bookId },
      seed: {
        ...santi.seed(readerProgress()),
        chapterDigests: santi.digestsSeed(READER_CHAPTER),
      },
      seedSummary: santi.seedSummary(readerProgress()),
      turns: [
        {
          text: `书里有这么一句："${santi.pickSentence(QUOTE_CHAPTER)}" 这是哪一章的？当时发生了什么？`,
          readingCursor: cursorAt(READER_CHAPTER),
        },
      ],
      expectation: {
        answer: { mustContain: [santi.chapterTitleKey(QUOTE_CHAPTER)] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      rubric: [
        "Names the correct chapter and retells only its context, staying behind the reading cursor",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: [santi.chapterTitleKey(QUOTE_CHAPTER)] },
            tools: { required: ["search_book_text"], noErrors: true },
          }),
          leakAgainst(observation, LEAK_WORDS_CH20),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "omnibus-toc-navigation",
      description:
        "卷名是读者可见的TOC事实：回答几卷及读者位置，不重述未读卷。",
      tags: ["santi", "real-book", "toc", "omnibus", "book"],
      scope: { kind: "book", bookId: santi.bookId },
      seed: {
        ...santi.seed(readerProgress()),
        chapterDigests: santi.digestsSeed(READER_CHAPTER),
      },
      seedSummary: santi.seedSummary(readerProgress()),
      turns: [
        {
          text: "这套书一共有几部？我现在读到第几部了？后面两部叫什么名字？",
          readingCursor: cursorAt(READER_CHAPTER),
        },
      ],
      expectation: {
        // 卷题是目录事实，对读者可见——正确答案必须直接说出来，不许推脱。
        answer: { mustContain: ["黑暗森林", "死神永生"] },
        tools: { requiredAny: ["get_toc", "get_reading_progress"], noErrors: true },
      },
      criteria: {
        principle: "volume TITLES are TOC-visible; volume CONTENTS stay behind the fence",
      },
      rubric: [
        "Names all three volumes plainly (titles are visible in the table of contents) while volunteering nothing about the later volumes' events",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["黑暗森林", "死神永生"] },
            tools: { requiredAny: ["get_toc", "get_reading_progress"], noErrors: true },
          }),
          leakAgainst(observation, LEAK_WORDS_CH20),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "explicit-spoiler-crosses-fence",
      description:
        "关于可见章节标题的显式剧透请求通过 confirmSpoiler 跨越栅栏并从实际文本回答。",
      tags: ["santi", "real-book", "spoiler", "grant", "book"],
      scope: { kind: "book", bookId: santi.bookId },
      seed: {
        ...santi.seed(readerProgress()),
        chapterDigests: santi.digestsSeed(READER_CHAPTER),
      },
      seedSummary: santi.seedSummary(readerProgress()),
      turns: [
        {
          text: "我在目录里看到后面有一章叫“古筝行动”。我不怕剧透，直接告诉我那是一次什么行动？",
          readingCursor: cursorAt(READER_CHAPTER),
        },
      ],
      expectation: {
        // "审判日"号是行动目标——只在正文里可得（首次出现 #23，实证）。
        answer: { mustContain: ["审判日"] },
        tools: { noErrors: false },
      },
      criteria: {
        target: `chapter ${SPOILER_CHAPTER} (古筝行动), explicit reader grant`,
      },
      rubric: [
        "Retells the operation from the retrieved chapter text (the ship, the nanofilament ambush), not from a remembered adaptation",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["审判日"] },
          }),
          grantedSpoilerAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "finished-trilogy-free-discussion",
      description:
        "已完成的读者获得无栅栏的整个三部曲讨论，通过跨卷检索支撑。",
      tags: ["santi", "real-book", "finished", "book"],
      scope: { kind: "book", bookId: santi.bookId },
      seed: {
        ...santi.seed(100, "finished"),
        chapterDigests: santi.digestsSeed(santi.epub().chapters.length),
      },
      seedSummary: santi.seedSummary(100),
      turns: [
        {
          text: "整套读完了。从叶文洁按下发射键到程心两次按不下去，这套书是怎么反复书写“选择”这件事的？",
        },
      ],
      expectation: {
        answer: { mustContain: ["叶文洁", "程心"] },
        interactions: { forbiddenKinds: ["permission"] },
      },
      rubric: [
        "Draws the through-line across all three volumes with specific decision scenes, reading as a companion who finished the trilogy alongside the reader",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["叶文洁", "程心"] },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
