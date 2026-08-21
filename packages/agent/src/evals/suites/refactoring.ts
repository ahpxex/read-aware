/**
 * 真书套件：Refactoring 第二版（英文全本，23 节 / 73 万字，expository）。
 * 技术书独有的三件事：手法目录的精确定位（"Extract Function 在哪一章"
 * 必须落到书内章号/章题，而非模糊转述）、坏味道概念图从纪要作答、以及
 * 双语纪律——中文读者读英文技术书，回答用中文但术语必须保留本书的英文
 * 拼写，不许翻译成自造译名。断言关键词全部从 fixture 文本实证派生。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";
import {
  coverageAssessment,
  forwardRetrievalAssessment as forwardBeyond,
  noFenceAssessment,
} from "./real-book-helpers";

const fowler = realBook("refactoring");

/** 读者位置：Chapter 9 Organizing Data（index 15，~60%）。 */
const READER_CHAPTER = 15;
/** Extract Function 的正式定义章：Chapter 6 A First Set of Refactorings。 */
const CATALOG_CHAPTER = 12;
/** Bad Smells 章（读者位置之前——概念图里已有全套坏味道名录）。 */
const SMELLS_CHAPTER = 9;
/** 前向目标：Chapter 12 Dealing with Inheritance（读者位置之后）。 */
const INHERITANCE_CHAPTER = 18;

