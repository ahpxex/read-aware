import { useEffect, useState } from "react";
import {
  fetchRun,
  turnsLanguage,
  type CatalogScenario,
  type CatalogSuite,
  type RunDetail,
  type RunListing,
} from "../api";
import { RunReviewWorkspace } from "../components/RunReviewWorkspace";

const refChipClass =
  "inline-block select-all rounded-[5px] bg-[var(--accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]";

function ScenarioDefinition({ scenario }: { scenario: CatalogScenario }) {
  const turns = scenario.input.turns ?? [];
  return (
    <details className="border-b border-[var(--border)]">
      <summary className="flex cursor-pointer items-center gap-2.5 py-2.5">
        <span className={refChipClass}>{scenario.ref}</span>
        <span className="font-mono text-xs font-medium">{scenario.id}</span>
        <span className="rounded-[4px] border border-[var(--border)] px-1.5 font-mono text-[10px] text-[var(--subtle)]">
          {turnsLanguage(turns)}
        </span>
      </summary>
      <div className="pb-4 pl-10 text-xs text-[var(--muted)] max-sm:pl-2">
        <p>{scenario.description}</p>
        {turns.map((turn, index) => (
          <div className="my-2 grid gap-0.5" key={index}>
            <span className="text-[10px] text-[var(--subtle)]">第 {index + 1} 轮</span>
            <strong className="font-medium text-[var(--fg)]">{turn.text}</strong>
          </div>
        ))}
        <details>
          <summary className="cursor-pointer text-[11px] text-[var(--subtle)]">断言与种子数据</summary>
          <pre className="max-h-[360px] overflow-auto">
            {JSON.stringify(
              {
                expectation: scenario.input.expectation,
                criteria: scenario.input.criteria,
                rubric: scenario.input.rubric,
                seed: scenario.input.seed,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </details>
  );
}

export function SuitePage({
  suiteId,
  catalog,
  runs,
  tick,
}: {
  suiteId: string;
  catalog: CatalogSuite[];
  runs: RunListing[];
  tick?: number;
}) {
  const suite = catalog.find((entry) => entry.id === suiteId);
  const history = runs.filter((run) => run.suiteId === suiteId);
  const [selectedRunId, setSelectedRunId] = useState(history[0]?.runId ?? "");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = history[0]?.runId ?? "";
    setSelectedRunId((current) =>
      current && history.some((run) => run.runId === current) ? current : next,
    );
  }, [suiteId, runs]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    setError(null);
    fetchRun(selectedRunId).then(setDetail).catch((cause) => setError(String(cause)));
  }, [selectedRunId]);

  useEffect(() => {
    if (!tick || !selectedRunId) return;
    fetchRun(selectedRunId).then(setDetail).catch(() => {});
  }, [selectedRunId, tick]);

  if (!suite) return <div className="py-6 text-[var(--fail)]">unknown suite: {suiteId}</div>;

  const selectedRun = history.find((run) => run.runId === selectedRunId);
  const refOf = (scenarioId: string) =>
    suite.scenarios.find((scenario) => scenario.id === scenarioId)?.ref ?? suite.code;
  const scenarioOf = (scenarioId: string) =>
    suite.scenarios.find((scenario) => scenario.id === scenarioId);

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-6 max-md:grid">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-normal">
            <span className={`${refChipClass} align-middle text-sm`}>{suite.code}</span>{" "}
            {suite.displayName}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            <span className="mr-2 font-mono text-[11px] text-[var(--subtle)]">{suite.id}</span>
            {suite.description}
          </p>
        </div>
        {history.length > 0 && (
          <label className="grid shrink-0 gap-1 text-[11px] text-[var(--muted)] max-md:w-full">
            <span>评测运行</span>
            <select
              className="max-w-[310px] rounded-[5px] border border-[var(--border)] bg-[var(--bg)] py-1.5 pr-7 pl-2.5 text-xs text-[var(--fg)] max-md:w-full max-md:max-w-none"
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
            >
              {history.map((run, index) => (
                <option key={run.runId} value={run.runId}>
                  {index === 0 ? "最新 · " : ""}
                  {run.generatedAt?.slice(0, 16).replace("T", " ") ?? run.runId} · {run.passed ?? 0}/{run.runs ?? 0}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {selectedRun && (
        <div className="mb-6 flex items-center gap-3 text-xs text-[var(--muted)] max-sm:flex-wrap">
          <span
            className={`font-semibold ${
              selectedRun.passed === selectedRun.runs
                ? "text-[var(--ok)]"
                : "text-[var(--fail)]"
            }`}
          >
            机器 {selectedRun.passed ?? 0}/{selectedRun.runs ?? 0}
          </span>
          <span>{selectedRun.provider}:{selectedRun.model}</span>
          <span>{selectedRun.thinkingLevel}</span>
        </div>
      )}

      {error && <div className="py-6 text-[var(--fail)]">{error}</div>}
      {selectedRunId && !detail && !error && (
        <div className="py-12 text-[var(--subtle)]">加载回答…</div>
      )}
      {detail && (
        <RunReviewWorkspace
          runId={selectedRunId}
          records={detail.records}
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
      )}

      {!selectedRunId && (
        <div className="my-6 border-y border-[var(--border)] py-5">
          <strong>这个套件还没有模型回答</strong>
          <p className="mt-1 text-[var(--muted)]">
            `bun run eval:agent {suite.id}` 跑完后，问题、回答和评分会直接出现在这里。
          </p>
        </div>
      )}

      <details className="mt-8 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-xs text-[var(--muted)]">
          测试定义 · {suite.scenarios.length}
        </summary>
        <div className="mt-2.5">
          {suite.scenarios.map((scenario) => (
            <ScenarioDefinition key={scenario.id} scenario={scenario} />
          ))}
        </div>
      </details>
    </>
  );
}
