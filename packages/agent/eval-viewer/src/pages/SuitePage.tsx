import { turnsLanguage, type CatalogScenario, type CatalogSuite, type RunListing } from "../api";

/** 场景定义的"怎么测"视图：轮次原文 + 断言/评分标准 + 种子摘要。 */
function ScenarioCard({ scenario }: { scenario: CatalogScenario }) {
  const { input } = scenario;
  const turns = input.turns ?? [];
  return (
    <details className="card">
      <summary>
        <span className="refchip">{scenario.ref}</span>
        <span className="title mono">{scenario.id}</span>
        <span className="langbadge">{turnsLanguage(turns)}</span>
        <span className="meta">{turns.length} 轮</span>
      </summary>
      <div className="cardbody">
        <p className="sub">{scenario.description}</p>
        <div style={{ margin: "8px 0" }}>
          {scenario.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="section-label">轮次（读者原话）</div>
        {turns.map((turn, index) => (
          <div key={index}>
            <div className="who">读者 · 第 {index + 1} 轮</div>
            <div className="bubble">
              {turn.text}
              {turn.attachments?.length ? (
                <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
                  选区：“{turn.attachments[0]!.text.slice(0, 120)}
                  {turn.attachments[0]!.text.length > 120 ? "…" : ""}”
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {input.expectation !== undefined && Object.keys(input.expectation as object).length > 0 && (
          <>
            <div className="section-label">确定性断言</div>
            <pre>{JSON.stringify(input.expectation, null, 2)}</pre>
          </>
        )}
        {input.criteria !== undefined && (
          <>
            <div className="section-label">自定义检查（criteria）</div>
            <pre>{JSON.stringify(input.criteria, null, 2)}</pre>
          </>
        )}
        {input.rubric?.length ? (
          <>
            <div className="section-label">评分标准（--judge 时由 LLM judge 评）</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {input.rubric.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
        {input.seed !== undefined && (
          <>
            <div className="section-label">种子世界态（seed）</div>
            <pre>{JSON.stringify(input.seed, null, 2).slice(0, 1200)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

export function SuitePage({
  suiteId,
  catalog,
  runs,
}: {
  suiteId: string;
  catalog: CatalogSuite[];
  runs: RunListing[];
}) {
  const suite = catalog.find((entry) => entry.id === suiteId);
  if (!suite) return <div className="error">unknown suite: {suiteId}</div>;
  const history = runs.filter((run) => run.suiteId === suiteId);

  return (
    <>
      <h1>
        <span className="refchip" style={{ fontSize: 14, verticalAlign: "middle" }}>
          {suite.code}
        </span>{" "}
        {suite.id}
      </h1>
      <p className="sub">{suite.description}</p>

      <h2>场景 · {suite.scenarios.length}</h2>
      {suite.scenarios.map((scenario) => (
        <ScenarioCard key={scenario.id} scenario={scenario} />
      ))}

      <h2>运行历史</h2>
      {history.length === 0 ? (
        <p className="sub">这个套件还没跑过 —— `bun run eval:agent {suite.id}`。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>run</th>
              <th>结果</th>
              <th>模型</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {history.map((run) => (
              <tr
                key={run.runId}
                className={`link ${run.passed !== run.runs ? "attention" : ""}`}
                onClick={() => (location.hash = `#/runs/${run.runId}`)}
              >
                <td className="mono">{run.runId}</td>
                <td>
                  <span className={`badge ${run.passed === run.runs ? "ok" : "fail"}`}>
                    {run.passed ?? "?"}/{run.runs ?? "?"}
                  </span>
                </td>
                <td className="mono">
                  {run.provider}:{run.model} · {run.thinkingLevel}
                </td>
                <td className="mono">{run.generatedAt?.slice(0, 19).replace("T", " ") ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
