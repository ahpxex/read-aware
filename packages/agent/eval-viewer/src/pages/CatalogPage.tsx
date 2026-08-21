import { useEffect, useState } from "react";
import {
  fetchAttention,
  type AttentionItem,
  type CatalogSuite,
  type RunListing,
} from "../api";

function latestBySuite(runs: RunListing[]): Map<string, RunListing> {
  const map = new Map<string, RunListing>();
  for (const run of runs) {
    if (!map.has(run.suiteId)) map.set(run.suiteId, run);
  }
  return map;
}

export function CatalogPage({
  catalog,
  runs,
  tick,
}: {
  catalog: CatalogSuite[];
  runs: RunListing[];
  tick?: number;
}) {
  const totalScenarios = catalog.reduce((sum, suite) => sum + suite.scenarios.length, 0);
  const latest = latestBySuite(runs);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  useEffect(() => {
    fetchAttention().then(setAttention).catch(() => setAttention([]));
  }, [tick]);

  const refOf = (suiteId: string, scenarioId: string): string => {
    const suite = catalog.find((entry) => entry.id === suiteId);
    const index = suite?.scenarios.findIndex((scenario) => scenario.id === scenarioId) ?? -1;
    return suite && index >= 0 ? `${suite.code}.${index + 1}` : suiteId;
  };

  // 各套件最新一次的通过聚合——顶部大盘（进行中/中断的 run 不进聚合）
  const latestList = Array.from(latest.values()).filter((run) => run.status === "complete");
  const latestRuns = latestList.reduce((sum, run) => sum + (run.runs ?? 0), 0);
  const latestPassed = latestList.reduce((sum, run) => sum + (run.passed ?? 0), 0);

  return (
    <>
      <h1>Eval 总览</h1>
      <p className="sub">
        {catalog.length} 个套件 · {totalScenarios} 个场景 · 反馈时用坐标引用场景（如{" "}
        <span className="refchip">S07.3</span>）。
      </p>

      <div className="stats">
        <div className="stat">
          <div className={`v ${latestPassed === latestRuns ? "ok" : "bad"}`}>
            {latestRuns ? Math.round((latestPassed / latestRuns) * 100) : 0}%
          </div>
          <div className="k">最新通过率（各套件最近一次）</div>
        </div>
        <div className="stat">
          <div className="v">
            {latestPassed}/{latestRuns}
          </div>
          <div className="k">通过 / 运行</div>
        </div>
        <div className="stat">
          <div className={`v ${attention?.length ? "bad" : "ok"}`}>{attention?.length ?? "…"}</div>
          <div className="k">当前失败场景</div>
        </div>
        <div className="stat">
          <div className="v">{runs.length}</div>
          <div className="k">历史 run 总数</div>
        </div>
      </div>

      {attention && attention.length > 0 && (
        <>
          <h2>当前失败（各套件最近一次运行）</h2>
          {attention.map((item) => (
            <div
              key={`${item.runId}-${item.scenarioId}`}
              className="attention-card"
              onClick={() => (location.hash = `#/runs/${item.runId}`)}
            >
              <div className="head">
                <span className="refchip">{refOf(item.suiteId, item.scenarioId)}</span>
                <span className="title mono">{item.scenarioId}</span>
                <span className={`badge ${item.status === "error" ? "err" : "fail"}`}>
                  {item.status === "error" ? "错误" : "失败"}
                </span>
                <span className="meta">{item.suiteId}</span>
              </div>
              <ul className="checks">
                {item.failedChecks.slice(0, 3).map((check) => (
                  <li key={check.id}>
                    <span className="mono">{check.id}</span> — {check.message}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <h2>套件</h2>
      <table>
        <thead>
          <tr>
            <th>编号</th>
            <th>套件</th>
            <th>测什么</th>
            <th>场景数</th>
            <th>最近一次</th>
          </tr>
        </thead>
        <tbody>
          {catalog.map((suite) => {
            const run = latest.get(suite.id);
            const healthy = run && run.passed === run.runs;
            return (
              <tr key={suite.id} className="link" onClick={() => (location.hash = `#/suites/${suite.id}`)}>
                <td className="mono">{suite.code}</td>
                <td className="mono">{suite.id}</td>
                <td>{suite.description}</td>
                <td>{suite.scenarios.length}</td>
                <td>
                  {run ? (
                    run.status === "complete" ? (
                      <span className={`badge ${healthy ? "ok" : "fail"}`}>
                        {run.passed}/{run.runs}
                      </span>
                    ) : (
                      <span className={`badge ${run.status === "running" ? "running" : "neutral"}`}>
                        {run.status === "running" ? `跑 ${run.runs ?? 0}/${run.total ?? "?"}` : "中断"}
                      </span>
                    )
                  ) : (
                    <span className="badge neutral">未跑过</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>最近运行</h2>
      <table>
        <thead>
          <tr>
            <th>run</th>
            <th>套件</th>
            <th>结果</th>
            <th>模型</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {runs.slice(0, 30).map((run) => (
            <tr
              key={run.runId}
              className={`link ${run.passed !== run.runs ? "attention" : ""}`}
              onClick={() => (location.hash = `#/runs/${run.runId}`)}
            >
              <td className="mono">{run.runId}</td>
              <td className="mono">{run.suiteId}</td>
              <td>
                {run.status === "running" ? (
                  <span className="badge running">跑 {run.runs ?? 0}/{run.total ?? "?"}</span>
                ) : run.status === "stale" ? (
                  <span className="badge neutral">中断 {run.runs ?? 0}/{run.total ?? "?"}</span>
                ) : (
                  <span className={`badge ${run.passed === run.runs ? "ok" : "fail"}`}>
                    {run.passed ?? "?"}/{run.runs ?? "?"}
                  </span>
                )}
                {run.errors ? <span className="badge err"> {run.errors} 错误</span> : null}
              </td>
              <td className="mono">
                {run.provider}:{run.model} · {run.thinkingLevel}
              </td>
              <td className="mono">{run.generatedAt?.slice(0, 19).replace("T", " ") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
