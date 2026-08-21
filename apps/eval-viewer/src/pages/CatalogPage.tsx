import type { CatalogSuite, RunListing } from "../api";

function latestBySuite(runs: RunListing[]): Map<string, RunListing> {
  const map = new Map<string, RunListing>();
  for (const run of runs) {
    if (!map.has(run.suiteId)) map.set(run.suiteId, run);
  }
  return map;
}

export function CatalogPage({ catalog, runs }: { catalog: CatalogSuite[]; runs: RunListing[] }) {
  const totalScenarios = catalog.reduce((sum, suite) => sum + suite.scenarios.length, 0);
  const latest = latestBySuite(runs);

  return (
    <>
      <h1>Eval catalog</h1>
      <p className="sub">
        {catalog.length} suites · {totalScenarios} scenarios · reference any scenario by its
        coordinate (e.g. <span className="refchip">S07.3</span>) when reporting feedback.
      </p>

      <h2>Suites</h2>
      <table>
        <thead>
          <tr>
            <th>code</th>
            <th>suite</th>
            <th>what it tests</th>
            <th>scenarios</th>
            <th>latest run</th>
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
                    <span className={`badge ${healthy ? "ok" : "fail"}`}>
                      {run.passed}/{run.runs}
                    </span>
                  ) : (
                    <span className="badge neutral">never</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Recent runs</h2>
      <table>
        <thead>
          <tr>
            <th>run</th>
            <th>suite</th>
            <th>result</th>
            <th>model</th>
            <th>when</th>
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
                <span className={`badge ${run.passed === run.runs ? "ok" : "fail"}`}>
                  {run.passed ?? "?"}/{run.runs ?? "?"}
                </span>
                {run.errors ? <span className="badge err"> {run.errors} err</span> : null}
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
