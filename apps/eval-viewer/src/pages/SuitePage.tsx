import type { CatalogScenario, CatalogSuite, RunListing } from "../api";

/** 场景定义的"怎么测"视图：轮次原文 + 断言/评分标准 + 种子摘要。 */
function ScenarioCard({ scenario }: { scenario: CatalogScenario }) {
  const { input } = scenario;
  const turns = input.turns ?? [];
  return (
    <details className="card">
      <summary>
        <span className="refchip">{scenario.ref}</span>
        <span className="title mono">{scenario.id}</span>
        <span className="meta">
          {turns.length} turn{turns.length === 1 ? "" : "s"}
        </span>
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

        <div className="section-label">Turns (what the reader says)</div>
        {turns.map((turn, index) => (
          <div key={index}>
            <div className="who">reader · turn {index + 1}</div>
            <div className="bubble">
              {turn.text}
              {turn.attachments?.length ? (
                <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
                  selection: “{turn.attachments[0]!.text.slice(0, 120)}
                  {turn.attachments[0]!.text.length > 120 ? "…" : ""}”
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {input.expectation !== undefined && Object.keys(input.expectation as object).length > 0 && (
          <>
            <div className="section-label">Deterministic expectation</div>
            <pre>{JSON.stringify(input.expectation, null, 2)}</pre>
          </>
        )}
        {input.criteria !== undefined && (
          <>
            <div className="section-label">Criteria (custom checks)</div>
            <pre>{JSON.stringify(input.criteria, null, 2)}</pre>
          </>
        )}
        {input.rubric?.length ? (
          <>
            <div className="section-label">Judge rubric (scored with --judge)</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {input.rubric.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
        {input.seed !== undefined && (
          <>
            <div className="section-label">Seed (world state)</div>
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

      <h2>
        Scenarios · {suite.scenarios.length}
      </h2>
      {suite.scenarios.map((scenario) => (
        <ScenarioCard key={scenario.id} scenario={scenario} />
      ))}

      <h2>Run history</h2>
      {history.length === 0 ? (
        <p className="sub">This suite has not been run yet — `bun run eval:agent {suite.id}`.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>run</th>
              <th>result</th>
              <th>model</th>
              <th>when</th>
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
