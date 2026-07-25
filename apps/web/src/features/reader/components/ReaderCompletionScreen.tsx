/**
 * The end of a book.
 *
 * Appears when the reader deliberately advances past the last page — not merely
 * when the last page scrolls into view, which would ambush anyone still reading
 * it. Three things belong here and nowhere else in the product:
 *
 *   1. The reader's own verdict. Reaching 100% is not a commitment; declaring
 *      the book finished is. That declaration is sticky (see `book.finished`).
 *   2. What the reading actually cost — the only place a single book's time is
 *      summarized at the moment it becomes meaningful.
 *   3. What the reader leaves with: their own marks, and an AI look back over
 *      them. Both jump back into the text.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { CheckCircle, Quotes, Sparkle, X } from "@phosphor-icons/react";
import { Body, Button, Caption, Display, Eyebrow, Heading, Spinner, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import { computeBookInsights } from "../../stats/lib/reading-insights";
import { emptyBookStats } from "../lib/reading-stats";
import type { LibraryBook } from "../../library/lib/library-types";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { listAnnotations } from "../../annotations/lib/annotation-db";
import { userDomain } from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";

type Props = {
  book: LibraryBook;
  /** Already-declared finish, so re-opening the screen shows the current state. */
  finished: boolean;
  onFinishedChange: (finished: boolean) => void;
  /** Jump back into the book at an annotation's anchor. */
  onRevisit: (cfiRange: string) => void;
  onDismiss: () => void;
};

/** `4h 12m`, or `28m` under an hour — hours matter more than precision here. */
function formatDuration(ms: number, t: TFunction<"reader">): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return t("completion.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("completion.hours", { count: hours })
    : t("completion.hoursMinutes", { hours, minutes: rest });
}

