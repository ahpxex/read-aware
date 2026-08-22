import { useEffect, useState } from "react";
import {
  fetchRun,
  ms,
  usd,
  type CatalogSuite,
  type RunDetail,
  type RunRecord,
} from "../api";
import { RunReviewWorkspace } from "../components/RunReviewWorkspace";

/** 进行中 run 没有 summary——从已落盘的 records 现场聚合一份等形状的。 */
function synthesizeSummary(
  records: RunRecord[],
  suiteId: string,
): NonNullable<RunDetail["summary"]> {
  const byScenario = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.variantId}\u0000${record.scenarioId}`;
    byScenario.set(key, [...(byScenario.get(key) ?? []), record]);
  }
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    suiteId,
    generatedAt: "",
    runs: records.length,
    passed: records.filter((record) => record.status === "passed").length,
    failed: records.filter((record) => record.status === "failed").length,
    errors: records.filter((record) => record.status === "error").length,
    byScenario: Array.from(byScenario.entries()).map(([key, group]) => ({
      variantId: key.split("\u0000")[0]!,
      scenarioId: key.split("\u0000")[1]!,
      runs: group.length,
      passed: group.filter((record) => record.status === "passed").length,
      meanScore: mean(group.map((record) => record.assessment?.score ?? 0)),
      telemetry: {
        meanWallTimeMs: mean(group.map((record) => record.telemetry.wallTimeMs)),
        meanRounds: mean(group.map((record) => record.telemetry.rounds ?? 0)),
        meanCostUsd: mean(group.map((record) => record.telemetry.costUsd ?? 0)),
      },
    })),
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
    fetchRun(runId, activeRescore || undefined).then(setDetail).catch((cause) => setError(String(cause)));
  }, [runId, activeRescore]);

  // 直播刷新：tick 变化时静默重拉（不清空，避免闪加载态）。
  useEffect(() => {
    if (tick === undefined || tick === 0) return;
    fetchRun(runId, activeRescore || undefined).then(setDetail).catch(() => {});
  }, [runId, activeRescore, tick]);

  if (error) return <div className="error">{error}</div>;
  if (!detail) return <div className="loading">加载运行数据…</div>;

  const { records } = detail;
  const planSuiteId =
    (detail.manifest?.plan as { suiteId?: string } | undefined)?.suiteId ?? runId.split("-")[0]!;
  const summary = detail.summary ?? synthesizeSummary(records, planSuiteId);
  const live = detail.status === "running";
  const suite = catalog.find((entry) => entry.id === summary.suiteId);
  const refOf = (scenarioId: string) => {
    const index = suite?.scenarios.findIndex((scenario) => scenario.id === scenarioId) ?? -1;
    return index >= 0 ? `${suite!.code}.${index + 1}` : summary.suiteId;
  };

  const totalCost = records.reduce((sum, record) => sum + (record.telemetry.costUsd ?? 0), 0);
  const liveBanner = live ? (
    <div className="livebanner">
      <span className="pulse" /> 运行中——已完成 {summary.runs} 个，页面随落盘自动更新
    </div>
  ) : detail.status === "stale" ? (
    <div className="livebanner stale">此 run 未完成且已无写入（可能被中断）——以下为已落盘的部分</div>
  ) : null;
  const totalTokens = records.reduce(
    (sum, record) => sum + (record.telemetry.tokens?.total ?? 0),
    0,
  );
  const git = detail.manifest?.git;
  const variants = detail.manifest?.plan?.variants ?? [];
  const passRate = summary.runs ? summary.passed / summary.runs : 0;

  return (
    <>
      {liveBanner}
      <h1>
        <a href={`#/suites/${summary.suiteId}`} className="refchip" style={{ fontSize: 14 }}>
          {suite?.code ?? summary.suiteId}
        </a>{" "}
        {summary.suiteId} run
      </h1>
      <p className="sub">
        {summary.generatedAt}
        {git?.commit ? ` · ${git.branch ?? ""}@${String(git.commit).slice(0, 8)}${git.dirty ? " (dirty)" : ""}` : ""}
        {variants.map((variant) => {
          const meta = variant.metadata ?? {};
          return ` · ${variant.id}: ${String(meta.provider ?? "")}:${String(meta.model ?? "")} (thinking ${String(
            meta.thinkingLevel ?? "?",
          )})`;
        })}
      </p>
      {(detail.rescores?.length ?? 0) > 0 && (
        <div className="filters">
          <label htmlFor="rescore-view">评分版本</label>
          <select
            id="rescore-view"
            value={activeRescore}
            onChange={(event) => setActiveRescore(event.target.value)}
          >
            <option value="">原始评分</option>
            {detail.rescores!.map((rescore) => (
              <option key={rescore.id} value={rescore.id}>
                {rescore.createdAt ?? rescore.id}
                {rescore.compatibility?.comparable === false ? " · 不可直接对比" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className={`v ${passRate === 1 ? "ok" : "bad"}`}>{Math.round(passRate * 100)}%</div>
          <div className="k">机器通过率</div>
        </div>
        <div className="stat">
          <div className="v">
            {summary.passed}/{summary.runs}
          </div>
          <div className="k">机器通过 / 运行</div>
        </div>
        <div className="stat">
          <div className={`v ${summary.errors ? "bad" : ""}`}>{summary.errors}</div>
          <div className="k">错误</div>
        </div>
        <div className="stat">
          <div className="v">{(totalTokens / 1000).toFixed(1)}k</div>
          <div className="k">tokens</div>
        </div>
        <div className="stat">
          <div className="v">{usd(totalCost)}</div>
          <div className="k">费用</div>
        </div>
      </div>

      <h2>人工评测工作台</h2>
      <RunReviewWorkspace
        runId={runId}
        records={records}
        refOf={refOf}
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

      {variants.length > 1 && (
        <>
          <h2>变体对比</h2>
          {summary.comparisons.length > 0 && (
            <p className="sub">
              {summary.comparisons.map((comparison) => (
                <span key={comparison.candidateVariantId}>
                  {comparison.candidateVariantId} vs baseline：pass{" "}
                  {comparison.passRateDelta >= 0 ? "+" : ""}
                  {(comparison.passRateDelta * 100).toFixed(1)}pp · score{" "}
                  {comparison.meanScoreDelta >= 0 ? "+" : ""}
                  {comparison.meanScoreDelta.toFixed(3)}（配对 {comparison.pairedRuns}）
                  {"　"}
                </span>
              ))}
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>坐标</th>
                <th>场景</th>
                {variants.map((variant) => (
                  <th key={variant.id}>{variant.id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(summary.byScenario.map((entry) => entry.scenarioId ?? ""))).map(
                (scenarioId) => {
                  const cells = variants.map((variant) =>
                    summary.byScenario.find(
                      (entry) => entry.scenarioId === scenarioId && entry.variantId === variant.id,
                    ),
                  );
                  const allPass = cells.every((cell) => cell && cell.passed === cell.runs);
                  return (
                    <tr key={scenarioId} className={allPass ? "" : "attention"}>
                      <td>
                        <span className="refchip">{refOf(scenarioId)}</span>
                      </td>
                      <td className="mono">{scenarioId}</td>
                      {cells.map((cell, index) => (
                        <td key={variants[index]!.id}>
                          {cell && cell.runs > 0 ? (
                            <span className={`badge ${cell.passed === cell.runs ? "ok" : "fail"}`}>
                              {cell.passed}/{cell.runs} · {cell.meanScore.toFixed(2)}
                            </span>
                          ) : (
                            <span className="badge neutral">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </>
      )}

      <h2>场景</h2>
      <table>
        <thead>
          <tr>
            <th>坐标</th>
            <th>场景</th>
            {variants.length > 1 && <th>变体</th>}
            <th>通过</th>
            <th>score</th>
            <th>耗时</th>
            <th>轮次</th>
            <th>费用</th>
          </tr>
        </thead>
        <tbody>
          {summary.byScenario.map((aggregate) => (
            <tr
              key={`${aggregate.variantId ?? ""}-${aggregate.scenarioId}`}
              className={aggregate.passed === aggregate.runs ? "" : "attention"}
            >
              <td>
                <span className="refchip">{refOf(aggregate.scenarioId ?? "")}</span>
              </td>
              <td className="mono">{aggregate.scenarioId}</td>
              {variants.length > 1 && <td className="mono">{aggregate.variantId}</td>}
              <td>
                {aggregate.passed}/{aggregate.runs}
              </td>
              <td className="mono">{aggregate.meanScore.toFixed(2)}</td>
              <td className="mono">{ms(aggregate.telemetry.meanWallTimeMs)}</td>
              <td className="mono">{aggregate.telemetry.meanRounds?.toFixed(1) ?? "—"}</td>
              <td className="mono">{usd(aggregate.telemetry.meanCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

    </>
  );
}
