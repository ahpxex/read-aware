import { useEffect, useState } from "react";
import {
  REVIEW_DIMENSIONS,
  REVIEW_FLAGS,
  reviewMean,
  type HumanReview,
  type HumanReviewInput,
  type HumanVerdict,
  type ReviewDimension,
  type ReviewFlag,
} from "../reviews";

const VERDICTS: Array<{ id: HumanVerdict; label: string }> = [
  { id: "pass", label: "满意" },
  { id: "partial", label: "有保留" },
  { id: "fail", label: "不满意" },
];

interface ReviewDraft {
  verdict?: HumanVerdict;
  dimensions: Partial<Record<ReviewDimension, number>>;
  flags: ReviewFlag[];
  notes: string;
}

function draftOf(review: HumanReview | undefined): ReviewDraft {
  return {
    verdict: review?.verdict,
    dimensions: review?.dimensions ?? {},
    flags: review?.flags ?? [],
    notes: review?.notes ?? "",
  };
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
  const [draft, setDraft] = useState<ReviewDraft>(() => draftOf(review));
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setDraft(draftOf(review));
    setState("idle");
  }, [targetId, review]);

  const update = (next: ReviewDraft) => {
    setDraft(next);
    setState("dirty");
  };
  const mean = reviewMean({
    targetId,
    dimensions: draft.dimensions,
    flags: draft.flags,
    notes: draft.notes,
    updatedAt: review?.updatedAt ?? "",
    ...(draft.verdict ? { verdict: draft.verdict } : {}),
  });
  const save = async () => {
    setState("saving");
    try {
      await onSave({ targetId, ...draft });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="human-review" aria-label="人工评测">
      <div className="panel-heading">
        <div>
          <div className="section-label">人工 Judge</div>
          <strong>{mean === undefined ? "尚未评分" : `${mean.toFixed(1)} / 5`}</strong>
        </div>
        {review?.updatedAt && <span className="saved-time">{review.updatedAt.slice(11, 16)}</span>}
      </div>

      <div className="verdict-control" aria-label="总体判断">
        {VERDICTS.map((verdict) => (
          <button
            type="button"
            key={verdict.id}
            className={draft.verdict === verdict.id ? `active ${verdict.id}` : ""}
            aria-pressed={draft.verdict === verdict.id}
            onClick={() => update({ ...draft, verdict: verdict.id })}
          >
            {verdict.label}
          </button>
        ))}
      </div>

      <div className="dimension-list">
        {REVIEW_DIMENSIONS.map((dimension) => (
          <div className="dimension-row" key={dimension.id}>
            <span>{dimension.label}</span>
            <div className="score-control" aria-label={`${dimension.label}评分`}>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  type="button"
                  key={score}
                  className={draft.dimensions[dimension.id] === score ? "active" : ""}
                  aria-pressed={draft.dimensions[dimension.id] === score}
                  onClick={() =>
                    update({
                      ...draft,
                      dimensions: { ...draft.dimensions, [dimension.id]: score },
                    })
                  }
                >
                  {score}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <fieldset className="flag-list">
        <legend>问题标签</legend>
        {REVIEW_FLAGS.map((flag) => (
          <label key={flag}>
            <input
              type="checkbox"
              checked={draft.flags.includes(flag)}
              onChange={(event) =>
                update({
                  ...draft,
                  flags: event.target.checked
                    ? [...draft.flags, flag]
                    : draft.flags.filter((entry) => entry !== flag),
                })
              }
            />
            <span>{flag}</span>
          </label>
        ))}
      </fieldset>

      <label className="notes-field">
        <span>评语</span>
        <textarea
          value={draft.notes}
          rows={5}
          placeholder="哪里让你满意，哪里让你失去信任？"
          onChange={(event) => update({ ...draft, notes: event.target.value })}
        />
      </label>
      <div className="review-actions">
        <span className={`save-state ${state}`}>
          {state === "saved" ? "已保存" : state === "error" ? "保存失败" : ""}
        </span>
        <button type="button" className="primary-button" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "保存中" : "保存评测"}
        </button>
      </div>
    </section>
  );
}

