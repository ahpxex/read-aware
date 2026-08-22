import { useState } from "react";
import { askManualSession, createManualSession, type RunRecord } from "../api";
import type { ManualReviewSession, ManualReviewTurn } from "../reviews";

export function ManualSessionPanel({
  runId,
  record,
  sessions,
  onSessionChange,
}: {
  runId: string;
  record: RunRecord;
  sessions: ManualReviewSession[];
  onSessionChange: (session: ManualReviewSession) => void;
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
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pt-3" aria-label="自由评测">
      <div className="mb-2 flex items-center gap-2.5 text-xs text-[var(--muted)]">
        <span>继续问这个场景</span>
        <span className="text-[11px] text-[var(--subtle)]">
          {active ? `当前会话 ${active.turns.length} 轮` : "建立新的人工样本"}
        </span>
        {active && (
          <button
            type="button"
            className="ml-auto border-0 bg-transparent text-[11px] text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
            onClick={() => void send(true)}
            disabled={!question.trim() || sending}
          >
            新会话
          </button>
        )}
      </div>
      {hasSelection && (
        <label className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={inheritSelection}
            onChange={(event) => setInheritSelection(event.target.checked)}
          />
          <span>带上原选区</span>
        </label>
      )}
      <textarea
        className="w-full resize-y rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] placeholder:text-[var(--subtle)] focus:border-[var(--accent)] focus:outline-none"
        rows={2}
        value={question}
        placeholder="在相同书籍、阅读位置和种子状态下提一个真实问题"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void send(false);
        }}
      />
      {error && <div className="mt-2 text-[11px] text-[var(--fail)]">{error}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="rounded-[5px] border border-[var(--fg)] bg-[var(--fg)] px-3 py-1.5 text-xs text-[var(--bg)] disabled:cursor-default disabled:opacity-40"
          disabled={!question.trim() || sending}
          onClick={() => void send(false)}
        >
          {sending ? "模型回答中…" : active ? "发送追问" : "提问"}
        </button>
      </div>
    </section>
  );
}
