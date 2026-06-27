import { useCallback, useEffect, useRef, useState } from "react";
import { Body, Heading, ScrollArea, Sidebar, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { formatReaderError } from "../lib/format-reader-error";
import {
  getNormalizedSelectionText,
  getSelectionOverlayRects,
  type ReaderSelectionState,
  type SelectionOverlayRect,
} from "../lib/selection-overlay";
import { normalizeHref, flattenToc, findTocIndexForHref } from "../lib/epub-utils";
import type { LoadedBook, TocEntry, TocNavItem } from "../lib/reader-types";
import {
  createFoliateView,
  getScrollEdges,
  isFixedLayout as isFixedLayoutBook,
  type FoliateLoadDetail,
  type FoliateRelocateDetail,
  type FoliateRenderer,
  type FoliateShowAnnotationDetail,
  type FoliateView,
} from "../lib/foliate-engine";
import {
  applyHighlight,
  applyHighlights,
  applyNote,
  applyNotes,
  registerHighlightDrawing,
  removeHighlight,
} from "../lib/highlight-renderer";
import { ReaderAnnotationMenu } from "./ReaderAnnotationMenu";
import { ReaderDictionaryModal } from "./ReaderDictionaryModal";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { NoteEditor } from "../../annotations/components/NoteEditor";
import { AIChatPanel } from "../../ai/components/AIChatPanel";
import type { Note, AIChat, Highlight } from "../../annotations/lib/annotation-types";
import {
  createHighlight,
  createNote,
  createAIChat,
  addMessageToChat,
  updateNote,
  listHighlights,
  listNotes,
  saveAnnotation,
  deleteAnnotation,
} from "../../annotations/lib/annotation-db";
import {
  getDefaultMarkColor,
  setDefaultMarkColor,
} from "../../annotations/lib/annotation-prefs";
import { suppressNativeContextMenu } from "../../../platform/environment";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { buildReaderContentCss, computeReaderMaxInlineSize } from "../../settings/lib/reader-css";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";

type FoliateReaderViewProps = {
  selectedBook?: LibraryBook | null;
  initialBook?: LoadedBook | null;
  readerSettings?: ReaderSettings;
  /** Whether the reader shell (header overlay) is currently open. Lets the view
   *  reset its scroll-dismissal distance each time the shell appears. */
  shellVisible?: boolean;
  onContentClick?: () => void;
  /** Dismiss the reader shell. Fired once a scroll travels far enough (scroll
   *  mode) or as soon as a page turn lands (paginated mode). */
  onContentScroll?: () => void;
  /** Any interaction inside the book (pointer/keys/scroll) — used to keep the
   *  reading-time tracker awake, since iframe events don't reach the window. */
  onReadingActivity?: () => void;
  onPageChange?: (current: number, total: number) => void;
  onProgressChange?: (progress: ReaderProgress) => void;
  onTocChange?: (entries: TocEntry[]) => void;
  onCurrentChapterChange?: (href: string | null) => void;
  initialProgress?: ReaderProgress | null;
  chapterNavigationRequest?: {
    href: string;
    requestId: number;
  } | null;
  annotationNavigationRequest?: {
    cfiRange: string;
    requestId: number;
  } | null;
};

const SELECTION_CLICK_SUPPRESSION_MS = 180;
const SHELL_TAP_MAX_DURATION_MS = 220;
const SHELL_TAP_MAX_MOVE_PX = 6;
// A center tap toggles the reader shell, but a double-click (to select a word)
// begins with a single click too. Defer the toggle by this window so the second
// click — or the resulting selection — can cancel it, instead of the shell
// flashing up mid-selection. A genuine single tap just toggles after the wait.
const SHELL_TOGGLE_DBLCLICK_GUARD_MS = 250;
// Fraction of the page width on each edge that acts as a page-turn tap zone;
// the remaining center band toggles the reader shell.
const TAP_TURN_ZONE_RATIO = 0.3;
// Cross-fade timing for section crossing: fade the current section out, swap in
// the next while hidden, fade it back in. Smooths the otherwise abrupt swap.
// Keep SECTION_CROSS_FADE_MS in step with the viewport's transition duration.
const SECTION_CROSS_FADE_MS = 140;
// Settle after a crossing so one wheel gesture (many events) advances a single
// section rather than racing through several.
const SECTION_CROSS_COOLDOWN_MS = 200;
// Scroll-mode section crossing is intentionally deliberate: once the viewport is
// pinned at a section edge, the wheel must push past it by this much before the
// adjacent section loads — so a gentle scroll to the end does not "turn" on its
// own. The accumulator resets if the push pauses.
const SECTION_CROSS_OVERSCROLL_PX = 260;
const OVERSCROLL_RESET_MS = 220;
// While the reader shell is open, a deliberate scroll dismisses it — but only
// once the content has travelled this far (px), so a small nudge or pointer
// jitter doesn't flash it away the instant you touch the wheel. Paginated page
// turns dismiss immediately instead; they're already discrete, deliberate moves.
const SHELL_DISMISS_SCROLL_PX = 160;

/** Map a reading mode to the foliate renderer's `flow` + column attributes. */
function layoutForReadingMode(mode: ReadingMode): {
  flow: "scrolled" | "paginated";
  maxColumnCount: number;
} {
  switch (mode) {
    case "paginated-single":
      return { flow: "paginated", maxColumnCount: 1 };
    case "paginated-double":
      return { flow: "paginated", maxColumnCount: 2 };
    case "scroll":
    default:
      return { flow: "scrolled", maxColumnCount: 1 };
  }
}

/** Effective reduced-motion: the forced app setting (`data-motion="reduced"`) or
 *  the OS preference when motion is left on `system`. */
function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.motion === "reduced") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Foliate animates page turns / viewport scrolls (its smooth `next`/`prev`) only
 *  while the renderer carries the `animated` attribute; toggle it from the motion
 *  preference so arrow-key paging glides instead of snapping — unless motion is
 *  reduced, where the instant jump is the accessible choice. */
function syncRendererAnimated(renderer: FoliateRenderer | undefined): void {
  if (!renderer) return;
  if (prefersReducedMotion()) renderer.removeAttribute("animated");
  else renderer.setAttribute("animated", "");
}

type ShellTapIntent = {
  eligible: boolean;
  moved: boolean;
  startedAt: number;
  startedWithSelection: boolean;
  startX: number;
  startY: number;
};