export function ReaderCompletionScreen({
  book,
  finished,
  onFinishedChange,
  onRevisit,
  onDismiss,
}: Props) {
  const { t } = useTranslation("reader");
  const stats = useAtomValue(readingStatsAtom);
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [recap, setRecap] = useState<{ state: "idle" | "loading" | "done" | "error"; text: string }>(
    { state: "idle", text: "" },
  );

  const insights = useMemo(
    () => computeBookInsights(stats[book.id] ?? emptyBookStats(book.id), Date.now()),
    [stats, book.id],
  );

  useEffect(() => {
    let cancelled = false;
    void listAnnotations({ bookId: book.id })
      .then((list) => {
        if (!cancelled) setAnnotations(list);
      })
      .catch(() => {
        if (!cancelled) setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const toggleFinished = useCallback(() => {
    const next = !finished;
    onFinishedChange(next);
    void userDomain.books.setFinished(book.id, next).catch(() => {
      // Revert the optimistic flip if the store refused the write.
      onFinishedChange(!next);
    });
  }, [book.id, finished, onFinishedChange]);

  /**
   * The look back is asked for, never automatic: it spends the user's own API
   * quota, and a book finished offline should still show everything else.
   */
  const requestRecap = useCallback(async () => {
    const runtime = getAgentRuntime();
    if (!runtime) {
      setRecap({ state: "error", text: t("completion.recapUnavailable") });
      return;
    }
    setRecap({ state: "loading", text: "" });
    const marks = (annotations ?? [])
      .slice(0, 40)
      .map((entry) => {
        const note = "content" in entry && entry.content ? ` — ${entry.content}` : "";
        return `- ${entry.text}${note}`;
      })
      .join("\n");
    try {
      const text = await runtime.ask({
        system: t("completion.recapSystem"),
        prompt: t("completion.recapPrompt", {
          title: book.title,
          author: book.author || t("completion.unknownAuthor"),
          marks: marks || t("completion.noMarks"),
        }),
        model: "smart",
      });
      setRecap({ state: "done", text: text.trim() });
    } catch {
      setRecap({ state: "error", text: t("completion.recapFailed") });
    }
  }, [annotations, book.author, book.title, t]);

  const metrics = [
    { label: t("completion.totalTime"), value: formatDuration(insights.totalMs, t) },
    { label: t("completion.daysRead"), value: String(insights.daysRead) },
    { label: t("completion.perDay"), value: formatDuration(insights.avgPerActiveDayMs, t) },
    { label: t("completion.longestStreak"), value: String(insights.longestStreak) },
  ];

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-paper">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-8 py-12">
        <div className="flex items-start justify-between gap-4">
          <Eyebrow className="text-stone-500">{t("completion.eyebrow")}</Eyebrow>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            aria-label={t("completion.backToBook")}
          >
            <X size={16} />
          </Button>
        </div>

        <Stack gap="lg" className="mt-8">
          <div>
            <Display className="text-3xl leading-tight">{book.title}</Display>
            {book.author ? (
              <Body className="mt-2 text-stone-600">{book.author}</Body>
            ) : null}
          </div>

          <Button
            variant={finished ? "solid" : "outline"}
            onClick={toggleFinished}
            className="self-start"
          >
            <CheckCircle size={18} weight={finished ? "fill" : "regular"} />
            {finished ? t("completion.markedFinished") : t("completion.markFinished")}
          </Button>

          {/* Reading figures */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-border pt-6 sm:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <Caption className="text-xs text-stone-500">{metric.label}</Caption>
                <Body className="mt-1 font-serif text-2xl leading-none">{metric.value}</Body>
              </div>
            ))}
          </div>

          {/* AI look back */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between gap-4">
              <Heading className="text-base">{t("completion.recapTitle")}</Heading>
              {recap.state === "idle" ? (
                <Button variant="outline" size="sm" onClick={() => void requestRecap()}>
                  <Sparkle size={15} />
                  {t("completion.recapAsk")}
                </Button>
              ) : null}
            </div>
            {recap.state === "loading" ? (
              <div className="mt-3 flex items-center gap-2 text-stone-500">
                <Spinner size="sm" />
                <Caption className="text-xs">{t("completion.recapLoading")}</Caption>
              </div>
            ) : null}
            {recap.state === "done" ? (
              <Body className="mt-3 whitespace-pre-wrap text-stone-700">{recap.text}</Body>
            ) : null}
            {recap.state === "error" ? (
              <Caption className="mt-3 block text-xs text-stone-500">{recap.text}</Caption>
            ) : null}
          </div>

          {/* The reader's own marks */}
          <div className="border-t border-border pt-6">
            <Heading className="text-base">
              {t("completion.marksTitle", { count: annotations?.length ?? 0 })}
            </Heading>
            {annotations == null ? (
              <div className="mt-3 flex items-center gap-2 text-stone-500">
                <Spinner size="sm" />
              </div>
            ) : annotations.length === 0 ? (
              <Caption className="mt-3 block text-xs text-stone-500">
                {t("completion.noMarksYet")}
              </Caption>
            ) : (
              <ul className="mt-4 space-y-4">
                {annotations.map((entry) => {
                  const anchor = entry.cfiRange;
                  const note = "content" in entry ? entry.content : undefined;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={!anchor}
                        onClick={() => anchor && onRevisit(anchor)}
                        className={cn(
                          "group w-full border-l-2 border-stone-300 py-1 pl-4 text-left",
                          anchor && "hover:border-stone-500",
                          !anchor && "cursor-default",
                        )}
                      >
                        <span className="flex items-start gap-2">
                          <Quotes
                            size={13}
                            className="mt-1.5 shrink-0 text-stone-400"
                            weight="fill"
                          />
                          <span className="min-w-0">
                            <Body className="font-serif text-stone-700">{entry.text}</Body>
                            {note ? (
                              <Caption className="mt-1 block text-xs text-stone-500">{note}</Caption>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Stack>

        <div className="mt-10 pt-6">
          <Button variant="link" onClick={onDismiss}>
            {t("completion.backToBook")}
          </Button>
        </div>
      </div>
    </div>
  );
}
