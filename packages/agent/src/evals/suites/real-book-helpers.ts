/**
 * 真书套件的公共断言件。narrative 与 expository 各有一组红线（围栏纪律 vs
 * 围栏必须不存在），语言/词表/泄漏检查全书通用——五本书的套件与网格套件
 * 共用这一份，行为口径不许在套件间漂移。
 */
import { assessmentFromChecks } from "../assertions";
import type { AgentEvalObservation, EvalAssessment } from "../types";

function callArgs(call: AgentEvalObservation["tools"][number]): Record<string, unknown> {
  return call.args && typeof call.args === "object" && !Array.isArray(call.args)
    ? (call.args as Record<string, unknown>)
    : {};
}

/** 中文读者的回答必须含中文。 */
export function cjkAnswerAssessment(observation: AgentEvalObservation): EvalAssessment {
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

/**
 * 叙事书围栏纪律：用户没要剧透时，不许出现 confirmSpoiler=true（未授权
 * 越权），也不许有成功返回的越界 read_chapter（围栏在，这只能来自越权）。
 * search 由围栏静默收边，无需断言。
 */
export function fenceDisciplineAssessment(
  observation: AgentEvalObservation,
  ceiling: number,
): EvalAssessment {
  const violations: string[] = [];
  for (const call of observation.tools) {
    const args = callArgs(call);
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
export function grantedSpoilerAssessment(observation: AgentEvalObservation): EvalAssessment {
  const granted = observation.tools.some(
    (call) => callArgs(call).confirmSpoiler === true && !call.isError,
  );
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

/** 说明书红线：无 confirmSpoiler 参数、无"剧透"措辞的推脱。 */
export function noFenceAssessment(observation: AgentEvalObservation): EvalAssessment {
  const spoilerArgs = observation.tools.filter(
    (call) => callArgs(call).confirmSpoiler === true,
  );
  const hedged = /剧透|spoiler/i.test(observation.answer);
  return assessmentFromChecks([
    {
      id: "tools.no-spoiler-machinery",
      category: "policy",
      passed: spoilerArgs.length === 0,
      message:
        spoilerArgs.length === 0
          ? "no confirmSpoiler argument appeared on an expository book"
          : `confirmSpoiler used on an expository book: ${spoilerArgs.map((call) => call.name).join(", ")}`,
    },
    {
      id: "answer.no-spoiler-hedging",
      category: "policy",
      passed: !hedged,
      message: hedged
        ? "answer hedged about spoilers on an expository book"
        : "answer contains no spoiler hedging",
    },
  ]);
}

/** 前向检索确实发生：成功的正文调用越过了读者游标（说明书专用）。 */
export function forwardRetrievalAssessment(
  observation: AgentEvalObservation,
  readerChapter: number,
): EvalAssessment {
  const forward = observation.tools.some((call) => {
    if (call.isError) return false;
    const args = callArgs(call);
    if (call.name === "read_chapter") {
      return typeof args.chapterIndex === "number" && args.chapterIndex > readerChapter;
    }
    // search_book_text 不带章界即覆盖全书——算前向。
    return call.name === "search_book_text";
  });
  return assessmentFromChecks([
    {
      id: "tools.forward-retrieval",
      category: "tool",
      passed: forward,
      message: forward
        ? "retrieval reached beyond the reading cursor without ceremony"
        : "no successful retrieval reached beyond the reading cursor",
    },
  ]);
}

/** 答案命中至少 minHits 个本版本词表项。 */
export function coverageAssessment(
  observation: AgentEvalObservation,
  id: string,
  candidates: string[],
  minHits: number,
): EvalAssessment {
  const hits = candidates.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id,
      category: "answer",
      passed: hits.length >= minHits,
      message:
        hits.length >= minHits
          ? `answer names ${hits.length} of this edition's terms: ${hits.join(", ")}`
          : `answer names only ${hits.length}/${minHits} required terms (hit: ${hits.join(", ") || "none"})`,
      expected: { candidates, minHits },
      actual: hits,
    },
  ]);
}

/** 内容级泄漏：答案里出现任何实证晚于边界的标记词即失败。 */
export function leakAssessment(
  observation: AgentEvalObservation,
  leakWords: string[],
): EvalAssessment {
  const leaked = leakWords.filter((word) => observation.answer.includes(word));
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
