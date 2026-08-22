import { useMemo, useState } from "react";
import { askManualSession, createManualSession, type RunRecord } from "../api";
import type { ManualReviewSession, ManualReviewTurn } from "../reviews";

export function ManualSessionPanel({
  runId,
  record,
  sessions,
  onSessionChange,
  onOpen,
}: {
  runId: string;
  record: RunRecord;
  sessions: ManualReviewSession[];
  onSessionChange: (session: ManualReviewSession) => void;
  onOpen: (sessionId: string) => void;
}) {
  const matching = sessions.filter(
    (session) =>
      session.scenarioId === record.scenarioId && session.variantId === record.variantId,
  );
  const active = matching.find((session) => session.active);
  const hasSelection = (record.output?.turns ?? []).some(
    (turn) => turn.input?.attachments?.length,
  );
  const [inheritSelection, setInheritSelection] = useState(hasSelection);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [matching],
  );

  const send = async (forceNew = false) => {
    const text = question.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      let session = forceNew || !active
        ? await createManualSession(runId, {
            scenarioId: record.scenarioId,
            variantId: record.variantId,
            inheritSelection,
          })
        : active;
      if (!matching.some((entry) => entry.id === session.id)) onSessionChange(session);
      const turn: ManualReviewTurn = await askManualSession(session.id, { question: text });
      session = { ...session, active: true, turns: [...session.turns, turn] };
      onSessionChange(session);
      onOpen(session.id);
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="manual-panel" aria-label="自由评测">
      <div className="panel-heading">
        <div>
          <div className="section-label">自由评测</div>
          <strong>{active ? "继续当前会话" : "新建人工样本"}</strong>
        </div>
        {active && (
          <button type="button" className="text-button" onClick={() => void send(true)} disabled={!question.trim() || sending}>
            作为新会话发送
          </button>
        )}
      </div>
      {hasSelection && (
        <label className="inline-toggle">
          <input
            type="checkbox"
            checked={inheritSelection}
            onChange={(event) => setInheritSelection(event.target.checked)}
          />
          <span>沿用原场景选区</span>
        </label>
      )}
      <textarea
        className="manual-question"
        rows={4}
        value={question}
        placeholder="在相同书籍、阅读位置和种子状态下提一个真实问题"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void send(false);
        }}
      />
      {error && <div className="inline-error">{error}</div>}
      <div className="review-actions">
        <span className="save-state">{active ? `${active.turns.length} 轮` : ""}</span>
        <button
          type="button"
          className="primary-button"
          disabled={!question.trim() || sending}
          onClick={() => void send(false)}
        >
          {sending ? "运行中" : active ? "发送追问" : "运行问题"}
        </button>
      </div>
      {sorted.length > 0 && (
        <div className="session-history">
          <div className="section-label">人工会话</div>
          {sorted.map((session) => (
            <button type="button" key={session.id} onClick={() => onOpen(session.id)}>
              <span>{session.turns[0]?.question || "空会话"}</span>
              <span>{session.turns.length} 轮</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

