import { useMemo, useState } from "react";
import { ms, saveHumanReview, usd, type RunRecord } from "../api";
import type { HumanReview, ManualReviewSession } from "../reviews";
import { HumanReviewForm } from "./HumanReviewForm";
import { ManualSessionPanel } from "./ManualSessionPanel";
import { TranscriptView } from "./TranscriptView";

type Selection = { kind: "run" | "manual"; id: string };
type ReviewFilter = "all" | "unreviewed" | "concerns";

function runTargetId(record: RunRecord): string {
  return `run:${record.id}`;
}

function manualTargetId(turnId: string): string {
  return `manual:${turnId}`;
}

function verdictLabel(review: HumanReview | undefined): string {
  if (review?.verdict === "pass") return "满意";
  if (review?.verdict === "partial") return "有保留";
  if (review?.verdict === "fail") return "不满意";
  return "未评";
}

export function RunReviewWorkspace({
  runId,
  records,
  refOf,
  humanReviews,
  manualSessions,
  onReviewChange,
  onManualSessionChange,
}: {
  runId: string;
  records: RunRecord[];
  refOf: (scenarioId: string) => string;
  humanReviews: Record<string, HumanReview>;
  manualSessions: ManualReviewSession[];
  onReviewChange: (review: HumanReview) => void;
  onManualSessionChange: (session: ManualReviewSession) => void;
}) {
  const ordered = useMemo(
    () =>
      [...records].sort((a, b) => {
        const rank = (record: RunRecord) =>
          record.status === "error" ? 0 : record.status === "failed" ? 1 : 2;
        return rank(a) - rank(b) || a.scenarioId.localeCompare(b.scenarioId) || a.repetition - b.repetition;
      }),
    [records],
  );
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selection, setSelection] = useState<Selection>(() => ({ kind: "run", id: ordered[0]?.id ?? "" }));
  const [manualTurnIndex, setManualTurnIndex] = useState(0);

  const visibleRecords = ordered.filter((record) => {
    const review = humanReviews[runTargetId(record)];
    if (filter === "unreviewed") return !review?.verdict;
    if (filter === "concerns") return review?.verdict === "partial" || review?.verdict === "fail";
    return true;
  });
  const selectedRecord =
    selection.kind === "run" ? records.find((record) => record.id === selection.id) : undefined;
  const selectedSession =
    selection.kind === "manual"
      ? manualSessions.find((session) => session.id === selection.id)
      : undefined;
  const sessionBase = selectedSession
    ? records.find(
        (record) =>
          record.scenarioId === selectedSession.scenarioId &&
          record.variantId === selectedSession.variantId,
      )
    : undefined;
  const activeRecord = selectedRecord ?? sessionBase ?? visibleRecords[0];
  const selectedManualTurn =
    selectedSession?.turns[manualTurnIndex] ??
    selectedSession?.turns[(selectedSession?.turns.length ?? 0) - 1];

  const fixedTurns = (activeRecord?.output?.turns ?? []).map((turn, index) => ({
    question: turn.input?.text ?? "",
    answer: turn.answer ?? "",
    selection: turn.input?.attachments?.[0]?.text,
    cursor: turn.input?.readingCursor,
    tools: (activeRecord?.output?.tools ?? []).filter(
      (tool) => tool.turn === undefined || tool.turn === index + 1,
    ),
  }));
  const manualTurns = (selectedSession?.turns ?? []).map((turn) => ({
    question: turn.question,
    answer: turn.answer,
    tools: turn.tools,
  }));
  const reviewed = Object.values(humanReviews).filter((review) => review.targetId.startsWith("run:") && review.verdict);
  const humanPass = reviewed.filter((review) => review.verdict === "pass").length;
  const humanConcerns = reviewed.filter((review) => review.verdict !== "pass").length;

  if (!activeRecord) return <p className="sub">这个 run 还没有已完成的样本。</p>;

  const openManual = (sessionId: string) => {
    const session = manualSessions.find((entry) => entry.id === sessionId);
    setManualTurnIndex(Math.max(0, (session?.turns.length ?? 1) - 1));
    setSelection({ kind: "manual", id: sessionId });
  };

  return (
    <div className="review-area">
      <div className="human-summary">
        <span>人工评测</span>
        <strong>{reviewed.length}/{records.length}</strong>
        <span className="human-good">满意 {humanPass}</span>
        <span className={humanConcerns ? "human-bad" : ""}>有问题 {humanConcerns}</span>
        <span>自由会话 {manualSessions.length}</span>
      </div>
      <div className="review-toolbar">
        <div className="segmented-control" aria-label="人工评测筛选">
          {([
            ["all", "全部"],
            ["unreviewed", "待人工评测"],
            ["concerns", "有问题"],
          ] as const).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="review-workspace">
        <aside className="review-index" aria-label="运行样本">
          {visibleRecords.map((record) => {
            const review = humanReviews[runTargetId(record)];
            return (
              <button
                type="button"
                key={record.id}
                className={selection.kind === "run" && selection.id === record.id ? "active" : ""}
                onClick={() => setSelection({ kind: "run", id: record.id })}
              >
                <span className="review-index-head">
                  <span className="refchip">{refOf(record.scenarioId)}</span>
                  <span className={`badge ${record.status === "passed" ? "ok" : record.status === "failed" ? "fail" : "err"}`}>
                    {record.status}
                  </span>
                </span>
                <span className="review-index-title">{record.scenarioId}</span>
                <span className={`human-verdict ${review?.verdict ?? "empty"}`}>{verdictLabel(review)}</span>
              </button>
            );
          })}
          {manualSessions.length > 0 && <div className="review-index-label">自由会话</div>}
          {manualSessions.map((session) => (
            <button
              type="button"
              key={session.id}
              className={selection.kind === "manual" && selection.id === session.id ? "active" : ""}
              onClick={() => openManual(session.id)}
            >
              <span className="review-index-head">
                <span className="refchip">{refOf(session.scenarioId)}</span>
                <span className={`badge ${session.active ? "running" : "neutral"}`}>
                  {session.active ? "可追问" : "已归档"}
                </span>
              </span>
              <span className="review-index-title">{session.turns[0]?.question || "空会话"}</span>
              <span className="human-verdict empty">{session.turns.length} 轮</span>
            </button>
          ))}
        </aside>

        <section className="review-document">
          <header className="review-document-head">
            <div>
              <div className="review-title-line">
                <span className="refchip">{refOf(activeRecord.scenarioId)}</span>
                <h3>{selection.kind === "manual" ? "自由评测会话" : activeRecord.scenarioId}</h3>
              </div>
              <p className="sub">
                {activeRecord.variantId} · #{activeRecord.repetition} · {ms(activeRecord.telemetry.wallTimeMs)} · {usd(activeRecord.telemetry.costUsd)}
              </p>
            </div>
            {selection.kind === "manual" && (
              <button type="button" className="text-button" onClick={() => setSelection({ kind: "run", id: activeRecord.id })}>
                返回固定样本
              </button>
            )}
          </header>

          <div className="review-columns">
            <div className="review-transcript-column">
              <TranscriptView
                turns={selection.kind === "manual" ? manualTurns : fixedTurns}
                {...(selection.kind === "manual" ? { activeIndex: manualTurnIndex } : {})}
              />
              {selection.kind === "run" && (activeRecord.assessment?.checks.length ?? 0) > 0 && (
                <details className="machine-checks">
                  <summary>机器检查 · {activeRecord.assessment?.checks.length}</summary>
                  <ul className="checks">
                    {[...(activeRecord.assessment?.checks ?? [])]
                      .sort((a, b) => Number(a.passed) - Number(b.passed))
                      .map((check) => (
                        <li key={`${check.id}-${check.message}`} className={`check ${check.passed ? "ok" : "fail"}`}>
                          <span className="dot" />
                          <span className="cid">{check.id}</span>
                          <span>{check.message}</span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
            <aside className="review-sidepanel">
              {selection.kind === "manual" && selectedSession && selectedSession.turns.length > 0 && (
                <div className="turn-picker segmented-control" aria-label="选择要评分的轮次">
                  {selectedSession.turns.map((turn, index) => (
                    <button
                      type="button"
                      key={turn.id}
                      className={selectedManualTurn?.id === turn.id ? "active" : ""}
                      onClick={() => setManualTurnIndex(index)}
                    >
                      第 {index + 1} 轮
                    </button>
                  ))}
                </div>
              )}
              {selection.kind === "manual" && !selectedManualTurn ? (
                <div className="review-empty">
                  <div className="section-label">人工 Judge</div>
                  <strong>这次会话还没有模型回答</strong>
                  <p>在下方输入问题并运行后，就可以逐轮评分。</p>
                </div>
              ) : (
                <HumanReviewForm
                  targetId={
                    selectedManualTurn
                      ? manualTargetId(selectedManualTurn.id)
                      : runTargetId(activeRecord)
                  }
                  review={
                    humanReviews[
                      selectedManualTurn
                        ? manualTargetId(selectedManualTurn.id)
                        : runTargetId(activeRecord)
                    ]
                  }
                  onSave={async (input) => {
                    const review = await saveHumanReview(runId, input);
                    onReviewChange(review);
                  }}
                />
              )}
              <ManualSessionPanel
                runId={runId}
                record={activeRecord}
                sessions={manualSessions}
                onSessionChange={onManualSessionChange}
                onOpen={openManual}
              />
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
