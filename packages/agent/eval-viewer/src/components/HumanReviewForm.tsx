import { useCallback, useEffect, useRef, useState } from "react";
import {
  REVIEW_FLAGS,
  reviewMean,
  verdictForScore,
  type HumanReview,
  type HumanReviewInput,
  type HumanVerdict,
  type ReviewDimension,
  type ReviewFlag,
} from "../reviews";

interface ReviewDraft {
  score?: number;
  verdict?: HumanVerdict;
  dimensions: Partial<Record<ReviewDimension, number>>;
  flags: ReviewFlag[];
  notes: string;
}

function draftOf(review: HumanReview | undefined): ReviewDraft {
  const mean = reviewMean(review);
  return {
    ...(mean === undefined ? {} : { score: Math.round(mean) }),
    ...(review?.verdict ? { verdict: review.verdict } : {}),
    dimensions: review?.dimensions ?? {},
    flags: review?.flags ?? [],
    notes: review?.notes ?? "",
  };
}

function inputOf(targetId: string, draft: ReviewDraft): HumanReviewInput {
  return {
    targetId,
    ...(draft.score === undefined ? {} : { score: draft.score }),
    ...(draft.verdict === undefined ? {} : { verdict: draft.verdict }),
    dimensions: draft.dimensions,
    flags: draft.flags,
    notes: draft.notes,
  };
}

function signatureOf(targetId: string, draft: ReviewDraft): string {
  return JSON.stringify(inputOf(targetId, draft));
}

export function HumanReviewForm({
  targetId,
  review,
  onSave,
}: {
  targetId: string;
  review?: HumanReview;
  onSave: (input: HumanReviewInput) => Promise<void>;
}) {
  const initial = draftOf(review);
  const [draft, setDraft] = useState<ReviewDraft>(initial);
  const [state, setState] = useState<"idle" | "queued" | "saving" | "saved" | "error">("idle");
  const draftRef = useRef(initial);
  const saveRef = useRef(onSave);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const lastSavedRef = useRef(signatureOf(targetId, initial));

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const flush = useCallback(
    async function persistDraft(): Promise<void> {
      const signature = signatureOf(targetId, draftRef.current);
      if (signature === lastSavedRef.current) return;
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      savingRef.current = true;
      setState("saving");
      let failed = false;
      try {
        await saveRef.current(inputOf(targetId, draftRef.current));
        lastSavedRef.current = signature;
        setState("saved");
      } catch {
        failed = true;
        setState("error");
      } finally {
        savingRef.current = false;
        if (!failed && (pendingRef.current || signatureOf(targetId, draftRef.current) !== lastSavedRef.current)) {
          pendingRef.current = false;
          void persistDraft();
        }
      }
    },
    [targetId],
  );

  useEffect(() => {
    if (signatureOf(targetId, draft) === lastSavedRef.current) return;
    const timer = window.setTimeout(() => void flush(), 450);
    return () => window.clearTimeout(timer);
  }, [draft, flush, targetId]);

  const update = (change: (current: ReviewDraft) => ReviewDraft) => {
    setDraft((current) => {
      const next = change(current);
      draftRef.current = next;
      setState("queued");
      return next;
    });
  };

  return (
    <section
      className="mt-1 grid gap-2.5 border-y border-[var(--border)] py-3.5"
      aria-label="人工评测"
    >
      <div className="flex min-h-8 items-center gap-3 max-sm:flex-wrap">
        <span className="text-xs font-medium text-[var(--muted)]">你的评分</span>
        <div
          className="inline-grid grid-cols-5 overflow-hidden rounded-[5px] border border-[var(--border)] max-sm:order-3 max-sm:w-full"
          aria-label="总体评分"
        >
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              type="button"
              key={score}
              className={`h-7 min-w-[34px] border-r border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--muted)] transition-colors last:border-r-0 hover:bg-[var(--surface)] hover:text-[var(--fg)] ${
                draft.score === score
                  ? "bg-[var(--fg)]! text-[var(--bg)]!"
                  : ""
              }`}
              aria-label={`${score} 分`}
              aria-pressed={draft.score === score}
              onClick={() =>
                update((current) => ({
                  ...current,
                  score,
                  verdict: verdictForScore(score),
                }))
              }
            >
              {score}
            </button>
          ))}
        </div>
        <span
          className={`ml-auto text-[11px] ${
            state === "error" ? "text-[var(--fail)]" : "text-[var(--subtle)]"
          }`}
          aria-live="polite"
        >
          {state === "queued" || state === "saving"
            ? "保存中"
            : state === "saved"
              ? "已自动保存"
              : state === "error"
                ? "保存失败，修改后重试"
                : ""}
        </span>
      </div>

      <fieldset className="flex flex-wrap gap-1.5 border-0 p-0" aria-label="问题标签">
        {REVIEW_FLAGS.map((flag) => (
          <label className="relative" key={flag}>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={draft.flags.includes(flag)}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  flags: event.target.checked
                    ? [...current.flags, flag]
                    : current.flags.filter((entry) => entry !== flag),
                }))
              }
            />
            <span className="block cursor-pointer rounded-[4px] border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--subtle)] transition-colors peer-checked:border-[var(--fail)] peer-checked:bg-[var(--fail-bg)] peer-checked:text-[var(--fail)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]">
              {flag}
            </span>
          </label>
        ))}
      </fieldset>

      <label>
        <span className="sr-only">评语</span>
        <textarea
          className="min-h-[58px] w-full resize-y rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] placeholder:text-[var(--subtle)] focus:border-[var(--accent)] focus:outline-none"
          value={draft.notes}
          rows={2}
          placeholder="写下你的判断：哪里好，哪里不可信或不好用…"
          onBlur={() => void flush()}
          onChange={(event) =>
            update((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </label>
    </section>
  );
}
