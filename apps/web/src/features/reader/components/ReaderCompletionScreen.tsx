/**
 * The end of a book.
 *
 * Appears when the reader deliberately advances past the last page — not merely
 * when the last page scrolls into view, which would ambush anyone still reading
 * it.
 *
 * Two things shape how it looks. It lives INSIDE the reader, so it takes the
 * reading theme's own palette rather than the app canvas — coming off the last
 * page onto a different colour reads as a glitch. And it is the last page of a
 * book, not a dashboard: the figures are one sentence, the marks are the
 * substance, and a section with nothing in it is not rendered at all.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { CheckCircle, Sparkle, X } from "@phosphor-icons/react";
import { Body, Button, Caption, Display, Eyebrow, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import { computeBookInsights } from "../../stats/lib/reading-insights";
import { emptyBookStats } from "../lib/reading-stats";
import { READER_THEME_PALETTE } from "../../settings/lib/reader-css";
import type { ReaderSettings } from "../../settings/lib/reader-settings";
import type { LibraryBook } from "../../library/lib/library-types";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { listAnnotations } from "../../annotations/lib/annotation-db";
import { userDomain } from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";

type Props = {
  book: LibraryBook;
  /** Drives the palette so this screen matches the page behind it. */
  theme: ReaderSettings["theme"];
  finished: boolean;
  onFinishedChange: (finished: boolean) => void;
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
  theme,
  finished,
  onFinishedChange,
  onRevisit,
  onDismiss,
}: Props) {
  const { t } = useTranslation("reader");
  const palette = READER_THEME_PALETTE[theme];
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

  const marks = annotations ?? [];
  const rule = { borderColor: palette.rule };
  /**
   * The design-system components carry the APP theme's colours (`text-fg`,
   * `bg-fg`). This screen follows the READING theme instead, and the two are
   * independent — a dark reading theme under a light app theme would otherwise
   * paint dark text on a dark page. `text-current` makes typography inherit the
   * container's colour; the button states are set outright.
   */
  const finishedButtonStyle = finished
    ? { backgroundColor: palette.text, color: palette.bg, borderColor: palette.text }
    : { borderColor: palette.rule, color: palette.text, backgroundColor: "transparent" };

  return (
    <div
      className="absolute inset-0 z-30 overflow-y-auto"
      style={{ backgroundColor: palette.bg, color: palette.text }}
    >
      <IconButton
        icon={<X size={16} />}
        label={t("completion.backToBook")}
        size="sm"
        onClick={onDismiss}
        className="absolute right-4 top-4 z-10"
        style={{ color: palette.muted }}
      />

      {/* `my-auto` centres a short screen without clipping a long one. */}
      <div className="flex min-h-full flex-col">
        <div className="mx-auto my-auto w-full max-w-lg px-8 py-16 sm:px-10">
          <Eyebrow style={{ color: palette.muted }}>{t("completion.eyebrow")}</Eyebrow>

          <Display className="mt-6 text-[2rem] leading-[1.12] text-current">{book.title}</Display>
          {book.author ? (
            <Body className="mt-2" style={{ color: palette.muted }}>
              {book.author}
            </Body>
          ) : null}

          {/* One sentence, not a metric grid — this is a last page, not a report. */}
          <Body className="mt-8 font-serif text-lg leading-snug text-current">
            {t("completion.summary", {
              time: formatDuration(insights.totalMs, t),
              days: insights.daysRead,
            })}
          </Body>
          <Caption className="mt-1.5 block text-xs" style={{ color: palette.muted }}>
            {t("completion.summaryDetail", {
              perDay: formatDuration(insights.avgPerActiveDayMs, t),
              streak: insights.longestStreak,
            })}
          </Caption>

          <Button
            variant={finished ? "solid" : "outline"}
            onClick={toggleFinished}
            className="mt-8"
            style={finishedButtonStyle}
          >
            <CheckCircle size={17} weight={finished ? "fill" : "regular"} />
            {finished ? t("completion.markedFinished") : t("completion.markFinished")}
          </Button>

          {/* The reader's own marks — the substance of the screen, so it leads. */}
          {marks.length > 0 ? (
            <div className="mt-14 border-t pt-8" style={rule}>
              <Caption className="block text-xs uppercase tracking-wider" style={{ color: palette.muted }}>
                {t("completion.marksTitle", { count: marks.length })}
              </Caption>
              <ul className="mt-5 space-y-5">
                {marks.map((entry) => {
                  const anchor = entry.cfiRange;
                  const note = "content" in entry ? entry.content : undefined;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={!anchor}
                        onClick={() => anchor && onRevisit(anchor)}
                        className="block w-full border-l pl-4 text-left transition-colors disabled:cursor-default"
                        style={rule}
                      >
                        <Body className="font-serif leading-relaxed text-current">{entry.text}</Body>
                        {note ? (
                          <Caption className="mt-1.5 block text-xs" style={{ color: palette.muted }}>
                            {note}
                          </Caption>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* Looking back: the button IS the section until there is something to show. */}
          <div className="mt-14 border-t pt-8" style={rule}>
            {recap.state === "idle" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void requestRecap()}
                className="-ml-2"
                style={{ color: palette.muted }}
              >
                <Sparkle size={15} />
                {t("completion.recapAsk")}
              </Button>
            ) : (
              <>
                <Caption
                  className="block text-xs uppercase tracking-wider"
                  style={{ color: palette.muted }}
                >
                  {t("completion.recapTitle")}
                </Caption>
                {recap.state === "loading" ? (
                  <Caption className="mt-4 block text-xs" style={{ color: palette.muted }}>
                    {t("completion.recapLoading")}
                  </Caption>
                ) : (
                  <Body
                    className="mt-4 whitespace-pre-wrap leading-relaxed text-current"
                    style={{ color: recap.state === "error" ? palette.muted : palette.text }}
                  >
                    {recap.text}
                  </Body>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
