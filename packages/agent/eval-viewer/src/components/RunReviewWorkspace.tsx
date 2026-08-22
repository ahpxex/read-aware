import { Fragment, useMemo, useState } from "react";
import {
  ms,
  saveHumanReview,
  usd,
  type CatalogScenario,
  type RunRecord,
} from "../api";
import { reviewMean, type HumanReview, type ManualReviewSession } from "../reviews";
import { HumanReviewForm } from "./HumanReviewForm";
import { ManualSessionPanel } from "./ManualSessionPanel";
import { TranscriptView } from "./TranscriptView";

type ReviewFilter = "all" | "unreviewed" | "concerns";

const refChipClass =
  "inline-block select-all rounded-[5px] bg-[var(--accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]";

function humanScoreClass(review: HumanReview | undefined): string {
  if (review?.verdict === "pass") return "text-[var(--ok)]";
  if (review?.verdict === "partial") return "text-[var(--err)]";
  if (review?.verdict === "fail") return "text-[var(--fail)]";
  return "text-[var(--subtle)]";
}

function runTargetId(record: RunRecord): string {
  return `run:${record.id}`;
}

function manualTargetId(turnId: string): string {
  return `manual:${turnId}`;
}

function isConcern(review: HumanReview | undefined): boolean {
  return review?.verdict === "partial" || review?.verdict === "fail";
}

function matchesFilter(review: HumanReview | undefined, filter: ReviewFilter): boolean {
  if (filter === "unreviewed") return review?.score === undefined && !review?.verdict;
  if (filter === "concerns") return isConcern(review);
  return true;
}

function humanScore(review: HumanReview | undefined): string {
  const score = reviewMean(review);
  return score === undefined ? "未评" : `${score.toFixed(score % 1 ? 1 : 0)} / 5`;
}

function recordTurns(record: RunRecord) {
  return (record.output?.turns ?? []).map((turn, index) => ({
    question: turn.input?.text ?? "",
    answer: turn.answer ?? "",
    selection: turn.input?.attachments?.[0]?.text,
    cursor: turn.input?.readingCursor,
    tools: (record.output?.tools ?? []).filter(
      (tool) => tool.turn === undefined || tool.turn === index + 1,
    ),
  }));
}

