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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { ArrowLeft, CheckCircle, Sparkle, X } from "@phosphor-icons/react";
import { Body, Button, Caption, Display, Eyebrow, Heading, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { i18n, useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import { computeBookInsights } from "../../stats/lib/reading-insights";
import { emptyBookStats } from "../lib/reading-stats";
import { READER_THEME_PALETTE } from "../../settings/lib/reader-css";
import type { ReaderSettings } from "../../settings/lib/reader-settings";
import type { LibraryBook } from "../../library/lib/library-types";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { listAnnotations } from "../../annotations/lib/annotation-db";
import { isRecapCurrent, readBookRecap, saveBookRecap } from "../lib/book-recap";
import { userDomain } from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";

type Props = {
  book: LibraryBook;
  /** Drives the palette so this screen matches the page behind it. */
  theme: ReaderSettings["theme"];
  /** Drives the fade; the parent keeps this mounted until it finishes. */
  visible: boolean;
  finished: boolean;
  onFinishedChange: (finished: boolean) => void;
  onRevisit: (cfiRange: string) => void;
  /** Leave for the shelf; absent in contexts with no shelf to return to. */
  onCloseReader?: () => void;
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
  visible,
  finished,
  onFinishedChange,
  onRevisit,
  onCloseReader,
  onDismiss,
}: Props) {
  const { t } = useTranslation("reader");
  const palette = READER_THEME_PALETTE[theme];
  const stats = useAtomValue(readingStatsAtom);
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [recap, setRecap] = useState<{ state: "idle" | "loading" | "done" | "error"; text: string }>(
    () => {
      const stored = readBookRecap(book.id);
      return stored ? { state: "done" as const, text: stored.text } : { state: "idle" as const, text: "" };
    },
  );
  /** Guards the auto-run so it fires once per screen, not once per render. */
  const autoRequestedRef = useRef(false);

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
    const entries = annotations ?? [];
    const marks = entries
      .slice(0, 40)
      .map((entry) => {
        const note = "content" in entry && entry.content ? ` — ${entry.content}` : "";
        return `- ${entry.text}${note}`;
      })
      .join("\n");
    try {
      const text = await runtime.ask({
        // The language is named outright. "the reader's language" was ambiguous
        // enough that an English book got an English recap under a Chinese UI.
        system: `${t("completion.recapSystem")}\n\nWrite in this language: ${i18n.language}`,
        prompt: t("completion.recapPrompt", {
          title: book.title,
          author: book.author || t("completion.unknownAuthor"),
          marks: marks || t("completion.noMarks"),
        }),
        model: "smart",
      });
      const written = text.trim();
      setRecap({ state: "done", text: written });
      // Paid for once: a later visit reuses this unless the marks change.
      saveBookRecap(book.id, {
        text: written,
        marksCount: entries.length,
        writtenAt: new Date().toISOString(),
      });
    } catch {
      setRecap({ state: "error", text: t("completion.recapFailed") });
    }
  }, [annotations, book.author, book.id, book.title, t]);

  /**
   * Write the look back without being asked — but only when there is nothing to
   * show yet. The stored recap is reused, and a mark added since it was written
   * makes it stale, which is the one case worth spending another call on.
   * Waits for the marks to load so the model never sees an empty set.
   */
  useEffect(() => {
    if (annotations == null || autoRequestedRef.current) return;
    if (isRecapCurrent(readBookRecap(book.id), annotations.length)) return;
    autoRequestedRef.current = true;
    void requestRecap();
  }, [annotations, book.id, requestRecap]);

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
      className={cn(
        "absolute inset-0 z-30 overflow-y-auto",
        // Keyframes, not a JS-triggered transition: a transition needs its
        // initial frame to be painted before the class flips, and the hook that
        // would do that (requestAnimationFrame) does not run while the window is
        // occluded — which would strand this screen fully transparent while it
        // still swallowed clicks. An animation carries its own from/to.
        visible ? "ra-motion-fade-in" : "ra-motion-surface-exit",
      )}
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

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              variant={finished ? "solid" : "outline"}
              onClick={toggleFinished}
              style={finishedButtonStyle}
            >
              <CheckCircle size={17} weight={finished ? "fill" : "regular"} />
              {finished ? t("completion.markedFinished") : t("completion.markFinished")}
            </Button>
            {onCloseReader ? (
              <Button
                variant="ghost"
                onClick={onCloseReader}
                style={{ color: palette.muted }}
              >
                <ArrowLeft size={16} />
                {t("backToShelf")}
              </Button>
            ) : null}
          </div>

          {/* The reader's own marks — the substance of the screen, so it leads. */}
          {marks.length > 0 ? (
            <div className="mt-14 border-t pt-8" style={rule}>
              <Heading size="xl" className="font-serif font-normal text-current">
                {t("completion.marksTitle", { count: marks.length })}
              </Heading>
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

          {/* Looking back. Written automatically, so the resting state is the
              result — the button only reappears if it could not be written. */}
          {recap.state !== "idle" ? (
            <div className="mt-14 border-t pt-8" style={rule}>
              <Heading size="xl" className="font-serif font-normal text-current">
                {t("completion.recapTitle")}
              </Heading>
              {recap.state === "loading" ? (
                <Caption className="mt-4 block text-xs" style={{ color: palette.muted }}>
                  {t("completion.recapLoading")}
                </Caption>
              ) : recap.state === "error" ? (
                <div className="mt-4">
                  <Caption className="block text-xs" style={{ color: palette.muted }}>
                    {recap.text}
                  </Caption>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void requestRecap()}
                    className="-ml-2 mt-2"
                    style={{ color: palette.muted }}
                  >
                    <Sparkle size={15} />
                    {t("completion.recapRetry")}
                  </Button>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {recap.text
                    .split(/\n{2,}/)
                    .map((paragraph) => paragraph.trim())
                    .filter(Boolean)
                    .map((paragraph, index) => (
                      <Body
                        key={index}
                        className="font-serif leading-relaxed text-current"
                        style={{ color: palette.text }}
                      >
                        {paragraph}
                      </Body>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
