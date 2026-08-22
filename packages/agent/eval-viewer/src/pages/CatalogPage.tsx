import { useEffect, useState } from "react";
import {
  fetchAttention,
  type AttentionItem,
  type CatalogSuite,
  type RunListing,
} from "../api";

const refChipClass =
  "inline-block select-all rounded-[5px] bg-[var(--accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]";
const tableClass = "w-full min-w-[720px] border-collapse text-[13px]";
const thClass =
  "border-b border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-left text-xs font-medium text-[var(--muted)]";
const tdClass =
  "border-b border-[var(--border)] px-3.5 py-2 align-top tabular-nums group-last:border-b-0 group-hover:bg-[var(--surface)]";

function statusClass(tone: "ok" | "fail" | "error" | "neutral" | "running"): string {
  const base = "inline-block rounded-[4px] border px-2 py-0.5 text-[11px] font-medium";
  if (tone === "ok") return `${base} border-transparent bg-[var(--ok-bg)] text-[var(--ok)]`;
  if (tone === "fail") return `${base} border-transparent bg-[var(--fail-bg)] text-[var(--fail)]`;
  if (tone === "error") return `${base} border-transparent bg-[var(--err-bg)] text-[var(--err)]`;
  if (tone === "running") return `${base} live-pulse border-[#0070f34d] bg-[#0070f324] text-[#0070f3]`;
  return `${base} border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]`;
}

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
  const activeSuiteIds = new Set(catalog.map((suite) => suite.id));
  const visibleRuns = runs.filter((run) => activeSuiteIds.has(run.suiteId));
  const latest = latestBySuite(visibleRuns);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  useEffect(() => {
    fetchAttention().then(setAttention).catch(() => setAttention([]));
  }, [tick]);

  const refOf = (suiteId: string, scenarioId: string): string => {
    const suite = catalog.find((entry) => entry.id === suiteId);
    const index = suite?.scenarios.findIndex((scenario) => scenario.id === scenarioId) ?? -1;
    return suite && index >= 0 ? `${suite.code}.${index + 1}` : suiteId;
  };
  const suiteName = (suiteId: string): string =>
    catalog.find((suite) => suite.id === suiteId)?.displayName ?? suiteId;
  const visibleAttention = (attention ?? []).filter((item) => activeSuiteIds.has(item.suiteId));

  // 各套件最新一次的通过聚合——顶部大盘（进行中/中断的 run 不进聚合）
  const latestList = Array.from(latest.values()).filter((run) => run.status === "complete");
  const latestRuns = latestList.reduce((sum, run) => sum + (run.runs ?? 0), 0);
  const latestPassed = latestList.reduce((sum, run) => sum + (run.passed ?? 0), 0);

  return (
    <>
      <h1 className="m-0 text-2xl font-semibold tracking-normal">Eval 总览</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        {catalog.length} 个套件 · {totalScenarios} 个场景 · 反馈时用坐标引用场景（如{" "}
        <span className={refChipClass}>S07.3</span>）。
      </p>

      <div className="my-6 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--border)] max-sm:grid-cols-2">
        <div className="bg-[var(--bg)] px-4 py-4">
          <div className={`text-[22px] font-semibold tabular-nums ${latestPassed === latestRuns ? "text-[var(--ok)]" : "text-[var(--fail)]"}`}>
            {latestRuns ? Math.round((latestPassed / latestRuns) * 100) : 0}%
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">最新通过率（各套件最近一次）</div>
        </div>
        <div className="bg-[var(--bg)] px-4 py-4">
          <div className="text-[22px] font-semibold tabular-nums">
            {latestPassed}/{latestRuns}
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">通过 / 运行</div>
        </div>
        <div className="bg-[var(--bg)] px-4 py-4">
          <div className={`text-[22px] font-semibold tabular-nums ${visibleAttention.length ? "text-[var(--fail)]" : "text-[var(--ok)]"}`}>
            {attention === null ? "…" : visibleAttention.length}
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">当前失败场景</div>
        </div>
        <div className="bg-[var(--bg)] px-4 py-4">
          <div className="text-[22px] font-semibold tabular-nums">{visibleRuns.length}</div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">当前套件历史 run 总数</div>
        </div>
      </div>

      {visibleAttention.length > 0 && (
        <>
          <h2 className="mt-9 mb-3 text-[15px] font-semibold tracking-normal">当前失败（各套件最近一次运行）</h2>
          {visibleAttention.map((item) => (
            <a
              key={`${item.runId}-${item.scenarioId}`}
              className="mb-2 block rounded-[6px] border border-[var(--fail)] bg-[var(--fail-bg)] px-4 py-3 transition-opacity hover:opacity-90"
              href={`#/runs/${item.runId}`}
            >
              <div className="flex items-center gap-2.5">
                <span className={refChipClass}>{refOf(item.suiteId, item.scenarioId)}</span>
                <span className="font-mono text-xs font-medium">{item.scenarioId}</span>
                <span className={statusClass(item.status === "error" ? "error" : "fail")}>
                  {item.status === "error" ? "错误" : "失败"}
                </span>
                <span className="ml-auto text-xs text-[var(--subtle)]">{suiteName(item.suiteId)}</span>
              </div>
              <ul className="mt-1.5 mb-0 list-disc pl-4 text-xs text-[var(--fail)]">
                {item.failedChecks.slice(0, 3).map((check) => (
                  <li key={check.id}>
                    <span className="font-mono text-xs">{check.id}</span> - {check.message}
                  </li>
                ))}
              </ul>
            </a>
          ))}
        </>
      )}

      <h2 className="mt-9 mb-3 text-[15px] font-semibold tracking-normal">套件</h2>
      <div className="overflow-x-auto rounded-[6px] border border-[var(--border)]">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>编号</th>
              <th className={thClass}>套件</th>
              <th className={thClass}>测什么</th>
              <th className={thClass}>场景数</th>
              <th className={thClass}>最近一次</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((suite) => {
              const run = latest.get(suite.id);
              const healthy = run && run.passed === run.runs;
              const href = `#/suites/${suite.id}`;
              return (
                <tr
                  key={suite.id}
                  className="group cursor-pointer"
                  role="link"
                  tabIndex={0}
                  aria-label={`打开 ${suite.id} 套件`}
                  onClick={() => (location.hash = href.slice(1))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") location.hash = href.slice(1);
                  }}
                >
                  <td className={`${tdClass} font-mono text-xs`}>{suite.code}</td>
                  <td className={tdClass}>
                    <div className="font-medium">{suite.displayName}</div>
                    <div className="font-mono text-[11px] text-[var(--subtle)]">{suite.id}</div>
                  </td>
                  <td className={tdClass}>{suite.description}</td>
                  <td className={tdClass}>{suite.scenarios.length}</td>
                  <td className={tdClass}>
                    {run ? (
                      run.status === "complete" ? (
                        <span className={statusClass(healthy ? "ok" : "fail")}>
                          {run.passed}/{run.runs}
                        </span>
                      ) : (
                        <span className={statusClass(run.status === "running" ? "running" : "neutral")}>
                          {run.status === "running" ? `跑 ${run.runs ?? 0}/${run.total ?? "?"}` : "中断"}
                        </span>
                      )
                    ) : (
                      <span className={statusClass("neutral")}>未跑过</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-9 mb-3 text-[15px] font-semibold tracking-normal">最近运行</h2>
      <div className="overflow-x-auto rounded-[6px] border border-[var(--border)]">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>run</th>
              <th className={thClass}>套件</th>
              <th className={thClass}>结果</th>
              <th className={thClass}>模型</th>
              <th className={thClass}>时间</th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.slice(0, 30).map((run) => {
              const href = `#/runs/${run.runId}`;
              return (
                <tr
                  key={run.runId}
                  className={`group cursor-pointer ${run.passed !== run.runs ? "shadow-[inset_2px_0_0_var(--fail)]" : ""}`}
                  role="link"
                  tabIndex={0}
                  aria-label={`打开运行 ${run.runId}`}
                  onClick={() => (location.hash = href.slice(1))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") location.hash = href.slice(1);
                  }}
                >
                  <td className={`${tdClass} font-mono text-xs`}>{run.runId}</td>
                  <td className={tdClass}>
                    <div>{suiteName(run.suiteId)}</div>
                    <div className="font-mono text-[11px] text-[var(--subtle)]">{run.suiteId}</div>
                  </td>
                  <td className={tdClass}>
                    {run.status === "running" ? (
                      <span className={statusClass("running")}>跑 {run.runs ?? 0}/{run.total ?? "?"}</span>
                    ) : run.status === "stale" ? (
                      <span className={statusClass("neutral")}>中断 {run.runs ?? 0}/{run.total ?? "?"}</span>
                    ) : (
                      <span className={statusClass(run.passed === run.runs ? "ok" : "fail")}>
                        {run.passed ?? "?"}/{run.runs ?? "?"}
                      </span>
                    )}
                    {run.errors ? (
                      <span className={`${statusClass("error")} ml-1.5`}>{run.errors} 错误</span>
                    ) : null}
                  </td>
                  <td className={`${tdClass} font-mono text-xs`}>
                    {run.provider}:{run.model} · {run.thinkingLevel}
                  </td>
                  <td className={`${tdClass} font-mono text-xs`}>
                    {run.generatedAt?.slice(0, 19).replace("T", " ") ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