function readerCursor() {
  const epub = fowler.epub();
  const charsBefore = epub.chapters
    .slice(0, READER_CHAPTER)
    .reduce((sum, chapter) => sum + chapter.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  return {
    chapterIndex: READER_CHAPTER,
    chapterTitle: epub.chapters[READER_CHAPTER]!.title,
    bookProgress: charsBefore / totalChars,
    chapterProgress: 0.25,
    visibleText: fowler.chapterViewport(READER_CHAPTER),
  };
}

/** 中文读者 + 英文技术书：回答须是中文，术语须保留本书英文拼写。 */
function bilingualAssessment(
  observation: AgentEvalObservation,
  requiredTerms: string[],
): EvalAssessment {
  const cjk = /[一-鿿]/.test(observation.answer);
  const kept = requiredTerms.filter((term) => observation.answer.includes(term));
  return assessmentFromChecks([
    {
      id: "answer.language-chinese",
      category: "quality",
      passed: cjk,
      message: cjk
        ? "answer is in Chinese for a Chinese reader"
        : "answer to a Chinese question contains no Chinese",
    },
    {
      id: "answer.english-terms-preserved",
      category: "answer",
      passed: kept.length === requiredTerms.length,
      message:
        kept.length === requiredTerms.length
          ? "this edition's English terms survive in the answer"
          : `terms lost or translated away: ${requiredTerms.filter((t) => !kept.includes(t)).join(", ")}`,
      expected: requiredTerms,
      actual: kept,
    },
  ]);
}

export const refactoringEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "refactoring",
  code: "S14",
  description:
    "基于英文 Refactoring 第2版全书的真实技术场景（目录查找、概念图谱、双语术语）。",
  scenarios: [
    defineAgentEvalScenario({
      id: "catalog-lookup-by-name",
      description:
        "在目录中定位指定重构的对应章节，从文本解释其机制——中文回答，英文术语保留。",
      tags: ["refactoring", "real-book", "technical", "retrieval", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(READER_CHAPTER),
      },
      seedSummary: fowler.seedSummary(60),
      turns: [
        {
          text: "Extract Function 这个手法书里是在哪一章正式讲的？具体操作步骤大概是什么？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        tools: {
          requiredAny: ["search_book_text", "read_chapter", "get_toc"],
          noErrors: true,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        definingChapter: `index ${CATALOG_CHAPTER} — Chapter 6 "A First Set of Refactorings"`,
      },
      rubric: [
        "Names the defining chapter by the book's own numbering or title (Chapter 6 / A First Set of Refactorings) and describes the mechanics as the catalog entry states them, not generic advice",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              requiredAny: ["search_book_text", "read_chapter", "get_toc"],
              noErrors: true,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          coverageAssessment(observation, "answer.names-defining-chapter", [
            "A First Set of Refactorings",
            "Chapter 6",
            "第6章",
            "第六章",
          ], 1),
          bilingualAssessment(observation, ["Extract Function"]),
          noFenceAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "smells-from-concept-graph",
      description:
        "从注入的概念图谱背诵坏味道词汇——该版多个味道名称，少量工具调用。",
      tags: ["refactoring", "real-book", "technical", "graph", "digest", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(READER_CHAPTER),
      },
      seedSummary: fowler.seedSummary(60),
      turns: [
        {
          text: "读到现在，书里都讲过哪些代码坏味道？帮我把主要的几种列一下，每种一句话。",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        // get_toc + 整章 3 个 part 的验证式重读 = 4 次，是合理轨迹；上限只拦
        // 发散检索（换词重试、跨章乱翻），"直接信任概念图"留给 rubric。
        tools: { maxCalls: 5 },
        maxRounds: 6,
      },
      criteria: {
        source: `concept graph built from chapter ${SMELLS_CHAPTER} (Bad Smells in Code) digests`,
      },
      rubric: [
        "Lists the smells under this edition's English names with one-line glosses grounded in the book's framing, not a generic code-quality lecture",
        "Leans on the injected concept graph rather than re-reading whole chapters when the registry already answers the question",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { tools: { maxCalls: 5 }, maxRounds: 6 }),
          coverageAssessment(observation, "answer.smell-vocabulary", [
            "Duplicated Code",
            "Long Function",
            "Mysterious Name",
            "Long Parameter List",
            "Global Data",
            "Mutable Data",
            "Feature Envy",
            "Data Clumps",
            "Shotgun Surgery",
            "Primitive Obsession",
          ], 3),
          bilingualAssessment(observation, []),
          noFenceAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "forward-lookup-inheritance",
      description:
        "技术书籍后续章节的问题，自由前向查找并用该书术语回答。",
      tags: ["refactoring", "real-book", "technical", "forward", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(READER_CHAPTER),
      },
      seedSummary: fowler.seedSummary(60),
      turns: [
        {
          text: "这本书后面讲继承相关的重构吗？比如什么情况下应该用 Replace Conditional with Polymorphism？",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        tools: {
          requiredAny: ["search_book_text", "read_chapter", "get_toc"],
          noErrors: true,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        forwardTargets: `chapters beyond index ${READER_CHAPTER} (Simplifying Conditional Logic #16, Dealing with Inheritance #${INHERITANCE_CHAPTER})`,
      },
      rubric: [
        "Answers from the later chapters' actual content (when polymorphism pays for itself vs a simple conditional), citing where the book discusses it",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              requiredAny: ["search_book_text", "read_chapter", "get_toc"],
              noErrors: true,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          bilingualAssessment(observation, ["Replace Conditional with Polymorphism"]),
          forwardBeyond(observation, READER_CHAPTER),
          noFenceAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "english-reader-native-flow",
      description:
        "关于英文书的英文问题，基于文本给出英文回答——双语纪律双向适用。",
      tags: ["refactoring", "real-book", "technical", "language", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(READER_CHAPTER),
      },
      seedSummary: fowler.seedSummary(60),
      turns: [
        {
          text: "When does Fowler say you should NOT extract a function? What are his criteria?",
          readingCursor: readerCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["extract"] },
        tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
      },
      criteria: {
        language: "English question → English answer (the global script-consistency check bites on CJK drift)",
      },
      rubric: [
        "Answers in English from the book's actual guidance (intention vs implementation, naming), not generic advice",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["extract"] },
            tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
          }),
          noFenceAssessment(observation),
        ),
    }),
  ],
};
