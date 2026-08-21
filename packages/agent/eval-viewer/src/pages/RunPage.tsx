import { useEffect, useState } from "react";
import { marked } from "marked";
import {
  fetchRun,
  ms,
  usd,
  type CatalogSuite,
  type RunDetail,
  type RunRecord,
} from "../api";

function RunCard({ record, refOf }: { record: RunRecord; refOf: (scenarioId: string) => string }) {
  const checks = record.assessment?.checks ?? [];
  const failedFirst = [...checks].sort((a, b) => Number(a.passed) - Number(b.passed));
  const turns = record.output?.turns ?? [];
  const tools = record.output?.tools ?? [];
  const badge =
    record.status === "passed" ? "ok" : record.status === "failed" ? "fail" : "err";

  return (
    <details className="card" data-status={record.status}>
      <summary>
        <span className={`badge ${badge}`}>{record.status}</span>
        <span className="refchip">{refOf(record.scenarioId)}</span>
        <span className="title mono">{record.scenarioId}</span>
        <span className="meta">
          #{record.repetition} · score {record.assessment ? record.assessment.score.toFixed(2) : "—"} ·{" "}
          {ms(record.telemetry.wallTimeMs)} · {record.telemetry.rounds ?? "—"} rounds · {tools.length}{" "}
          tools · {usd(record.telemetry.costUsd)}
        </span>
      </summary>
      <div className="cardbody">
        {record.error && (
          <pre style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>
            {record.error.stage} · {record.error.name}: {record.error.message}
          </pre>
        )}
        {failedFirst.length > 0 && (
          <ul className="checks">
            {failedFirst.map((check) => (
              <li key={check.id + check.message} className={`check ${check.passed ? "ok" : "fail"}`}>
                <span className="dot" />
                <span className="cat">{check.category}</span>
                <span className="cid">{check.id}</span>
                <span>{check.message}</span>
                {(check.expected !== undefined || check.actual !== undefined) && (
                  <pre className="kv">
                    {check.expected !== undefined && `expected: ${JSON.stringify(check.expected)}\n`}
                    {check.actual !== undefined && `actual:   ${JSON.stringify(check.actual)}`}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
        {turns.map((turn, index) => (
          <div key={index}>
            <div className="who">读者 · 第 {index + 1} 轮</div>
            <div className="bubble">{turn.input?.text ?? ""}</div>
            <div className="who">agent</div>
            <div
              className="bubble answer md"
              // 本地可信工件（自己的 eval 输出）——marked 直接渲染。
              dangerouslySetInnerHTML={{ __html: marked.parse(turn.answer ?? "", { async: false }) }}
            />
          </div>
        ))}
        {tools.length > 0 && (
          <>
            <div className="section-label">工具调用</div>
            {tools.map((tool, index) => {
              const args = tool.args === undefined ? "" : JSON.stringify(tool.args);
              return (
                <details key={index} className={`tool ${tool.isError ? "fail" : ""}`}>
                  <summary>
                    <code>{tool.name}</code>{" "}
                    <span className="args">{args.length > 200 ? `${args.slice(0, 200)}…` : args}</span>
                    {tool.isError && <span className="badge fail"> error</span>}
                  </summary>
                  {tool.output && (
                    <pre>{tool.output.length > 600 ? `${tool.output.slice(0, 600)}…` : tool.output}</pre>
                  )}
                </details>
              );
            })}
          </>
        )}
      </div>
    </details>
  );
}

export function RunPage({ runId, catalog }: { runId: string; catalog: CatalogSuite[] }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    setDetail(null);
    fetchRun(runId).then(setDetail).catch((cause) => setError(String(cause)));
  }, [runId]);

  if (error) return <div className="error">{error}</div>;
  if (!detail?.summary) return <div className="loading">加载运行数据…</div>;

  const { summary, records } = detail;
  const suite = catalog.find((entry) => entry.id === summary.suiteId);
  const refOf = (scenarioId: string) => {
    const index = suite?.scenarios.findIndex((scenario) => scenario.id === scenarioId) ?? -1;
    return index >= 0 ? `${suite!.code}.${index + 1}` : summary.suiteId;
  };

  const totalCost = records.reduce((sum, record) => sum + (record.telemetry.costUsd ?? 0), 0);
  const totalTokens = records.reduce(
    (sum, record) => sum + (record.telemetry.tokens?.total ?? 0),
    0,
  );
  const git = detail.manifest?.git;
  const variants = detail.manifest?.plan?.variants ?? [];
  const passRate = summary.runs ? summary.passed / summary.runs : 0;

  const ordered = [...records].sort((a, b) => {
    const rank = (record: RunRecord) =>
      record.status === "error" ? 0 : record.status === "failed" ? 1 : 2;
    return rank(a) - rank(b) || a.scenarioId.localeCompare(b.scenarioId) || a.repetition - b.repetition;
  });
  const visible = failedOnly ? ordered.filter((record) => record.status !== "passed") : ordered;

  return (
    <>
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

      <div className="stats">
        <div className="stat">
          <div className={`v ${passRate === 1 ? "ok" : "bad"}`}>{Math.round(passRate * 100)}%</div>
          <div className="k">通过率</div>
        </div>
        <div className="stat">
          <div className="v">
            {summary.passed}/{summary.runs}
          </div>
          <div className="k">通过 / 运行</div>
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

      <h2>场景</h2>
      <table>
        <thead>
          <tr>
            <th>坐标</th>
            <th>场景</th>
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
              key={aggregate.scenarioId}
              className={aggregate.passed === aggregate.runs ? "" : "attention"}
            >
              <td>
                <span className="refchip">{refOf(aggregate.scenarioId ?? "")}</span>
              </td>
              <td className="mono">{aggregate.scenarioId}</td>
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

      <h2>逐条运行</h2>
      <div className="filters">
        <button className={failedOnly ? "" : "active"} onClick={() => setFailedOnly(false)}>
          全部
        </button>
        <button className={failedOnly ? "active" : ""} onClick={() => setFailedOnly(true)}>
          只看失败与错误
        </button>
      </div>
      {visible.map((record) => (
        <RunCard
          key={`${record.scenarioId}-${record.variantId}-${record.repetition}`}
          record={record}
          refOf={refOf}
        />
      ))}
    </>
  );
}
