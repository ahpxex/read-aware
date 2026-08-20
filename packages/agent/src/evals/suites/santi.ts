/**
 * 真书套件：三体全集（中文全本三部曲，61 章 / 约 90 万字，narrative）。
 * karamazov 之外的第二本叙事真书，专测它测不到的三件事：预训练知名度
 * 拉满的书（模型对全套剧情如数家珍）在早期游标下的剧透张力、
 * 合集/多卷本的目录导航（卷题对读者可见，卷内内容不可见）、以及
 * mobiunpack 类转制书的真实结构（卷级 NCX + 正文 h2 章题、
 * 第二三部整部一节的超长章节）。断言关键词全部从 fixture 文本实证派生。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

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

/** 内容级泄漏：答案里出现任何实证晚于边界的标记词即失败。 */
function leakAssessment(observation: AgentEvalObservation): EvalAssessment {
  const leaked = LEAK_WORDS_CH20.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id: "answer.no-pretraining-leak",
      category: "policy",
      passed: leaked.length === 0,
      message:
        leaked.length === 0
          ? "no post-boundary content markers leaked into the answer"
          : `post-boundary markers leaked: ${leaked.join(", ")}`,
      actual: leaked,
    },
  ]);
}

/** 围栏纪律：未经用户授权不得 confirmSpoiler，越界 read_chapter 不得成功。 */
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
    if (args.confirmSpoiler === true) violations.push(`${call.name}(confirmSpoiler)`);
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

/** 用户明确要剧透时：必须有一次成功的 confirmSpoiler=true 越界读取。 */
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

export const santiEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "santi",
  description:
    "Real-book scenarios on the full Chinese Three-Body trilogy omnibus (pretraining-famous, multi-volume).",
  scenarios: [
    defineAgentEvalScenario({
      id: "famous-book-early-cursor-no-leak",
      description:
        "With the reader mid-volume-I of a book the model knows completely from pretraining, answers stay behind the cursor.",
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
          leakAssessment(observation),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "quote-locates-chapter-omnibus",
      description:
        "Locates a verbatim quote at omnibus scale (61 sections, three novels) and names the right chapter.",
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
          leakAssessment(observation),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "omnibus-toc-navigation",
      description:
        "Volume titles are reader-visible TOC facts: answers how many volumes and where the reader stands, without retelling unread volumes.",
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
          leakAssessment(observation),
          fenceDisciplineAssessment(observation, READER_CHAPTER),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "explicit-spoiler-crosses-fence",
      description:
        "An explicit spoiler request about a visible chapter title crosses the fence via confirmSpoiler and answers from the actual text.",
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
        "A finished reader gets unfenced whole-trilogy discussion, grounded by retrieval across volumes.",
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
