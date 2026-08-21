/**
 * 真书问题工厂：把"真实读者读书时会问的问题"批量铸成场景。
 *
 * 专属套件的核心场景（围栏张力、图谱背诵、手法目录……）仍手写在各书
 * 主文件里；这里生产的是长尾真实问题——词句理解、模糊指代、称呼变体、
 * 前情回顾、进度管理、标注辅助、书架外推荐、情绪与批判。它们共享同一
 * 套骨架（游标、纪要注入、语言检查、围栏/无栏红线、版本泄漏词），工厂
 * 保证五本书之间这些口径不再漂移。
 *
 * 断言词仍必须由调用方从 fixture 文本实证派生（首现位置 ≤ 游标，或标注
 * 为合法前向目标）——工厂不豁免实证纪律，只是免除样板。
 */
import { combineAssessments, evaluateAgentTrace, type AgentTraceExpectation } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import type { RealBookFixture } from "../../book-fixtures";
import type { InMemorySeed } from "../../../testing/fixtures";
import type { AgentEvalObservation, EvalAssessment, JsonValue } from "../../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  fenceDisciplineAssessment,
  forwardRetrievalAssessment as forwardCheck,
  leakAssessment,
  noFenceAssessment,
} from "./real-book-helpers";

/** 任意书任意章的游标：字符占比换算进度，可见文本取章首段。 */
export function bookCursor(book: RealBookFixture, chapterIndex: number, chapterProgress = 0.3) {
  const chapters = book.epub().chapters;
  const chapter = chapters[chapterIndex];
  if (!chapter) throw new Error(`${book.spec.slug} fixture has no chapter ${chapterIndex}`);
  const charsBefore = chapters
    .slice(0, chapterIndex)
    .reduce((sum, entry) => sum + entry.text.length, 0);
  const totalChars = chapters.reduce((sum, entry) => sum + entry.text.length, 0);
  return {
    chapterIndex,
    chapterTitle: chapter.title ?? "",
    bookProgress: charsBefore / totalChars,
    chapterProgress,
    visibleText: book.chapterViewport(chapterIndex),
  };
}

/** 字符占比换算的整数进度百分比（seed.progressPercent 用）。 */
export function chapterProgressPercent(book: RealBookFixture, chapterIndex: number): number {
  const chapters = book.epub().chapters;
  const charsBefore = chapters
    .slice(0, chapterIndex)
    .reduce((sum, entry) => sum + entry.text.length, 0);
  const totalChars = chapters.reduce((sum, entry) => sum + entry.text.length, 0);
  return Math.round((charsBefore / totalChars) * 100);
}

export interface BookQuestionTurn {
  text: string;
  /** 该轮的游标章（缺省用主游标）；多轮推进游标即位置敏感场景。 */
  cursorChapter?: number;
}

export interface BookQuestionOptions {
  id: string;
  description: string;
  tags: string[];
  book: RealBookFixture;
  /** 主游标章 index（seed 进度与纪要注入的缺省基准）。 */
  cursorChapter: number;
  turns: BookQuestionTurn[];
  /** narrative：内容级泄漏词（实证首现晚于最大游标章）。 */
  leakWords?: string[];
  /** narrative：围栏纪律断言（confirmSpoiler 与越界 read_chapter）。 */
  fence?: boolean;
  /** expository：断言无剧透机械与措辞。 */
  noFence?: boolean;
  /** expository：断言前向检索确实发生（越过游标的成功正文调用）。 */
  forward?: boolean;
  mustContain?: string[];
  mustNotContain?: string[];
  coverage?: { id: string; words: string[]; min: number };
  /** true → requiredAny(search/read/toc)；数组 → required 工具集。 */
  retrieval?: boolean | string[];
  /** 追加的轨迹断言（maxCalls、maxRounds、interactions…）。 */
  expectation?: AgentTraceExpectation;
  criteria?: JsonValue;
  rubric?: string[];
  /** 完全自定义断言时挂进来，与工厂默认断言合并。 */
  extraEvaluate?: (observation: AgentEvalObservation) => EvalAssessment | Promise<EvalAssessment>;
  status?: "reading" | "finished";
  /** 附加 seed 字段（bookStats 等），浅合并进书 seed。 */
  extraSeed?: Partial<InMemorySeed>;
  progressOverride?: number;
  /** 纪要注入的截止章（缺省 = 最大游标章）。 */
  digestsThrough?: number;
  /** 状态投射（state 断言场景用）：暴露打分所需的最小 post-run 投射。 */
  observeState?: AgentEvalScenario["observeState"];
  /** 场景级宿主行为（例如固定 ask_user 的读者选择）。 */
  setup?: AgentEvalScenario["setup"];
}

