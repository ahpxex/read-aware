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
import type { MouseEvent as ReactMouseEvent } from "react";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowLeft, CheckCircle, Sparkle, X } from "@phosphor-icons/react";
import { Body, Button, Caption, Display, Heading, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
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
import { askAiRequestAtom } from "../../ai/state/chat-intent";

type Props = {
  book: LibraryBook;
  /** Drives the palette so this screen matches the page behind it. */
  theme: ReaderSettings["theme"];
  /** Drives the fade; the parent keeps this mounted until it finishes. */
  visible: boolean;
  /**
   * Whether the reader's top bar is showing. It is `fixed` and paints above
   * this screen, so the close button has to step out from under it.
   */
  shellVisible: boolean;
  finished: boolean;
  onFinishedChange: (finished: boolean) => void;
  onRevisit: (cfiRange: string) => void;
  /** Leave for the shelf; absent in contexts with no shelf to return to. */
  onCloseReader?: () => void;
  /** A tap on the page itself, which toggles the reader shell as on any page. */
  onTapPage: () => void;
  /**
   * Whether a look back was already asked for this reading session. Owned by the
   * reader, which outlives this screen being dismissed and reopened.
   */
  lookBackAsked: boolean;
  onLookBackAsked: () => void;
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
  shellVisible,
  finished,
  onFinishedChange,
  onRevisit,
  onCloseReader,
  onTapPage,
  lookBackAsked,
  onLookBackAsked,
  onDismiss,
}: Props) {
  const { t } = useTranslation("reader");
  const palette = READER_THEME_PALETTE[theme];
  const stats = useAtomValue(readingStatsAtom);
  const dispatchAskAi = useSetAtom(askAiRequestAtom);
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);

  const insights = useMemo(
    () => computeBookInsights(stats[book.id] ?? emptyBookStats(book.id), Date.now()),
    [stats, book.id],
  );

  useEffect(() => {
    let cancelled = false;
    void listAnnotations({ bookId: book.id })
      .then((list) => {
        // Only what the READER left. `ask` annotations are the agent runtime's
        // passive traces of questions asked in the thread (see `ask.recorded` in
        // @read-aware/core) — including them put the reader's own "look back on
        // this book" prompt into their list of marks, and would feed it back as
        // a marked passage the next time they asked.
        if (!cancelled) setAnnotations(list.filter((entry) => entry.type !== "ask"));
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
    void userDomain.shelf.books.setFinished(book.id, next).catch(() => {
      // Revert the optimistic flip if the store refused the write.
      onFinishedChange(!next);
    });
  }, [book.id, finished, onFinishedChange]);


  /**
   * Hand the look back to the agent instead of writing it here. It has the
   * tools to gather the marks and the book itself, the answer lands in the
   * book's own thread, and the reader can follow up — none of which a one-shot
   * call rendered on this screen could offer.
   *
   * Asking does NOT leave this screen. It is a page of the book like any other,
   * and the chat panel opens over a page rather than in place of it (the shell
   * overlay is `fixed z-50`, above this surface), so there is nothing to get out
   * of the way of. Dismissing would also throw away what the reader came here
   * for — the marks and the figures the answer is about.
   *
   * Asked once per session, not once per click. After that the button reveals
   * the answer that already exists: a second identical question would push the
   * first one out of view and make the agent re-derive what it just said. A
   * dispatch carrying neither prompt nor attachment does exactly that — the
   * shell opens the Chat tab, and the panel has nothing to adopt.
   */
  const askForLookBack = useCallback(() => {
    const request = { id: crypto.randomUUID(), bookId: book.id };
    if (lookBackAsked) {
      dispatchAskAi(request);
      return;
    }
    dispatchAskAi({ ...request, prompt: t("completion.lookBackPrompt", { title: book.title }) });
    onLookBackAsked();
  }, [book.id, book.title, dispatchAskAi, lookBackAsked, onLookBackAsked, t]);

  /**
   * A tap on the page toggles the reader shell, exactly as on a page of text —
   * this screen is one more page of the book, so the gesture that reveals the
   * chrome cannot stop working just because the page has no prose on it.
   *
   * Judged from the click rather than a pointer-down/up pair: what has to be
   * excluded here is someone selecting a marked passage, and a completed
   * selection is directly observable, where a drag threshold only approximates
   * it. Controls are left alone — each already has a job.
   */
  const onTapSurface = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((event.target as Element).closest("button, a, input, textarea, select")) return;
      // detail > 1 is a double-click, i.e. selecting a word.
      if (event.detail > 1) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      onTapPage();
    },
    [onTapPage],
  );

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
      onClick={onTapSurface}
    >
      <IconButton
        icon={<X size={16} />}
        label={t("completion.backToBook")}
        size="sm"
        onClick={onDismiss}
        className="absolute right-4 z-10 transition-[top] duration-250 ease-out"
        style={{
          color: palette.muted,
          // The top bar is `fixed` and paints over this screen. Sitting under it
          // left the button visible but unclickable — the bar's own icons won
          // every hit test. Step below the bar while it is showing.
          top: shellVisible ? "calc(var(--ra-reader-bar-height) + 0.5rem)" : "1rem",
        }}
      />

      {/* `my-auto` centres a short screen without clipping a long one. */}
      <div className="flex min-h-full flex-col">
        <div className="mx-auto my-auto w-full max-w-lg px-8 py-16 sm:px-10">
          {onCloseReader ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCloseReader}
              className="-ml-3"
              style={{ color: palette.muted }}
            >
              <ArrowLeft size={15} />
              {t("backToShelf")}
            </Button>
          ) : null}

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
            <Button variant="ghost" onClick={askForLookBack} style={{ color: palette.muted }}>
              <Sparkle size={16} />
              {t("completion.lookBack")}
            </Button>
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

        </div>
      </div>
    </div>
  );
}