function ReviewDiagnostics({
  record,
  scenario,
}: {
  record: RunRecord;
  scenario?: CatalogScenario;
}) {
  const checks = [...(record.assessment?.checks ?? [])].sort(
    (a, b) => Number(a.passed) - Number(b.passed),
  );
  const failed = checks.filter((check) => !check.passed).length;
  if (!scenario && checks.length === 0) return null;
  return (
    <details className="border-b border-[var(--border)] py-2.5">
      <summary className="flex cursor-pointer items-center gap-3 text-[11px] text-[var(--subtle)]">
        测试依据
        {checks.length > 0 && (
          <span className={`ml-auto ${failed ? "text-[var(--fail)]" : ""}`}>
            机器检查 {checks.length - failed}/{checks.length}
          </span>
        )}
      </summary>
      {scenario && (
        <div className="max-w-[900px] text-xs text-[var(--muted)]">
          <p>{scenario.description}</p>
          {scenario.input.rubric?.length ? (
            <ul className="list-disc pl-5">
              {scenario.input.rubric.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {checks.length > 0 && (
        <ul className="mt-2.5 mb-1 grid list-none gap-1 p-0">
          {checks.map((check) => (
            <li
              key={`${check.id}-${check.message}`}
              className={`flex flex-wrap items-baseline gap-2 text-xs ${
                check.passed ? "" : "text-[var(--fail)]"
              }`}
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 self-center rounded-full ${
                  check.passed ? "bg-[var(--ok)]" : "bg-[var(--fail)]"
                }`}
              />
              <span className="font-mono text-xs text-[var(--muted)]">{check.id}</span>
              <span>{check.message}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function RunReviewWorkspace({
  runId,
  records,
  refOf,
  scenarioOf,
  humanReviews,
  manualSessions,
  onReviewChange,
  onManualSessionChange,
}: {
  runId: string;
  records: RunRecord[];
  refOf: (scenarioId: string) => string;
  scenarioOf?: (scenarioId: string) => CatalogScenario | undefined;
  humanReviews: Record<string, HumanReview>;
  manualSessions: ManualReviewSession[];
  onReviewChange: (review: HumanReview) => void;
  onManualSessionChange: (session: ManualReviewSession) => void;
}) {
  const ordered = useMemo(
    () =>
      [...records].sort(
        (a, b) =>
          refOf(a.scenarioId).localeCompare(refOf(b.scenarioId), undefined, { numeric: true }) ||
          a.variantId.localeCompare(b.variantId) ||
          a.repetition - b.repetition,
      ),
    [records, refOf],
  );
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const fixedReviews = records.map((record) => humanReviews[runTargetId(record)]);
  const manualTurns = manualSessions.flatMap((session) => session.turns);
  const allReviews = [
    ...fixedReviews,
    ...manualTurns.map((turn) => humanReviews[manualTargetId(turn.id)]),
  ];
  const reviewed = allReviews.filter((review) => review?.score !== undefined || review?.verdict);
  const concerns = reviewed.filter(isConcern);

  const persistReview = async (input: Parameters<typeof saveHumanReview>[1]) => {
    const review = await saveHumanReview(runId, input);
    onReviewChange(review);
  };

  return (
    <section className="mt-2" aria-label="人工评测">
      <header className="flex items-center justify-between gap-4 border-y border-[var(--border)] py-2.5 max-sm:items-start">
        <div className="flex items-baseline gap-2 text-xs text-[var(--muted)]">
          <strong className="text-sm text-[var(--fg)] tabular-nums">
            {reviewed.length}/{records.length + manualTurns.length}
          </strong>
          <span>已评</span>
          {concerns.length > 0 && (
            <span className="text-[var(--fail)]">{concerns.length} 个有问题</span>
          )}
        </div>
        <div
          className="inline-grid grid-flow-col auto-cols-fr overflow-hidden rounded-[5px] border border-[var(--border)]"
          aria-label="人工评测筛选"
        >
          {([
            ["all", "全部"],
            ["unreviewed", "待评"],
            ["concerns", "有问题"],
          ] as const).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={`border-r border-[var(--border)] bg-[var(--bg)] px-3 py-1 text-xs whitespace-nowrap text-[var(--muted)] last:border-r-0 ${
                filter === id ? "bg-[var(--fg)]! text-[var(--bg)]!" : ""
              }`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid">
        {ordered.map((record) => {
          const targetId = runTargetId(record);
          const review = humanReviews[targetId];
          const sessions = manualSessions.filter(
            (session) =>
              session.scenarioId === record.scenarioId &&
              session.variantId === record.variantId,
          );
          const showRecord = matchesFilter(review, filter);
          const visibleManualTurns = sessions.flatMap((session) =>
            session.turns
              .map((turn, index) => ({ session, turn, index }))
              .filter(({ turn }) =>
                matchesFilter(humanReviews[manualTargetId(turn.id)], filter),
              ),
          );
          if (!showRecord && visibleManualTurns.length === 0) return null;
          return (
            <Fragment key={record.id}>
              {showRecord && (
                <article className="min-w-0 border-b border-[var(--border)] pb-8" id={record.id}>
                  <header className="flex items-start justify-between gap-5 pt-5.5 pb-2.5 max-sm:gap-2.5">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2.5 max-sm:items-start">
                        <span className={refChipClass}>{refOf(record.scenarioId)}</span>
                        <h2 className="m-0 min-w-0 truncate font-mono text-sm leading-6 font-semibold tracking-normal max-sm:whitespace-normal max-sm:wrap-anywhere">
                          {record.scenarioId}
                        </h2>
                      </div>
                      <p className="mt-1 mb-0 text-[11px] text-[var(--subtle)]">
                        {record.variantId} · #{record.repetition} · {ms(record.telemetry.wallTimeMs)} · {usd(record.telemetry.costUsd)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] max-sm:grid max-sm:justify-items-end max-sm:gap-0.5">
                      <span
                        className={`font-semibold ${
                          record.status === "passed"
                            ? "text-[var(--ok)]"
                            : "text-[var(--fail)]"
                        }`}
                      >
                        机器{record.status === "passed" ? "通过" : record.status === "failed" ? "失败" : "错误"}
                      </span>
                      <span className={`tabular-nums ${humanScoreClass(review)}`}>
                        {humanScore(review)}
                      </span>
                    </div>
                  </header>
                  {record.error && (
                    <div className="bg-[var(--fail-bg)] px-3 py-2.5 text-xs text-[var(--fail)]">
                      {record.error.stage} · {record.error.name}: {record.error.message}
                    </div>
                  )}
                  <div className="min-w-0">
                    <TranscriptView turns={recordTurns(record)} />
                    <HumanReviewForm
                      key={targetId}
                      targetId={targetId}
                      review={review}
                      onSave={persistReview}
                    />
                    <ReviewDiagnostics record={record} scenario={scenarioOf?.(record.scenarioId)} />
                    <ManualSessionPanel
                      runId={runId}
                      record={record}
                      sessions={manualSessions}
                      onSessionChange={onManualSessionChange}
                    />
                  </div>
                </article>
              )}

              {visibleManualTurns.map(({ session, turn, index }) => {
                const manualTarget = manualTargetId(turn.id);
                const manualReview = humanReviews[manualTarget];
                return (
                  <article
                    className="min-w-0 border-b border-l-[3px] border-[var(--border)] border-l-[var(--accent)] pb-8 pl-6 max-sm:pl-3"
                    key={turn.id}
                  >
                    <header className="flex items-start justify-between gap-5 pt-5.5 pb-2.5 max-sm:gap-2.5">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={refChipClass}>{refOf(record.scenarioId)}</span>
                          <h2 className="m-0 min-w-0 text-sm leading-6 font-semibold tracking-normal">
                            自由问题 · 第 {index + 1} 轮
                          </h2>
                        </div>
                        <p className="mt-1 mb-0 text-[11px] text-[var(--subtle)]">
                          {session.model.provider}:{session.model.id}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[11px] tabular-nums ${humanScoreClass(manualReview)}`}>
                        {humanScore(manualReview)}
                      </span>
                    </header>
                    <div className="min-w-0">
                      <TranscriptView
                        turns={[{ question: turn.question, answer: turn.answer, tools: turn.tools }]}
                      />
                      <HumanReviewForm
                        key={manualTarget}
                        targetId={manualTarget}
                        review={manualReview}
                        onSave={persistReview}
                      />
                    </div>
                  </article>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