export function bookQuestion(options: BookQuestionOptions): AgentEvalScenario {
  const { book } = options;
  const cursorChapters = options.turns.map((turn) => turn.cursorChapter ?? options.cursorChapter);
  const maxCursorChapter = Math.max(...cursorChapters);
  const progress =
    options.progressOverride ?? chapterProgressPercent(book, maxCursorChapter);
  const seed: InMemorySeed = {
    ...book.seed(progress, options.status ?? "reading"),
    chapterDigests: book.digestsSeed(options.digestsThrough ?? maxCursorChapter),
    ...options.extraSeed,
  };
  const expectation: AgentTraceExpectation = { ...options.expectation };
  if (options.mustContain?.length || options.mustNotContain?.length) {
    expectation.answer = {
      ...expectation.answer,
      ...(options.mustContain?.length ? { mustContain: options.mustContain } : {}),
      ...(options.mustNotContain?.length ? { mustNotContain: options.mustNotContain } : {}),
    };
  }
  if (options.retrieval === true) {
    const any = new Set([...(expectation.tools?.requiredAny ?? []), "search_book_text", "read_chapter", "get_toc"]);
    expectation.tools = { ...expectation.tools, requiredAny: [...any] };
  } else if (Array.isArray(options.retrieval)) {
    const required = [...(expectation.tools?.required ?? []), ...options.retrieval];
    expectation.tools = { ...expectation.tools, required };
  }
  const asksCjk = options.turns.some((turn) => /[一-鿿]/.test(turn.text));
  const originalCriteria =
    options.criteria && typeof options.criteria === "object" && !Array.isArray(options.criteria)
      ? options.criteria
      : options.criteria === undefined
        ? {}
        : { details: options.criteria };
  const criteria = {
    ...originalCriteria,
    ...(options.leakWords?.length
      ? {
          leakWords: options.leakWords,
          fixturePolicy: {
            bookSlug: book.spec.slug,
            boundaryChapter: maxCursorChapter,
            leakWords: options.leakWords,
          },
        }
      : {}),
  };

  return defineAgentEvalScenario({
    id: options.id,
    description: options.description,
    tags: options.tags,
    scope: { kind: "book", bookId: book.bookId },
    seed,
    seedSummary: book.seedSummary(progress),
    turns: options.turns.map((turn) => ({
      text: turn.text,
      readingCursor: bookCursor(book, turn.cursorChapter ?? options.cursorChapter),
    })),
    expectation,
    criteria,
    rubric: options.rubric,
    setup: options.setup,
    observeState: options.observeState,
    evaluate: async (observation) => {
      const parts: EvalAssessment[] = [evaluateAgentTrace(observation, expectation)];
      if (options.coverage) {
        parts.push(
          coverageAssessment(
            observation,
            options.coverage.id,
            options.coverage.words,
            options.coverage.min,
          ),
        );
      }
      if (options.leakWords?.length) parts.push(leakAssessment(observation, options.leakWords));
      if (options.fence) parts.push(fenceDisciplineAssessment(observation, maxCursorChapter));
      if (options.noFence) parts.push(noFenceAssessment(observation));
      if (options.forward) parts.push(forwardCheck(observation, maxCursorChapter));
      if (asksCjk) parts.push(cjkAnswerAssessment(observation));
      if (options.extraEvaluate) parts.push(await options.extraEvaluate(observation));
      return combineAssessments(...parts);
    },
  });
}
