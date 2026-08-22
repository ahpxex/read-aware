import { useEffect, useState } from "react";
import {
  fetchRun,
  usd,
  type CatalogSuite,
  type RunDetail,
  type RunRecord,
} from "../api";
import { RunReviewWorkspace } from "../components/RunReviewWorkspace";

const refChipClass =
  "inline-block select-all rounded-[5px] bg-[var(--accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]";

function synthesizeSummary(
  records: RunRecord[],
  suiteId: string,
): NonNullable<RunDetail["summary"]> {
  return {
    suiteId,
    generatedAt: "",
    runs: records.length,
    passed: records.filter((record) => record.status === "passed").length,
    failed: records.filter((record) => record.status === "failed").length,
    errors: records.filter((record) => record.status === "error").length,
    byScenario: [],
    comparisons: [],
  };
}

export function RunPage({
  runId,
  catalog,
  tick,
}: {
  runId: string;
  catalog: CatalogSuite[];
  tick?: number;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRescore, setActiveRescore] = useState("");

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetchRun(runId, activeRescore || undefined).then(setDetail).catch((cause) => setError(String(cause)));
  }, [runId, activeRescore]);

  useEffect(() => {
    if (!tick) return;
    fetchRun(runId, activeRescore || undefined).then(setDetail).catch(() => {});
  }, [runId, activeRescore, tick]);

  if (error) return <div className="py-6 text-[var(--fail)]">{error}</div>;
  if (!detail) return <div className="py-12 text-[var(--subtle)]">加载回答…</div>;

  const { records } = detail;
  const planSuiteId =
    detail.manifest?.plan?.suiteId ?? runId.split("-")[0]!;
  const summary = detail.summary ?? synthesizeSummary(records, planSuiteId);
  const suite = catalog.find((entry) => entry.id === summary.suiteId);
  const refOf = (scenarioId: string) => {
    const index = suite?.scenarios.findIndex((scenario) => scenario.id === scenarioId) ?? -1;
    return index >= 0 ? `${suite!.code}.${index + 1}` : summary.suiteId;
  };
  const scenarioOf = (scenarioId: string) =>
    suite?.scenarios.find((scenario) => scenario.id === scenarioId);
  const totalCost = records.reduce((sum, record) => sum + (record.telemetry.costUsd ?? 0), 0);
  const totalTokens = records.reduce(
    (sum, record) => sum + (record.telemetry.tokens?.total ?? 0),
    0,
  );
  const variants = detail.manifest?.plan?.variants ?? [];
  const git = detail.manifest?.git;

  return (
    <>
      {detail.status === "running" && (
        <div className="mb-4 flex items-center gap-2 rounded-[6px] border border-[#0070f359] bg-[#0070f314] px-3.5 py-2.5 text-[13px] text-[#0070f3]">
          <span className="live-pulse h-2 w-2 rounded-full bg-[#0070f3]" /> 运行中 · 已完成 {summary.runs}
        </div>
      )}
      {detail.status === "stale" && (
        <div className="mb-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] text-[var(--muted)]">
          这个 run 已中断，以下是已落盘的回答。
        </div>
      )}

      <header className="mb-4 flex items-start justify-between gap-6 max-md:grid">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-normal">
            <a href={`#/suites/${summary.suiteId}`} className={`${refChipClass} align-middle text-sm`}>
              {suite?.code ?? summary.suiteId}
            </a>{" "}
            {suite?.displayName ?? summary.suiteDisplayName ?? detail.manifest?.plan?.suiteDisplayName ?? summary.suiteId}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            <span className="mr-2 font-mono text-[11px] text-[var(--subtle)]">{summary.suiteId}</span>
            {summary.generatedAt || runId}
          </p>
        </div>
        {(detail.rescores?.length ?? 0) > 0 && (
          <label className="grid shrink-0 gap-1 text-[11px] text-[var(--muted)] max-md:w-full">
            <span>评分版本</span>
            <select
              className="max-w-[310px] rounded-[5px] border border-[var(--border)] bg-[var(--bg)] py-1.5 pr-7 pl-2.5 text-xs text-[var(--fg)] max-md:w-full max-md:max-w-none"
              value={activeRescore}
              onChange={(event) => setActiveRescore(event.target.value)}
            >
              <option value="">原始评分</option>
              {detail.rescores!.map((rescore) => (
                <option key={rescore.id} value={rescore.id}>
                  {rescore.createdAt ?? rescore.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="mb-6 flex items-center gap-3 text-xs text-[var(--muted)] max-sm:flex-wrap">
        <span
          className={`font-semibold ${
            summary.passed === summary.runs
              ? "text-[var(--ok)]"
              : "text-[var(--fail)]"
          }`}
        >
          机器 {summary.passed}/{summary.runs}
        </span>
        <span>{totalTokens.toLocaleString()} tokens</span>
        <span>{usd(totalCost)}</span>
      </div>

      <RunReviewWorkspace
        runId={runId}
        records={records}
        refOf={refOf}
        scenarioOf={scenarioOf}
        humanReviews={detail.humanReviews ?? {}}
        manualSessions={detail.manualSessions ?? []}
        onReviewChange={(review) =>
          setDetail((current) =>
            current
              ? {
                  ...current,
                  humanReviews: { ...(current.humanReviews ?? {}), [review.targetId]: review },
                }
              : current,
          )
        }
        onManualSessionChange={(session) =>
          setDetail((current) => {
            if (!current) return current;
            const sessions = [...(current.manualSessions ?? [])];
            const index = sessions.findIndex((entry) => entry.id === session.id);
            if (index >= 0) sessions[index] = session;
            else sessions.unshift(session);
            return { ...current, manualSessions: sessions };
          })
        }
      />

      <details className="mt-8 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-xs text-[var(--muted)]">运行信息</summary>
        <dl className="mt-3 grid grid-cols-[90px_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
          <dt className="text-[var(--subtle)]">Run</dt>
          <dd className="m-0 whitespace-pre-wrap">{runId}</dd>
          <dt className="text-[var(--subtle)]">Git</dt>
          <dd className="m-0 whitespace-pre-wrap">
            {git?.commit
              ? `${git.branch ?? ""}@${String(git.commit).slice(0, 8)}${git.dirty ? " (dirty)" : ""}`
              : "—"}
          </dd>
          <dt className="text-[var(--subtle)]">模型</dt>
          <dd className="m-0 whitespace-pre-wrap">
            {variants
              .map((variant) => {
                const meta = variant.metadata ?? {};
                return `${variant.id}: ${String(meta.provider ?? "")}:${String(meta.model ?? "")} · ${String(meta.thinkingLevel ?? "")}`;
              })
              .join("\n") || "—"}
          </dd>
          <dt className="text-[var(--subtle)]">机器结果</dt>
          <dd className="m-0 whitespace-pre-wrap">
            {summary.passed} 通过 · {summary.failed} 失败 · {summary.errors} 错误
          </dd>
        </dl>
      </details>
    </>
  );
}