/** The text the selection / annotation menus act on (copy, note, look up, AI). */
type ActionTarget = {
  text: string;
  cfiRange: string | null;
  chapterHref: string | null;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function clampRectToViewport(
  rect: SelectionOverlayRect,
  frameRect: DOMRect,
  viewportRect: DOMRect,
): SelectionOverlayRect | null {
  const left = frameRect.left + rect.left - viewportRect.left;
  const top = frameRect.top + rect.top - viewportRect.top;
  const right = frameRect.left + rect.left + rect.width - viewportRect.left;
  const bottom = frameRect.top + rect.top + rect.height - viewportRect.top;

  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clippedRight = Math.min(viewportRect.width, right);
  const clippedBottom = Math.min(viewportRect.height, bottom);
  const width = clippedRight - clippedLeft;
  const height = clippedBottom - clippedTop;

  if (width <= 0 || height <= 0) return null;

  return { left: clippedLeft, top: clippedTop, width, height };
}

export function FoliateReaderView({
  selectedBook = null,
  initialBook = null,
  readerSettings = DEFAULT_READER_SETTINGS,
  shellVisible = false,
  onContentClick,
  onContentScroll,
  onReadingActivity,
  onPageChange,
  onProgressChange,
  onTocChange,
  onCurrentChapterChange,
  initialProgress = null,
  chapterNavigationRequest = null,
  annotationNavigationRequest = null,
}: FoliateReaderViewProps) {
  const readerRootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const lastLocationTargetRef = useRef<string | null>(null);
  const initialFractionRef = useRef(0);
  const loadedBookRef = useRef<LoadedBook | null>(null);
  const tocEntriesRef = useRef<TocEntry[]>([]);
  const currentChapterHrefRef = useRef<string | null>(null);
  const selectionRef = useRef<ReaderSelectionState | null>(null);
  const clearNativeSelectionRef = useRef<(() => void) | null>(null);
  const suppressContentClickRef = useRef(false);
  const suppressContentClickTimeoutRef = useRef<number | null>(null);
  const shellTapIntentRef = useRef<ShellTapIntent | null>(null);
  const shouldOpenShellOnClickRef = useRef(false);
  const pendingShellToggleTimerRef = useRef<number | null>(null);
  const readerSettingsRef = useRef(readerSettings);
  const highlightsRef = useRef<Highlight[]>([]);
  const notesRef = useRef<Note[]>([]);
  // New one-click marks use this colour; recoloring a mark updates it (persisted).
  const defaultMarkColorRef = useRef<Highlight["color"]>(getDefaultMarkColor());
  const isFixedLayoutRef = useRef(false);

  const readingMode = readerSettings.readingMode;
  const readingModeRef = useRef(readingMode);
  const crossingSectionRef = useRef(false);
  const overscrollRef = useRef(0);
  const overscrollResetTimerRef = useRef<number | null>(null);
  useEffect(() => { readingModeRef.current = readingMode; }, [readingMode]);

  // Reader-shell auto-dismissal state. `shellScrollAccumRef` is the signed
  // scroll distance since the shell opened (scroll mode); `prevReadingLocationRef`
  // is the last reported page so a paginated turn can be detected on `relocate`.
  const shellVisibleRef = useRef(shellVisible);
  const shellScrollAccumRef = useRef(0);
  const prevReadingLocationRef = useRef<{ current: number; cfi: string | null } | null>(null);
  useEffect(() => {
    shellVisibleRef.current = shellVisible;
    // Every fresh open starts the dismissal distance from zero, so scroll that
    // happened before the shell appeared can't dismiss it on the next tick.
    if (shellVisible) shellScrollAccumRef.current = 0;
  }, [shellVisible]);

  const onContentClickRef = useRef(onContentClick);
  const onContentScrollRef = useRef(onContentScroll);
  const onReadingActivityRef = useRef(onReadingActivity);
  const onPageChangeRef = useRef(onPageChange);
  const onProgressChangeRef = useRef(onProgressChange);
  const onTocChangeRef = useRef(onTocChange);
  const onCurrentChapterChangeRef = useRef(onCurrentChapterChange);

  useEffect(() => { onContentClickRef.current = onContentClick; }, [onContentClick]);
  useEffect(() => { onContentScrollRef.current = onContentScroll; }, [onContentScroll]);
  useEffect(() => { onReadingActivityRef.current = onReadingActivity; }, [onReadingActivity]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { onProgressChangeRef.current = onProgressChange; }, [onProgressChange]);
  useEffect(() => { onTocChangeRef.current = onTocChange; }, [onTocChange]);
  useEffect(() => { onCurrentChapterChangeRef.current = onCurrentChapterChange; }, [onCurrentChapterChange]);

  const [isLoading, setIsLoading] = useState(false);
  const [isCrossing, setIsCrossing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only surface the loader once a load is genuinely slow, so fast opens (the
  // common case) fade straight in without a flashed indicator.
  const showLoader = useDelayedFlag(isLoading, 250);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null);
  const [isChapterPickerOpen, setIsChapterPickerOpen] = useState(false);
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const [selection, setSelection] = useState<ReaderSelectionState | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<{
    highlight: Highlight;
    anchorRect: SelectionOverlayRect;
  } | null>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [dictionaryWord, setDictionaryWord] = useState("");

  const [noteTarget, setNoteTarget] = useState<ActionTarget | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [currentChat, setCurrentChat] = useState<AIChat | null>(null);

  // Drive the responsive text measure through foliate's `max-inline-size`
  // attribute. The paginator caps the column to that value (px) and writes it
  // onto the body with inline `!important`, so a width set via injected CSS is
  // ignored — the attribute is the only lever, and it must be recomputed from
  // the live reader width (it cannot use vw).
  const applyReaderMaxInlineSize = useCallback(() => {
    const renderer = viewRef.current?.renderer;
    if (!renderer || isFixedLayoutRef.current) return;
    const width =
      readerRootRef.current?.clientWidth ??
      viewportRef.current?.clientWidth ??
      window.innerWidth;
    const px = computeReaderMaxInlineSize(readerSettingsRef.current.contentWidth, width);
    renderer.setAttribute("max-inline-size", `${px}px`);
  }, []);

  // Settings change -> re-inject reader CSS and refresh the text measure.
  useEffect(() => {
    readerSettingsRef.current = readerSettings;
    viewRef.current?.renderer?.setStyles?.(buildReaderContentCss(readerSettings));
    applyReaderMaxInlineSize();
  }, [readerSettings, applyReaderMaxInlineSize]);

  useEffect(() => { loadedBookRef.current = initialBook; }, [initialBook]);
  useEffect(() => { tocEntriesRef.current = tocEntries; }, [tocEntries]);
  useEffect(() => { onTocChangeRef.current?.(tocEntries); }, [tocEntries]);
  useEffect(() => { currentChapterHrefRef.current = currentChapterHref; }, [currentChapterHref]);
  useEffect(() => { onCurrentChapterChangeRef.current?.(currentChapterHref); }, [currentChapterHref]);

  useEffect(() => {
    lastLocationTargetRef.current = initialProgress?.cfi ?? initialProgress?.href ?? null;
    initialFractionRef.current =
      initialProgress?.progressPercent != null
        ? Math.max(0, Math.min(1, initialProgress.progressPercent / 100))
        : 0;
  }, [initialProgress?.cfi, initialProgress?.href, initialProgress?.progressPercent]);

  const clearNativeSelection = useCallback(() => {
    try {
      clearNativeSelectionRef.current?.();
    } catch {
      // Selection cleanup can race with section teardown during navigation.
    } finally {
      clearNativeSelectionRef.current = null;
    }
  }, []);

  const cancelPendingShellOpen = useCallback(() => {
    shouldOpenShellOnClickRef.current = false;
  }, []);

  const cancelPendingShellToggle = useCallback(() => {
    if (pendingShellToggleTimerRef.current != null) {
      window.clearTimeout(pendingShellToggleTimerRef.current);
      pendingShellToggleTimerRef.current = null;
    }
  }, []);

  const clearSelection = useCallback(() => {
    cancelPendingShellOpen();
    clearNativeSelection();
    selectionRef.current = null;
    suppressContentClickRef.current = false;
    if (suppressContentClickTimeoutRef.current != null) {
      window.clearTimeout(suppressContentClickTimeoutRef.current);
      suppressContentClickTimeoutRef.current = null;
    }
    setSelection(null);
  }, [cancelPendingShellOpen, clearNativeSelection]);

  const armContentClickSuppression = useCallback(() => {
    suppressContentClickRef.current = true;
    cancelPendingShellOpen();
    if (suppressContentClickTimeoutRef.current != null) {
      window.clearTimeout(suppressContentClickTimeoutRef.current);
    }
    suppressContentClickTimeoutRef.current = window.setTimeout(() => {
      suppressContentClickRef.current = false;
      suppressContentClickTimeoutRef.current = null;
    }, SELECTION_CLICK_SUPPRESSION_MS);
  }, [cancelPendingShellOpen]);

  const captureSelectionFromDoc = useCallback((
    doc: Document,
    index: number,
    { suppressContentClick = false }: { suppressContentClick?: boolean } = {},
  ) => {
    const view = viewRef.current;
    const readerRoot = readerRootRef.current;
    const win = doc.defaultView;
    const selectionInDoc = win?.getSelection?.() ?? doc.getSelection?.() ?? null;
    const frameElement = win?.frameElement;
    if (!view || !readerRoot || !(frameElement instanceof HTMLElement) || !selectionInDoc) {
      clearSelection();
      return false;
    }

    const text = getNormalizedSelectionText(selectionInDoc);
    if (!text || selectionInDoc.rangeCount === 0) {
      clearSelection();
      return false;
    }

    const range = selectionInDoc.getRangeAt(0);
    if (range.collapsed) {
      clearSelection();
      return false;
    }

    clearNativeSelectionRef.current = () => {
      (win?.getSelection?.() ?? doc.getSelection?.())?.removeAllRanges();
    };

    const viewportRect = readerRoot.getBoundingClientRect();
    const frameRect = frameElement.getBoundingClientRect();
    const rects = getSelectionOverlayRects(range)
      .map((rect) => clampRectToViewport(rect, frameRect, viewportRect))
      .filter((rect): rect is SelectionOverlayRect => rect != null);

    if (rects.length === 0) {
      clearSelection();
      return false;
    }

    let cfiRange: string | null = null;
    try {
      cfiRange = view.getCFI(index, range);
    } catch {
      cfiRange = null;
    }

    const nextSelection: ReaderSelectionState = {
      anchorRect: rects[rects.length - 1] ?? null,
      appearance: "selection",
      cfiRange,
      chapterHref: currentChapterHrefRef.current,
      rects,
      text,
    };

    setActiveAnnotation(null);
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    if (suppressContentClick) armContentClickSuppression();

    return true;
  }, [armContentClickSuppression, clearSelection]);

  // ----- page turning -------------------------------------------------------

  // Cross into the adjacent section with a cross-fade: fade the current section
  // out, swap the next in while hidden, fade it back in. Used in scroll mode for
  // the lazy section load (the engine keeps only one section live, so memory
  // stays bounded), and smooths the otherwise abrupt chapter swap.
  const crossSection = useCallback(async (direction: -1 | 1) => {
    if (crossingSectionRef.current) return;
    const view = viewRef.current;
    if (!view) return;
    crossingSectionRef.current = true;
    setIsCrossing(true); // fade the current section out
    try {
      await new Promise((resolve) => window.setTimeout(resolve, SECTION_CROSS_FADE_MS));
      await (direction === 1 ? view.next() : view.prev());
    } catch {
      // At the first/last section, or a teardown race — fall through to reveal.
    }
    // The adjacent section has rendered while hidden; reveal it on the next
    // frame, then settle briefly so one push advances a single section.
    window.requestAnimationFrame(() => setIsCrossing(false));
    await new Promise((resolve) => window.setTimeout(resolve, SECTION_CROSS_COOLDOWN_MS));
    crossingSectionRef.current = false;
  }, []);
  const crossSectionRef = useRef(crossSection);
  useEffect(() => { crossSectionRef.current = crossSection; }, [crossSection]);

  // Shared wheel-crossing logic: checks scroll edges, accumulates overscroll,
  // and triggers a section cross once past the threshold. Used both by the
  // per-section iframe document listener and the viewport-level fallback for
  // events on the empty area outside the iframe.
  const handleWheelCrossing = useCallback((deltaY: number) => {
    if (readingModeRef.current !== "scroll") return;
    const edges = getScrollEdges(viewRef.current);
    if (!edges) return;

    const pushingPastEnd = deltaY > 0 && edges.atBottom;
    const pushingPastStart = deltaY < 0 && edges.atTop;
    if (!pushingPastEnd && !pushingPastStart) {
      overscrollRef.current = 0;
      return;
    }

    overscrollRef.current += deltaY;
    if (overscrollResetTimerRef.current != null) {
      window.clearTimeout(overscrollResetTimerRef.current);
    }
    overscrollResetTimerRef.current = window.setTimeout(() => {
      overscrollRef.current = 0;
    }, OVERSCROLL_RESET_MS);

    if (overscrollRef.current >= SECTION_CROSS_OVERSCROLL_PX) {
      overscrollRef.current = 0;
      void crossSectionRef.current(1);
    } else if (overscrollRef.current <= -SECTION_CROSS_OVERSCROLL_PX) {
      overscrollRef.current = 0;
      void crossSectionRef.current(-1);
    }
  }, []);
  const handleWheelCrossingRef = useRef(handleWheelCrossing);
  useEffect(() => { handleWheelCrossingRef.current = handleWheelCrossing; }, [handleWheelCrossing]);

  // Scroll-mode shell dismissal: accumulate the wheel's signed travel while the
  // shell is open and dismiss once a deliberate scroll crosses the threshold.
  // Signing the sum means jitter (down-then-up) cancels rather than racking up a
  // false distance — only sustained movement in one direction dismisses.
  const dismissShellOnScrollDistance = useCallback((deltaY: number) => {
    if (!shellVisibleRef.current || readingModeRef.current !== "scroll") return;
    shellScrollAccumRef.current += deltaY;
    if (Math.abs(shellScrollAccumRef.current) >= SHELL_DISMISS_SCROLL_PX) {
      shellScrollAccumRef.current = 0;
      onContentScrollRef.current?.();
    }
  }, []);
  const dismissShellOnScrollDistanceRef = useRef(dismissShellOnScrollDistance);
  useEffect(() => {
    dismissShellOnScrollDistanceRef.current = dismissShellOnScrollDistance;
  }, [dismissShellOnScrollDistance]);

  const turnPage = useCallback(async (direction: -1 | 1) => {
    const view = viewRef.current;
    if (!view) return;
    // A keyboard/space-driven move in scroll mode scrolls a whole viewport (or
    // crosses a section) — clearly past any distance threshold, so dismiss the
    // shell at once. Paginated turns are handled by the relocate position check.
    if (shellVisibleRef.current && readingModeRef.current === "scroll") {
      onContentScrollRef.current?.();
    }
    // In scroll mode, advancing at a section boundary should cross-fade into the
    // next chapter; mid-section it just scrolls a viewport. Paginated modes flip
    // pages directly.
    if (readingModeRef.current === "scroll") {
      const edges = getScrollEdges(view);
      if ((direction === 1 && edges?.atBottom) || (direction === -1 && edges?.atTop)) {
        void crossSection(direction);
        return;
      }
    }
    clearSelection();
    try {
      await (direction === 1 ? view.next() : view.prev());
    } catch {
      // At the first/last page, or a teardown race during navigation — no-op.
    }
  }, [clearSelection, crossSection]);

  // Kept in a ref so the per-section document listeners can call the latest
  // `turnPage` without re-subscribing (which would tear down the engine).
  const turnPageRef = useRef(turnPage);
  useEffect(() => { turnPageRef.current = turnPage; }, [turnPage]);

  // ----- chapter navigation (refs so stable across renders) -----------------

  const goToChapter = useCallback(async (href: string) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      setError(null);
      clearSelection();
      await view.goTo(href);
      setIsChapterPickerOpen(false);
    } catch (nextError) {
      setError(formatReaderError(nextError));
    }
  }, [clearSelection]);

  const goToAdjacentChapter = useCallback(async (direction: -1 | 1) => {
    const entries = tocEntriesRef.current;
    if (!entries.length) return;
    const currentIndex = findTocIndexForHref(entries, currentChapterHrefRef.current);
    if (currentIndex < 0) {
      const fallback = direction === 1 ? entries[0] : entries[entries.length - 1];
      if (fallback) await goToChapter(fallback.href);
      return;
    }
    const nextEntry = entries[currentIndex + direction];
    if (nextEntry) await goToChapter(nextEntry.href);
  }, [goToChapter]);

  const handleReaderKeyDown = useCallback((event: KeyboardEvent) => {
    if (!loadedBookRef.current) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))) {
      return;
    }

    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      setIsChapterPickerOpen((open) => !open);
    }
    if (event.key === "Escape") {
      clearSelection();
      setIsChapterPickerOpen(false);
    }
    if (event.key === "[" || event.code === "BracketLeft") {
      event.preventDefault();
      void goToAdjacentChapter(-1);
    }
    if (event.key === "]" || event.code === "BracketRight") {
      event.preventDefault();
      void goToAdjacentChapter(1);
    }
    // Page turning. Left/right are direction-aware (RTL-correct); the vertical
    // keys and space map to forward/back directly.
    if (event.key === "ArrowRight") {
      event.preventDefault();
      void viewRef.current?.goRight?.();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void viewRef.current?.goLeft?.();
    }
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      void turnPage(1);
    }
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      void turnPage(-1);
    }
    // Space toggles the reader shell (the chrome), not the page — pressing it to
    // peek at the controls shouldn't also advance your place.
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      onContentClickRef.current?.();
    }
  }, [clearSelection, goToAdjacentChapter, turnPage]);

  // ----- per-section listeners (attached on each `load`) --------------------

  const attachDocListeners = useCallback((doc: Document, index: number) => {
    // Desktop: kill the webview's native right-click menu inside book content too.
    suppressNativeContextMenu(doc);

    // Reading-activity signal for the time tracker. Pointer movement, keys,
    // scrolling, and wheel inside the book all mean "still reading" — vital in
    // scroll mode, where there are no page turns and a reader can linger on one
    // screenful. These events never bubble out of the iframe, so they must be
    // observed on the section document; capture+passive keeps it unobtrusive.
    const bumpReadingActivity = () => onReadingActivityRef.current?.();
    const activityOptions = { passive: true, capture: true } as const;
    doc.addEventListener("pointermove", bumpReadingActivity, activityOptions);
    doc.addEventListener("pointerdown", bumpReadingActivity, activityOptions);
    doc.addEventListener("keydown", bumpReadingActivity, activityOptions);
    doc.addEventListener("wheel", bumpReadingActivity, activityOptions);
    doc.addEventListener("scroll", bumpReadingActivity, activityOptions);

    doc.addEventListener("keydown", handleReaderKeyDown);

    doc.addEventListener("pointerdown", (event) => {
      cancelPendingShellOpen();
      const hadSelection = !!selectionRef.current;
      shellTapIntentRef.current = {
        eligible: event.isPrimary && event.button === 0,
        moved: false,
        startedAt: performance.now(),
        startedWithSelection: hadSelection,
        startX: event.clientX,
        startY: event.clientY,
      };
      if (hadSelection) {
        clearSelection();
        armContentClickSuppression();
        return;
      }
      suppressContentClickRef.current = false;
    }, true);

    doc.addEventListener("pointermove", (event) => {
      const intent = shellTapIntentRef.current;
      if (!intent?.eligible || intent.moved) return;
      if (
        Math.abs(event.clientX - intent.startX) > SHELL_TAP_MAX_MOVE_PX ||
        Math.abs(event.clientY - intent.startY) > SHELL_TAP_MAX_MOVE_PX
      ) {
        intent.moved = true;
        intent.eligible = false;
      }
    }, true);

    doc.addEventListener("pointercancel", () => {
      shellTapIntentRef.current = null;
      cancelPendingShellOpen();
    }, true);

    doc.addEventListener("pointerup", () => {
      const intent = shellTapIntentRef.current;
      shellTapIntentRef.current = null;

      const sel = doc.defaultView?.getSelection?.() ?? doc.getSelection?.() ?? null;
      const hasSelection =
        !!sel &&
        sel.rangeCount > 0 &&
        !sel.getRangeAt(0).collapsed &&
        getNormalizedSelectionText(sel).length > 0;

      if (hasSelection) {
        captureSelectionFromDoc(doc, index, { suppressContentClick: true });
        shouldOpenShellOnClickRef.current = false;
        return;
      }

      if (intent?.eligible) {
        const wasQuickTap = performance.now() - intent.startedAt <= SHELL_TAP_MAX_DURATION_MS;
        shouldOpenShellOnClickRef.current =
          wasQuickTap && !intent.startedWithSelection && !selectionRef.current;
      } else {
        cancelPendingShellOpen();
      }
    }, true);

    doc.addEventListener("click", (event) => {
      // Tapping an existing mark opens its recolor menu (via `show-annotation`);
      // skip the tap-to-toggle-shell handling so the two don't fight.
      const hit = viewRef.current?.renderer
        ?.getContents?.()
        .find((content) => content.index === index)
        ?.overlayer?.hitTest({ x: event.clientX, y: event.clientY });
      if (hit && hit[0]) {
        cancelPendingShellOpen();
        return;
      }
      // A tap on empty content dismisses any open recolor menu.
      setActiveAnnotation(null);
      if (suppressContentClickRef.current) {
        suppressContentClickRef.current = false;
        cancelPendingShellOpen();
        return;
      }
      if (selectionRef.current) {
        clearSelection();
        return;
      }
      if (!shouldOpenShellOnClickRef.current) return;
      shouldOpenShellOnClickRef.current = false;

      // Let in-book links and controls handle their own taps.
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("a, button, input, textarea, select, label, summary, [role='link'], [role='button']")
      ) {
        return;
      }

      // Tap zones (paginated only): left edge turns back, right edge turns
      // forward, center toggles the reader shell. In scroll mode every tap just
      // toggles the shell, since scrolling — not tapping — drives navigation.
      const paginated = readingModeRef.current !== "scroll";
      const pageWidth = doc.documentElement.clientWidth || doc.body?.clientWidth || 0;
      const x = (event as MouseEvent).clientX;
      if (paginated && pageWidth > 0 && x < pageWidth * TAP_TURN_ZONE_RATIO) {
        void turnPageRef.current(-1);
      } else if (paginated && pageWidth > 0 && x > pageWidth * (1 - TAP_TURN_ZONE_RATIO)) {
        void turnPageRef.current(1);
      } else {
        // Defer the chrome toggle: a double-click lands within the guard window
        // (cancelled by the `dblclick` listener below) or leaves a selection
        // behind, either of which suppresses the toggle so selecting a word no
        // longer flashes the shell. A plain single tap toggles after the wait.
        cancelPendingShellToggle();
        pendingShellToggleTimerRef.current = window.setTimeout(() => {
          pendingShellToggleTimerRef.current = null;
          if (selectionRef.current) return;
          const liveSelection = doc.defaultView?.getSelection?.();
          if (
            liveSelection &&
            liveSelection.rangeCount > 0 &&
            !liveSelection.getRangeAt(0).collapsed
          ) {
            return;
          }
          onContentClickRef.current?.();
        }, SHELL_TOGGLE_DBLCLICK_GUARD_MS);
      }
    }, true);

    // A double-click selects a word; cancel the toggle its first click queued so
    // the shell doesn't flash up while you're selecting.
    doc.addEventListener("dblclick", cancelPendingShellToggle, true);

    // A native intra-section scroll (anchor jump, focus) should still drop a live
    // selection; shell dismissal is driven by the wheel-distance accumulator and
    // the relocate page check, not by the raw scroll event.
    doc.addEventListener("scroll", () => {
      clearSelection();
    }, true);

    // Continuous-scroll mode: bridge section boundaries and feed the shell's
    // scroll-distance dismissal. Native scroll handles movement within a section;
    // when the wheel pushes past the top/bottom edge, lazily load the adjacent
    // section (the engine unloads the one left behind).
    doc.addEventListener("wheel", (event) => {
      dismissShellOnScrollDistanceRef.current(event.deltaY);
      handleWheelCrossingRef.current(event.deltaY);
    }, { passive: true });
  }, [armContentClickSuppression, captureSelectionFromDoc, cancelPendingShellOpen, cancelPendingShellToggle, clearSelection, handleReaderKeyDown]);

  // ----- global keydown + viewport resize -----------------------------------

  useEffect(() => {
    window.addEventListener("keydown", handleReaderKeyDown);
    return () => window.removeEventListener("keydown", handleReaderKeyDown);
  }, [handleReaderKeyDown]);

  // Keep the renderer's `animated` flag in sync with the motion preference at
  // runtime (the Reduce-motion toggle flips `data-motion`; the OS pref can change
  // too), so smooth paging turns on/off without reopening the book.
  useEffect(() => {
    const sync = () => syncRendererAnimated(viewRef.current?.renderer);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    media?.addEventListener?.("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    return () => {
      media?.removeEventListener?.("change", sync);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      clearSelection();
      applyReaderMaxInlineSize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [clearSelection, applyReaderMaxInlineSize]);

  // Bridge wheel and click events that land on the empty area *outside* the
  // iframe content. In scrolled mode the foliate engine sizes the section's
  // iframe to the content height, which may be much shorter than the viewport.
  // The iframe is an isolated browsing context — events inside it never reach
  // the parent — so the empty space below a short section is dead: scrolling
  // there does nothing and clicks are swallowed. Shadow-DOM events (the empty
  // area around the iframe) DO bubble to this host element, so we catch them
  // here and route them through the same crossing / shell-toggle logic.
  useEffect(() => {
    const root = readerRootRef.current;
    if (!root) return;

    const onWheel = (event: WheelEvent) => {
      dismissShellOnScrollDistanceRef.current(event.deltaY);
      handleWheelCrossingRef.current(event.deltaY);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !viewportRef.current?.contains(target)) return;
      if (selectionRef.current) {
        clearSelection();
        return;
      }
      onContentClickRef.current?.();
    };

    root.addEventListener("wheel", onWheel, { passive: true });
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("click", onClick);
    };
  }, [clearSelection]);

  useEffect(() => {
    return () => {
      cancelPendingShellOpen();
      cancelPendingShellToggle();
      if (suppressContentClickTimeoutRef.current != null) {
        window.clearTimeout(suppressContentClickTimeoutRef.current);
      }
      if (overscrollResetTimerRef.current != null) {
        window.clearTimeout(overscrollResetTimerRef.current);
      }
    };
  }, [cancelPendingShellOpen, cancelPendingShellToggle]);

  // ----- open the book ------------------------------------------------------

  useEffect(() => {
    const container = viewportRef.current;
    if (!initialBook || !container) return;

    let cancelled = false;
    let view: FoliateView | null = null;
    const cleanups: Array<() => void> = [];

    clearSelection();
    setIsLoading(true);
    setError(null);
    setTocEntries([]);
    setCurrentChapterHref(null);
    setIsFixedLayout(false);
    // Drop the previous book's position so its first relocate only sets a fresh
    // baseline instead of reading as a page turn.
    prevReadingLocationRef.current = null;
    shellScrollAccumRef.current = 0;

    void (async () => {
      try {
        const file =
          initialBook.file instanceof File
            ? initialBook.file
            : new File([initialBook.file], initialBook.fileName, { type: initialBook.file.type });

        view = await createFoliateView();
        if (cancelled) return;
        viewRef.current = view;
        view.style.display = "block";
        view.style.width = "100%";
        view.style.height = "100%";
        container.append(view);

        await registerHighlightDrawing(view);
        await view.open(file);
        if (cancelled) return;

        const book = view.book;
        const fixedLayout = book ? isFixedLayoutBook(book) : false;
        isFixedLayoutRef.current = fixedLayout;
        setIsFixedLayout(fixedLayout);

        // Apply the chosen reading mode. In every mode the engine keeps only the
        // current section live and unloads the rest, so memory stays bounded
        // however long the book is. (Fixed-layout PDFs ignore `flow`.)
        const { flow, maxColumnCount } = layoutForReadingMode(readingMode);
        view.renderer?.setAttribute("flow", flow);
        view.renderer?.setAttribute("max-column-count", String(maxColumnCount));
        view.renderer?.setAttribute(
          "max-inline-size",
          `${computeReaderMaxInlineSize(
            readerSettingsRef.current.contentWidth,
            readerRootRef.current?.clientWidth ?? window.innerWidth,
          )}px`,
        );
        view.renderer?.setStyles?.(buildReaderContentCss(readerSettingsRef.current));
        // Glide page turns / arrow-key scrolls instead of snapping (unless motion
        // is reduced). The runtime watcher effect keeps this in sync afterwards.
        syncRendererAnimated(view.renderer);

        const entries = flattenToc((book?.toc ?? []) as unknown as TocNavItem[])
          .map((entry, entryIndex) => ({ ...entry, spineIndex: entryIndex }));
        if (!cancelled) setTocEntries(entries);

        const onRelocate = (event: Event) => {
          if (cancelled) return;
          const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
          clearSelection();
          setActiveAnnotation(null);
          const fraction = Math.max(0, Math.min(1, detail.fraction ?? 0));
          const current = detail.location?.current ?? 0;
          const total = detail.location?.total ?? 0;
          const cfi = detail.cfi ?? null;
          const href = detail.tocItem?.href ?? null;
          lastLocationTargetRef.current = cfi ?? href;
          const progressPercent = Math.round(fraction * 100);
          onPageChangeRef.current?.(current, total);
          onProgressChangeRef.current?.({
            currentLocation: current,
            totalLocations: total,
            progressPercent,
            cfi,
            href,
          });
          setCurrentChapterHref(href);

          // Paginated dismissal: a page turn lands as a new location here, so the
          // shell hides the moment the position moves (covers taps, space, and
          // the arrow keys alike). Scroll mode is left to the wheel-distance
          // accumulator so a small scroll keeps the shell until it's gone far
          // enough — matching the "after a distance, not on the first tick" rule.
          const previousLocation = prevReadingLocationRef.current;
          if (
            shellVisibleRef.current &&
            readingModeRef.current !== "scroll" &&
            previousLocation != null
          ) {
            const movedPage = current !== previousLocation.current;
            const movedCfi =
              cfi != null && previousLocation.cfi != null && cfi !== previousLocation.cfi;
            if (movedPage || movedCfi) onContentScrollRef.current?.();
          }
          prevReadingLocationRef.current = { current, cfi };
        };

        const onLoad = (event: Event) => {
          const { doc, index } = (event as CustomEvent<FoliateLoadDetail>).detail;
          attachDocListeners(doc, index);
        };

        const onCreateOverlay = () => {
          if (!view) return;
          applyHighlights(view, highlightsRef.current);
          applyNotes(view, notesRef.current, highlightsRef.current);
        };

        // Tapping a mark anchors the recolor/remove menu over it; tapping a note
        // marker opens that note for reading/editing.
        const onShowAnnotation = (event: Event) => {
          if (cancelled) return;
          const detail = (event as CustomEvent<FoliateShowAnnotationDetail>).detail;
          const highlight = highlightsRef.current.find(
            (item) => item.cfiRange === detail.value,
          );
          if (!highlight) {
            const note = notesRef.current.find((item) => item.cfiRange === detail.value);
            if (note) {
              setNoteTarget({
                text: note.text,
                cfiRange: note.cfiRange,
                chapterHref: note.chapterHref,
              });
              setCurrentNote(note);
              setNoteEditorOpen(true);
              clearSelection();
            }
            setActiveAnnotation(null);
            return;
          }
          const range = detail.range;
          const readerRoot = readerRootRef.current;
          const win = range?.startContainer?.ownerDocument?.defaultView;
          const frameElement = win?.frameElement;
          if (!range || !readerRoot || !(frameElement instanceof HTMLElement)) {
            setActiveAnnotation(null);
            return;
          }
          const viewportRect = readerRoot.getBoundingClientRect();
          const frameRect = frameElement.getBoundingClientRect();
          const rects = getSelectionOverlayRects(range)
            .map((rect) => clampRectToViewport(rect, frameRect, viewportRect))
            .filter((rect): rect is SelectionOverlayRect => rect != null);
          if (rects.length === 0) {
            setActiveAnnotation(null);
            return;
          }
          clearSelection();
          setActiveAnnotation({ highlight, anchorRect: rects[rects.length - 1] });
        };

        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoad);
        view.addEventListener("create-overlay", onCreateOverlay);
        view.addEventListener("show-annotation", onShowAnnotation);
        cleanups.push(() => view?.removeEventListener("relocate", onRelocate));
        cleanups.push(() => view?.removeEventListener("load", onLoad));
        cleanups.push(() => view?.removeEventListener("create-overlay", onCreateOverlay));
        cleanups.push(() => view?.removeEventListener("show-annotation", onShowAnnotation));

        if (selectedBook) {
          try {
            highlightsRef.current = await listHighlights(selectedBook.id);
            notesRef.current = await listNotes(selectedBook.id);
          } catch {
            // Non-critical: marks will be missing but reading continues.
          }
        }

        const target = lastLocationTargetRef.current;
        const savedFraction = initialFractionRef.current;
        // A stored CFI/href can be unparseable for this engine (e.g. a legacy
        // epub.js CFI from before the foliate migration), or simply absent for
        // fixed-layout files. Fall back to the saved reading fraction so the
        // position is still restored instead of snapping back to the start.
        const restoreByFraction = async () => {
          if (savedFraction > 0) {
            await view?.goToFraction(savedFraction).catch(() => view?.renderer?.next?.());
          } else {
            await view?.renderer?.next?.();
          }
        };
        if (target) {
          await view.goTo(target).catch(restoreByFraction);
        } else {
          await restoreByFraction();
        }
        if (view) {
          applyHighlights(view, highlightsRef.current);
          applyNotes(view, notesRef.current, highlightsRef.current);
        }
      } catch (nextError) {
        if (!cancelled) setError(formatReaderError(nextError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
      highlightsRef.current = [];
      notesRef.current = [];
      try {
        view?.renderer?.destroy?.();
      } catch {
        // Ignore teardown races.
      }
      view?.remove();
      if (viewRef.current === view) viewRef.current = null;
    };
    // Keyed on selectedBook?.id (not the object): progress saves replace the
    // selectedBook object each tick, and re-running this effect would tear down
    // and rebuild the engine in a loop. `readingMode` is included so switching
    // layout re-initializes the engine, restoring position from the live CFI.
  }, [attachDocListeners, clearSelection, initialBook, selectedBook?.id, readingMode]);

  useEffect(() => {
    if (!chapterNavigationRequest?.href) return;
    void goToChapter(chapterNavigationRequest.href);
  }, [chapterNavigationRequest?.href, chapterNavigationRequest?.requestId, goToChapter]);

  useEffect(() => {
    const cfiRange = annotationNavigationRequest?.cfiRange;
    if (!cfiRange) return;
    void viewRef.current?.goTo(cfiRange);
  }, [annotationNavigationRequest?.cfiRange, annotationNavigationRequest?.requestId]);

  // ----- text actions shared by the selection and annotation menus ----------

  async function copyTargetText(text: string) {
    if (!text) return;
    try {
      await copyText(text);
    } catch {
      // Clipboard access can be unavailable outside a trusted user gesture.
    }
  }

  function openNoteEditorFor(target: ActionTarget) {
    setNoteTarget(target);
    setCurrentNote(null);
    setNoteEditorOpen(true);
  }

  function lookUpText(text: string) {
    setDictionaryWord(text);
    setDictionaryOpen(true);
  }

  function startAIChatFor(target: ActionTarget) {
    if (!selectedBook) return;
    const initialMessage = `I'm reading this passage: "${target.text}". What are your thoughts?`;
    void createAIChat(
      selectedBook.id,
      target.cfiRange,
      target.chapterHref,
      target.text,
      initialMessage,
    ).then((chat) => {
      setCurrentChat(chat);
      setAiChatOpen(true);
    });
  }

  async function handleHighlight(
    color: Highlight["color"] = defaultMarkColorRef.current,
    style: NonNullable<Highlight["style"]> = "highlight",
  ) {
    if (!selection || !selectedBook) return;
    try {
      const highlight = await createHighlight(
        selectedBook.id,
        selection.cfiRange,
        selection.chapterHref,
        selection.text,
        color,
        style,
      );
      highlightsRef.current = [...highlightsRef.current, highlight];
      if (viewRef.current) applyHighlight(viewRef.current, highlight);
      clearSelection();
    } catch (highlightError) {
      console.error("Failed to save highlight:", highlightError);
    }
  }

  function handleUnderline() {
    void handleHighlight(defaultMarkColorRef.current, "underline");
  }

  function handleLookUp() {
    if (!selection) return;
    lookUpText(selection.text);
    clearSelection();
  }

  async function handleRecolorAnnotation(color: Highlight["color"]) {
    if (!activeAnnotation) return;
    // Remember the chosen colour as the default for new marks.
    defaultMarkColorRef.current = color;
    setDefaultMarkColor(color);
    const updated: Highlight = {
      ...activeAnnotation.highlight,
      color,
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveAnnotation(updated);
      highlightsRef.current = highlightsRef.current.map((highlight) =>
        highlight.id === updated.id ? updated : highlight,
      );
      // Re-adding under the same CFI replaces the drawn mark in the new color.
      if (viewRef.current) applyHighlight(viewRef.current, updated);
    } catch (recolorError) {
      console.error("Failed to recolor annotation:", recolorError);
    }
    setActiveAnnotation(null);
  }

  async function handleRemoveAnnotation() {
    if (!activeAnnotation) return;
    const { highlight } = activeAnnotation;
    try {
      await deleteAnnotation(highlight.id);
      highlightsRef.current = highlightsRef.current.filter(
        (item) => item.id !== highlight.id,
      );
      if (viewRef.current && highlight.cfiRange) {
        removeHighlight(viewRef.current, highlight.cfiRange);
      }
    } catch (removeError) {
      console.error("Failed to remove annotation:", removeError);
    }
    setActiveAnnotation(null);
  }

  function activeAnnotationTarget(): ActionTarget | null {
    const highlight = activeAnnotation?.highlight;
    if (!highlight) return null;
    return {
      text: highlight.text,
      cfiRange: highlight.cfiRange,
      chapterHref: highlight.chapterHref,
    };
  }

  function handleAddNoteForAnnotation() {
    const target = activeAnnotationTarget();
    if (!target) return;
    const existing = target.cfiRange
      ? notesRef.current.find((note) => note.cfiRange === target.cfiRange)
      : undefined;
    if (existing) {
      setNoteTarget({
        text: existing.text,
        cfiRange: existing.cfiRange,
        chapterHref: existing.chapterHref,
      });
      setCurrentNote(existing);
      setNoteEditorOpen(true);
    } else {
      openNoteEditorFor(target);
    }
    setActiveAnnotation(null);
  }

  function handleLookUpAnnotation() {
    const target = activeAnnotationTarget();
    if (!target) return;
    lookUpText(target.text);
    setActiveAnnotation(null);
  }

  function handleAskAIAboutAnnotation() {
    const target = activeAnnotationTarget();
    if (!target) return;
    startAIChatFor(target);
    setActiveAnnotation(null);
  }

  function handleAddNote() {
    if (!selection) return;
    openNoteEditorFor({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
    });
  }

  async function handleSaveNote(content: string) {
    if (!noteTarget || !selectedBook) return;
    try {
      if (currentNote) {
        const updated = await updateNote(currentNote.id, content);
        if (updated) {
          notesRef.current = notesRef.current.map((note) =>
            note.id === updated.id ? updated : note,
          );
        }
      } else {
        const note = await createNote(
          selectedBook.id,
          noteTarget.cfiRange,
          noteTarget.chapterHref,
          noteTarget.text,
          content,
        );
        notesRef.current = [...notesRef.current, note];
        // Draw the dashed marker unless the passage is already highlighted
        // (the highlight is the visual there; see applyNotes).
        if (
          viewRef.current &&
          note.cfiRange &&
          !highlightsRef.current.some((highlight) => highlight.cfiRange === note.cfiRange)
        ) {
          applyNote(viewRef.current, note);
        }
      }
      setNoteEditorOpen(false);
      setNoteTarget(null);
      setCurrentNote(null);
      clearSelection();
    } catch (noteError) {
      console.error("Failed to save note:", noteError);
    }
  }

  function handleAskAI() {
    if (!selection) return;
    startAIChatFor({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
    });
    clearSelection();
  }

  async function handleSendMessage(content: string) {
    if (!currentChat) return;
    try {
      const updated = await addMessageToChat(currentChat.id, "user", content);
      if (updated) setCurrentChat(updated);
    } catch (messageError) {
      console.error("Failed to send message:", messageError);
    }
  }

  function handleUpdateChat(chat: AIChat) {
    setCurrentChat(chat);
  }

  return (
    <section ref={readerRootRef} className="relative h-full w-full overflow-hidden">
      <div
        ref={viewportRef}
        aria-label={selectedBook?.title ?? initialBook?.fileName ?? "Book reader"}
        className={cn(
          "h-full w-full transition-opacity ease-out",
          isCrossing ? "duration-150" : "duration-500",
          (isLoading || !!error || isCrossing) && "opacity-0",
        )}
      />
      <ReaderSelectionMenu
        selection={selection}
        allowAnnotations={!isFixedLayout}
        onCopy={() => copyTargetText(selectionRef.current?.text ?? "")}
        onHighlight={() => { void handleHighlight(); }}
        onUnderline={handleUnderline}
        onAddNote={handleAddNote}
        onLookUp={handleLookUp}
        onAskAI={handleAskAI}
      />
      <ReaderAnnotationMenu
        anchorRect={activeAnnotation?.anchorRect ?? null}
        activeColor={activeAnnotation?.highlight.color ?? "yellow"}
        onRecolor={(color) => {
          void handleRecolorAnnotation(color);
        }}
        onCopy={() => copyTargetText(activeAnnotation?.highlight.text ?? "")}
        onAddNote={handleAddNoteForAnnotation}
        onLookUp={handleLookUpAnnotation}
        onAskAI={handleAskAIAboutAnnotation}
        onRemove={() => {
          void handleRemoveAnnotation();
        }}
      />

      {showLoader && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit">
          <Spinner size="md" label={`Opening ${initialBook?.fileName ?? "book"}`} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit px-8 text-center">
          <Body className="max-w-md text-sm text-red-800">{error}</Body>
        </div>
      )}

      <Sidebar
        side="right"
        open={isChapterPickerOpen}
        onClose={() => setIsChapterPickerOpen(false)}
        label="Chapters"
        width="w-80"
      >
        <div className="flex h-full flex-col gap-4 py-6">
          <Heading as="h2" size="xl" className="px-6">
            Chapters
          </Heading>
          <Body className="px-6 text-sm text-fg-muted">
            Press `[` or `]` to move between chapters, or pick one below.
          </Body>
          <ScrollArea className="h-full min-h-0 flex-1">
            <div className="flex flex-col gap-1 px-6">
              {tocEntries.length === 0 ? (
                <Body className="text-sm text-fg-muted">
                  No chapter list is available for this book.
                </Body>
              ) : (
                tocEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      void goToChapter(entry.href);
                    }}
                    className={cn(
                      "w-full text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                      normalizeHref(entry.href) === normalizeHref(currentChapterHref ?? "")
                        ? "text-fg"
                        : "text-fg-muted hover:text-fg",
                      entry.depth === 1 && "pl-4",
                      entry.depth >= 2 && "pl-8",
                    )}
                  >
                    {entry.label}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </Sidebar>

      <NoteEditor
        isOpen={noteEditorOpen}
        selectedText={noteTarget?.text || ""}
        initialContent={currentNote?.content || ""}
        onSave={handleSaveNote}
        onCancel={() => {
          setNoteEditorOpen(false);
          setNoteTarget(null);
          setCurrentNote(null);
          clearSelection();
        }}
        isEditing={!!currentNote}
      />

      <AIChatPanel
        isOpen={aiChatOpen}
        selectedText={currentChat?.text || ""}
        bookTitle={selectedBook?.title || ""}
        chat={currentChat}
        onClose={() => {
          setAiChatOpen(false);
          setCurrentChat(null);
        }}
        onSendMessage={handleSendMessage}
        onUpdateChat={handleUpdateChat}
      />

      <ReaderDictionaryModal
        open={dictionaryOpen}
        word={dictionaryWord}
        onClose={() => setDictionaryOpen(false)}
      />
    </section>
  );
}
