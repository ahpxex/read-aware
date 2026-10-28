import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TFunction } from "i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Spinner, useToast } from "@read-aware/ui";
import { AppError, type ReadingModeResume } from "@read-aware/core";
import { cn } from "@read-aware/ui/cn";
import { ReaderFailureView } from "./ReaderFailureView";
import { ReaderBackgroundLayer } from "../../settings";
import { describeError, useTranslation } from "../../../i18n";
import { pageTurnSettingsAtom, textUnitModeSettingsAtom } from "../../../state/ui";
import { appShortcutForEvent, isAppSurfaceShortcut } from "../../settings/lib/shortcut-dispatch";
import type { LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { emitAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";
import { causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import {
  getNormalizedSelectionText,
  getSelectionContext,
  getSelectionOverlayRects,
  type ReaderSelectionState,
  type SelectionOverlayRect,
} from "../lib/selection-overlay";
import { flattenToc, findTocIndexForHref, adjacentTocEntry } from "../lib/epub-utils";
import { createNativeLinkNavigator } from "../lib/native-link-navigation";
import { attachTocFractions } from "../lib/toc-fractions";
import { chapterProgressAt, normalizeReadingCursorText } from "../lib/reading-cursor";
import { readingVisibleText } from "../lib/reading-visible-text";
import { readingPagePosition } from "../lib/reading-pagination";
import { relocateDismissesShell } from "../lib/shell-dismissal";
import type { LoadedBook, ReadingCursor, TocEntry } from "../lib/reader-types";
import { retainBook } from "../lib/book-lifetime";
import {
  chapterMapFor,
  createFoliateView,
  createFootnoteHandler,
  isFixedLayout as isFixedLayoutBook,
  isFixedLayoutFormat,
  isAtEndOfBook,
  type FoliateEdgeDetail,
  type FoliateFootnoteBeforeRenderDetail,
  type FoliateFootnoteHandler,
  type FoliateFootnoteRenderDetail,
  type FoliateBook,
  type FoliateLinkDetail,
  type FoliateLoadDetail,
  type FoliateRelocateDetail,
  type FoliateRenderer,
  type FoliateShowAnnotationDetail,
  type FoliateView,
} from "../lib/foliate-engine";
import { applyHighlights, applyNotes, registerHighlightDrawing } from "../lib/highlight-renderer";
import { parseBookFile } from "../lib/parse-book";
import { ensureUsableToc } from "../lib/toc-synthesis";
import { useReadAloud } from "../hooks/useReadAloud";
import { createReaderPanelIntent, readerPanelIntentAtom, type ReaderPanelKind } from "../state/panel-intent";
import { useTextUnitNavigator } from "../hooks/useTextUnitNavigator";
import { readTextUnitModeState } from "../lib/text-unit-mode-state";
import type { ModeRequest, ReadingModeController } from "../lib/reading-mode-controller";
import { createWheelGesture, type WheelGesture } from "../lib/wheel-gesture";
import { resolveActivatedImage } from "../lib/image-activation";
import { useImageViewer } from "../hooks/useImageViewer";
import { ReaderAnnotationMenu } from "./ReaderAnnotationMenu";
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";
import { ReaderImageLightbox } from "./ReaderImageLightbox";
import { TextUnitNavigatorBar } from "./TextUnitNavigatorBar";
import { TextUnitReadoutChip } from "./TextUnitReadoutChip";
import { ReaderPageTurnControls } from "./ReaderPageTurnControls";
import { ReaderZoomIndicator } from "./ReaderZoomIndicator";
import { ReaderSelectionHighlight } from "./ReaderSelectionHighlight";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { ReaderCompletionScreen } from "./ReaderCompletionScreen";
import { NoteEditor } from "../../annotations/components/NoteEditor";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import type { Note, Highlight } from "../../annotations/lib/annotation-types";
import { observeReaderAnnotations } from "../lib/observe-reader-annotations";
import { hasCoarsePointer, isIOS, suppressNativeContextMenu } from "../../../platform/environment";
import { localKV } from "../../../platform/local-store";
import { ReaderHoldMenu } from "./ReaderHoldMenu";
import { useReaderHoldMenu } from "../hooks/useReaderHoldMenu";
import { useTextUnitHoldActions } from "../hooks/useTextUnitHoldActions";
import { resolveDrawnRangeTap } from "../lib/content-tap";
import { forwardKeyDownToApp, isEditableKeyTarget } from "../../../platform/app-keydown";
import { subscribeWheelPhaseEdges } from "../../../platform/wheel-phase";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useReaderTypography } from "../hooks/useReaderTypography";
import { useFixedLayoutZoom } from "../hooks/useFixedLayoutZoom";
import { useReaderEngineLoadSource } from "../hooks/useReaderEngineLoadSource";
import { useReaderPagination } from "../hooks/useReaderPagination";
import { useReaderTextActions } from "../hooks/useReaderTextActions";
import { computeReaderMaxInlineSize, layoutForReadingMode, readerLayoutSpacing } from "../../settings/lib/reader-css";
import { useReaderPalette } from "../../settings/hooks/useReaderPalette";
import type { ReaderSettings } from "../../settings/lib/reader-settings";
import { DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";
import { restoreReadingPosition } from "../lib/restore-reading-position";
import { buildVirtualFoliateBook } from "../lib/virtual-book";
import { resolveContentProvider } from "../../plugins/lib/virtual-books";
import { readingRuntime } from "../../../domain/reading-runtime";
import { getRepairedNavigation } from "../../../domain/library";
import { useReferencePreview } from "../hooks/useReferencePreview";
import { attachReadingEngine, waitForReadingPaint } from "../lib/reading-engine-adapter";
import { readingRenderActor, readingRenderContext } from "../lib/reading-render-context";
import {
  acknowledgeReadingSelection,
  readingInputContext,
  readingNativeInput,
  readingSelectionFeedback,
} from "../lib/reading-document-input";
import { captureReadingSelection, type SelectionContentIdentity } from "../lib/selection-range";
import { useSelectionRender } from "../hooks/useSelectionRender";
import { useReaderViewportResize } from "../hooks/useReaderViewportResize";
import { createReadingSelectionAdapter } from "../lib/reading-selection-adapter";
import { createReadingEmphasisAdapter } from "../lib/reading-emphasis-adapter";
import { readingEmphasis } from "../../../domain/reading-emphasis";
import {
  fileContentVersion,
  virtualContentVersion,
  registerActiveBookContent,
} from "../../library/lib/book-content-source";
import {
  assertContentNotInvalidated,
  contentInvalidationRevision,
  virtualSourceRevision,
} from "../../library/lib/content-invalidation";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { detectBookLanguage } from "../lib/book-language";
import { rememberReaderBookLanguage } from "../../settings/lib/reader-languages";
import { getReaderPreferences, readerPreferencesForLanguage } from "../../settings/lib/reader-settings";
import { getReaderOverrides } from "../../settings/lib/reader-overrides";
import {
  readerChapterStarts,
  markReaderChapterStarts,
  markReaderInlineMedia,
  normalizeReaderTextSizes,
} from "../lib/reader-document-layout";
import {
  framePointAnchorInRoot,
  framePointToRoot,
  measureSectionToRoot,
  visibleFrameRectInRoot,
} from "../lib/frame-geometry";
import { resolvePageTurnTap, type PageTurnTap } from "../lib/page-turn-tap";
import { READER_STRIP_HEIGHT_PX } from "../lib/header-footer-layout";
import { useVolumeKeySteps } from "../hooks/useVolumeKeySteps";
import type { ReaderEngineSession } from "../lib/reader-engine-session";
import { useReaderEngineSession } from "../hooks/useReaderEngineSession";

type FoliateReaderViewProps = {
  selectedBook?: LibraryBook | null;
  initialBook?: LoadedBook | null;
  readerSettings?: ReaderSettings;
  /** Whether the reader shell (header overlay) is currently open. Lets the view
   *  reset its scroll-dismissal distance each time the shell appears. */
  shellVisible?: boolean;
  /** Reader header/footer strips are active on a side: reserve their height in
   *  the viewport padding AND the paginator's reserved margin so they borrow
   *  from the page margin instead of reflowing or covering text. */
  stripSpace?: { top: boolean; bottom: boolean };
  /** Leave the reader for the shelf — offered on the end-of-book screen. */
  onCloseReader?: () => void;
  onRetryOpen?: () => void;
  onContentClick?: () => void;
  /** Dismiss the reader shell. Fired once a scroll travels far enough (scroll
   *  mode) or as soon as a page turn lands (paginated mode). */
  onContentScroll?: (origin?: DomainActor) => void;
  /** Any interaction inside the book (pointer/keys/scroll) — used to keep the
   *  reading-time tracker awake, since iframe events don't reach the window. */
  onReadingActivity?: () => void;
  onPageChange?: (current: number, total: number) => void;
  onProgressChange?: (progress: ReaderProgress) => void;
  /** The engine's exact reading fraction (0..1). Reported separately from
   *  `onProgressChange`, whose payload is the persisted, rounded progress —
   *  the header's progress bar seeks on this scale and needs it unrounded. */
  onFractionChange?: (fraction: number) => void;
  onTocChange?: (entries: TocEntry[]) => void;
  onCurrentChapterChange?: (href: string | null) => void;
  /** Current viewport text + chapter-relative location for the in-book agent. */
  onReadingCursorChange?: (cursor: ReadingCursor) => void;
  /** Parsed foliate book, shared with lazy metadata/text enrichment. */
  onBookReady?: (book: FoliateBook) => void;
  /** Fixed-layout books (PDF/CBZ) can't host annotations or text-unit modes;
   *  lets the shell hide the affordances that don't apply. */
  onFixedLayoutChange?: (fixedLayout: boolean) => void;
  /** Host-rendered text-unit mode, owned by the workspace so its shell toggle
   *  and engine state stay in sync. */
  textUnitModeActive?: boolean;
  /** Enabled plugin contribution supplying text segmentation policy. */
  textUnitMode?: RegisteredReaderMode | null;
  modeController?: ReadingModeController;
  modeRequest?: ModeRequest;
  onModeUnitChange?: (unitId: string) => void;
  onExitTextUnitMode?: () => void;
  /** The mode's wash moved to another unit — a "resume reading"
   *  gesture; the workspace uses it to drop the shell chrome (and with it the
   *  TOC / chat panels) so the page takes the stage again. */
  onTextUnitModeStep?: () => void;
  initialProgress?: ReaderProgress | null;
  chapterNavigationRequest?: {
    href: string;
    requestId: number;
  } | null;
  annotationNavigationRequest?: {
    cfiRange: string;
    requestId: number;
  } | null;
  /** Jump to a position in the book, 0..1 — the header progress bar's scrub. */
  fractionNavigationRequest?: {
    fraction: number;
    requestId: number;
  } | null;
};

const log = createLogger("reader");

const SELECTION_CLICK_SUPPRESSION_MS = 180;
const SHELL_TAP_MAX_DURATION_MS = 220;
const SHELL_TAP_MAX_MOVE_PX = 6;
const EMPTY_READER_SEGMENTER: RegisteredReaderMode["segmentText"] = () => [];
// Touch selection settles (handles released, no further changes) for this long
// before the selection menu appears; each drag of a handle defers it again.
const TOUCH_SELECTION_SETTLE_MS = 350;
// A center click toggles the reader shell, but a mouse double-click (to select
// a word) begins with a single click too. Defer opening by this window so the
// second click — or the resulting selection — can cancel it, instead of the
// shell flashing up mid-selection. A genuine single click opens after the wait;
// a touch tap, which cannot double-click-select, opens at once.
const SHELL_TOGGLE_DBLCLICK_GUARD_MS = 250;
// Touch uses a lower threshold: wheel deltas are synthetic momentum units, but
// a finger drag maps 1:1 to CSS pixels, loses the system's touch slop, and a
// device-pixel swipe halves again through the density divisor — 260 CSS px of
// pull is over half a screen. 120px is still a deliberate pull, not a graze.
const TOUCH_SECTION_CROSS_OVERSCROLL_PX = 120;
/** Matches `.ra-motion-surface-exit`, which plays while the screen unmounts. */
const COMPLETION_FADE_MS = 240;
// Discrete wheel gestures (see wheel-gesture.ts): travel that fires a navigator
// step while its scroll-to-step option claims the wheel, and travel that turns
// a page in paginated layouts (a horizontal trackpad swipe, or — since a
// paginated layout has no vertical scroll to consume it — a vertical wheel:
// a mouse's scroll wheel, or a vertical trackpad swipe).
const WHEEL_STEP_THRESHOLD_PX = 48;
const WHEEL_PAGE_TURN_THRESHOLD_PX = 60;
// Touch swipe-to-step is simpler — one touch is one gesture: this much mostly-
// vertical travel steps once, and the touch is latched until the finger lifts.
const TOUCH_STEP_THRESHOLD_PX = 48;
// Swipe page turns for FIXED-LAYOUT books (PDF/CBZ) in paginated modes.
// Foliate's reflowable paginator ships its own touch handling; the
// fixed-layout renderer has none, so without this a paginated PDF cannot
// be turned at all on a touch device.
const FIXED_SWIPE_MIN_PX = 60;
const FIXED_SWIPE_MAX_MS = 600;
/** Device-local flag: the hold menu's one-time introduction has been shown. */
const HOLD_MENU_HINT_KEY = "read-aware-hold-menu-hint";

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
  /** From pointerdown: the click a touch synthesizes reports a mouse. */
  pointerType: string;
  startedAt: number;
  startedWithSelection: boolean;
  startX: number;
  startY: number;
};

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select", "label", "summary"]);

/**
 * Whether a tap landed on (or inside) an interactive element. The target comes
 * from the section iframe — a separate realm — so `instanceof Element` is always
 * false here; we duck-type on `nodeType`/`localName` and walk the ancestor chain.
 * (And `closest("a, …")` wouldn't help anyway: book content is XHTML, where a
 * bare type selector doesn't match the namespaced anchor.) Without this, link
 * taps fall through to the tap-to-toggle-shell handler.
 */
type DomLikeNode = {
  nodeType: number;
  localName?: string;
  parentElement?: DomLikeNode | null;
  getAttribute?: (name: string) => string | null;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  let node = target as DomLikeNode | null;
  while (node && node.nodeType === 1) {
    if (INTERACTIVE_TAGS.has(node.localName?.toLowerCase() ?? "")) return true;
    const role = node.getAttribute?.("role");
    if (role === "link" || role === "button") return true;
    node = node.parentElement ?? null;
  }
  return false;
}

/** Human label for the eyebrow on the footnote popover, by reference type. */
function footnoteLabel(type: string | null, t: TFunction<"reader">): string {
  switch (type) {
    case "footnote":
      return t("footnote.footnote");
    case "endnote":
      return t("footnote.endnote");
    case "biblioentry":
      return t("footnote.reference");
    case "definition":
      return t("footnote.definition");
    default:
      return t("footnote.note");
  }
}

export function FoliateReaderView({
  selectedBook = null,
  initialBook = null,
  readerSettings = DEFAULT_READER_SETTINGS,
  shellVisible = false,
  stripSpace = { top: false, bottom: false },
  onCloseReader,
  onRetryOpen,
  onContentClick,
  onContentScroll,
  onReadingActivity,
  onPageChange,
  onProgressChange,
  onFractionChange,
  onTocChange,
  onCurrentChapterChange,
  onReadingCursorChange,
  onBookReady,
  onFixedLayoutChange,
  textUnitModeActive = false,
  textUnitMode = null,
  modeController,
  modeRequest,
  onModeUnitChange,
  onExitTextUnitMode,
  onTextUnitModeStep,
  initialProgress = null,
  chapterNavigationRequest = null,
  annotationNavigationRequest = null,
  fractionNavigationRequest = null,
}: FoliateReaderViewProps) {
  const { t } = useTranslation(["reader", "common"]);
  // Resolved page-color palette (built-in or plugin-contributed).
  const readerPalette = useReaderPalette(readerSettings.theme);
  // Held in a ref so the stable, mount-once engine effects and callbacks can
  // read the latest translator without re-subscribing (which would tear down
  // the reader). `t`'s identity changes on a language switch; the ref tracks it.
  const tRef = useRef(t);
  tRef.current = t;
  const readerRootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateView | null>(null);
  /** Documents that already carry the reader's listeners — the fixed-layout
   *  spread cache re-announces 'load' for a document every time its page
   *  becomes current again, and the listeners must not stack. */
  const docsWithListenersRef = useRef(new WeakSet<Document>());
  const lastLocationTargetRef = useRef<string | null>(null);
  const resetPositionSourceRef = useRef<LoadedBook | null>(null);
  const initialFractionRef = useRef(0);
  const loadedBookRef = useRef<LoadedBook | null>(null);
  const tocEntriesRef = useRef<TocEntry[]>([]);
  const currentChapterHrefRef = useRef<string | null>(null);
  const selectionRef = useRef<ReaderSelectionState | null>(null);
  const clearNativeSelectionRef = useRef<((origin: DomainActor) => void) | null>(null);
  const suppressContentClickRef = useRef(false);
  const suppressContentClickTimeoutRef = useRef<number | null>(null);
  const shellTapIntentRef = useRef<ShellTapIntent | null>(null);
  const shouldOpenShellOnClickRef = useRef(false);
  // The pointer behind the click that may open the shell (see the click handler).
  const shellTapPointerRef = useRef("mouse");
  const pendingShellToggleTimerRef = useRef<number | null>(null);
  const highlightsRef = useRef<Highlight[]>([]);
  const notesRef = useRef<Note[]>([]);
  // New one-click marks use this colour; recoloring a mark updates it (persisted).
  const isFixedLayoutRef = useRef(false);

  // Fixed-layout books read on their own mode axis (default: continuous
  // scroll). Derived from the library FORMAT, not the parsed book — the mode
  // keys the open effect, and a value that flipped mid-parse would tear the
  // engine down and open the book twice.
  // Navigation follows the book's identity; a refreshed book object for the same id keeps it.
  const selectedBookId = selectedBook?.id;
  const readingMode = isFixedLayoutFormat(selectedBook?.format)
    ? readerSettings.fixedLayoutReadingMode
    : readerSettings.readingMode;
  const readingModeRef = useRef(readingMode);
  useEffect(() => {
    readingModeRef.current = readingMode;
  }, [readingMode]);
  const engineLoadSource = useReaderEngineLoadSource(initialBook, selectedBook?.id, readingMode, readerSettings);

  // Reader-shell auto-dismissal state. `shellScrollAccumRef` is the signed
  // scroll distance since the shell opened (scroll mode); `prevReadingLocationRef`
  // is the last reported page so a paginated turn can be detected on `relocate`.
  const shellVisibleRef = useRef(shellVisible);
  const prevReadingLocationRef = useRef<{ current: number; cfi: string | null } | null>(null);
  // Set while a jump issued FROM the header chrome is in flight (a progress-bar
  // scrub). Its relocate must not read as "the reader turned a page and wants
  // the chrome out of the way" — the reader is holding that chrome.
  const suppressShellDismissRef = useRef(false);
  // Pagination is set up further down; its reset is stable and read when the shell opens.
  const resetScrollTravelOnOpen = useEffectEvent(() => resetShellScrollTravel());
  useEffect(() => {
    shellVisibleRef.current = shellVisible;
    // Every fresh open starts the dismissal distance from zero, so scroll that
    // happened before the shell appeared can't dismiss it on the next tick.
    if (shellVisible) resetScrollTravelOnOpen();
  }, [shellVisible]);

  // Parent callbacks are reached through effect events: engine and section-
  // document listeners outlive the render that attached them, and must call
  // the LATEST callback without the callback's identity ever re-opening the
  // book. (`useReaderPagination` takes its shell-dismissal callback as a ref,
  // so that one prop is still mirrored.)
  const onContentScrollRef = useRef(onContentScroll);
  useEffect(() => {
    onContentScrollRef.current = onContentScroll;
  }, [onContentScroll]);
  // The position last reported for the open book. A text-unit mode's resting
  // unit can move without a relocate (a step within the page); it re-reports
  // this position carrying the new unit, so the recorded — and synced —
  // position always says where the mode rests.
  const reportedProgressRef = useRef<{ bookId: string; progress: ReaderProgress } | null>(null);
  const onProgressChangeRef = useRef(onProgressChange);
  const reportingBookIdRef = useRef(selectedBookId);
  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
    reportingBookIdRef.current = selectedBookId;
  }, [onProgressChange, selectedBookId]);
  const reportReadingModeResume = useCallback((readingMode: ReadingModeResume | null) => {
    const reported = reportedProgressRef.current;
    if (!reported || reported.bookId !== reportingBookIdRef.current) return;
    const progress = { ...reported.progress, readingMode };
    reportedProgressRef.current = { bookId: reported.bookId, progress };
    onProgressChangeRef.current?.(progress);
  }, []);
  const sessionTimerActivityRef = useRef<(() => void) | null>(null);
  const emitContentClick = useEffectEvent(() => onContentClick?.());
  const emitReadingActivity = useEffectEvent(() => {
    onReadingActivity?.();
    sessionTimerActivityRef.current?.();
  });
  const emitLocation = useEffectEvent(
    (location: {
      current: number;
      total: number;
      fraction: number;
      progress: ReaderProgress;
      cursor: ReadingCursor;
    }) => {
      onPageChange?.(location.current, location.total);
      onFractionChange?.(location.fraction);
      reportedProgressRef.current = selectedBook ? { bookId: selectedBook.id, progress: location.progress } : null;
      onProgressChange?.(location.progress);
      onReadingCursorChange?.(location.cursor);
    },
  );
  const emitTocChange = useEffectEvent((entries: TocEntry[]) => onTocChange?.(entries));
  const emitCurrentChapterChange = useEffectEvent((href: string | null) => onCurrentChapterChange?.(href));
  const emitBookReady = useEffectEvent((book: FoliateBook) => onBookReady?.(book));

  /**
   * The completion screen crosses in and out rather than snapping. `mounted`
   * keeps it in the tree long enough for the exit animation to play; `visible`
   * picks which animation runs. Both can be set in the same frame — the screen
   * animates with keyframes, so nothing has to observe an initial paint.
   */
  const [completionMounted, setCompletionMounted] = useState(false);
  const [completionVisible, setCompletionVisible] = useState(false);
  const completionExitTimerRef = useRef<number | null>(null);
  const completionRevisitTimerRef = useRef<number | null>(null);

  // Stable: these are dependencies of the pagination callbacks, and inline
  // arrows here rebuilt them on every render — enough to loop the reader's
  // listener effects until React bailed out with "maximum update depth".
  const openCompletion = useCallback(() => {
    if (completionExitTimerRef.current != null) {
      window.clearTimeout(completionExitTimerRef.current);
      completionExitTimerRef.current = null;
    }
    setCompletionMounted(true);
    setCompletionVisible(true);
  }, []);
  const dismissCompletion = useCallback(() => {
    setCompletionVisible(false);
    completionExitTimerRef.current = window.setTimeout(() => {
      setCompletionMounted(false);
      completionExitTimerRef.current = null;
    }, COMPLETION_FADE_MS);
  }, []);
  const [declaredFinished, setDeclaredFinished] = useState(selectedBook?.readingStatus === "finished");
  /**
   * Whether this reading session already asked the agent to look back. Kept
   * here rather than on the completion screen because that screen unmounts when
   * dismissed — the reader who reopens it should not be made to re-ask. This
   * component remounts per book, so the flag resets with the session.
   */
  const [lookBackAsked, setLookBackAsked] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; kind: "load" | "navigation"; retryable: boolean } | null>(null);
  /** Log the raw failure, hand back localized copy (never the raw message). */
  const describeReaderFailure = useCallback((raw: unknown, kind: "load" | "navigation" = "navigation") => {
    log.error("reader failure", raw);
    const failure = describeError(raw, { fallback: tRef.current("reader:loadError") });
    return { message: failure.body, kind, retryable: failure.retryable };
  }, []);
  // Only surface the loader once a load is genuinely slow, so fast opens (the
  // common case) fade straight in without a flashed indicator.
  const showLoader = useDelayedFlag(isLoading, 250);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null);
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const [selection, setSelection] = useState<ReaderSelectionState | null>(null);
  const selectionRender = useSelectionRender(selection, selectionRef);
  const selectionContentRef = useRef<SelectionContentIdentity | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<{
    highlight: Highlight;
    anchorRect: SelectionOverlayRect;
  } | null>(null);

  // "Ask AI about this" hands a passage to the note panel's chat (a sibling
  // component) via this atom; the shell reveals the Chat tab and the chat panel
  // adopts the passage. Whether the action is offered follows the user's
  // conversational-Q&A preference, read at key time by the key handler.
  const askAiEnabled = useAskAiEnabled();

  // Footnote popover: the engine loads + extracts the note into an off-screen
  // staging view; we read its text and show it in the popover.
  const { footnote, setFootnote, closeFootnote, beginNativeFootnote } = useReferencePreview(
    selectedBook?.id,
    t("footnote.note"),
  );
  const footnoteHandlerRef = useRef<FoliateFootnoteHandler | null>(null);
  const footnoteAnchorRectRef = useRef<SelectionOverlayRect | null>(null);
  const footnoteStageRef = useRef<HTMLDivElement | null>(null);

  // Full-screen illustration viewer (issue #13), opened by tapping an image
  // in the book content.
  const { lightboxImage, setLightboxImage, closeLightbox } = useImageViewer(selectedBook?.id);

  // 逐句模式：点中静息句的 wash → 在点击处开合该句的动作菜单（复制/高亮/
  // 下划线/笔记/问 AI + 插件 lookup），代替伸到底部工具栏。移动端"够不着"
  // 的核心修复：动作长在句子上，工具栏只留导航。
  const [unitMenuAnchor, setUnitMenuAnchor] = useState<SelectionOverlayRect | null>(null);
  /** Open or close the sentence menu at a click in section document `doc`. */
  const toggleUnitMenuAt = useEffectEvent((doc: Document, clientX: number, clientY: number) => {
    const mapping = measureSectionToRoot(doc, readerRootRef.current);
    if (!mapping) return;
    setUnitMenuAnchor((open) => (open ? null : framePointAnchorInRoot({ x: clientX, y: clientY }, mapping)));
  });

  /** Map an in-book element's rect to reader-viewport coords for anchoring. */
  const anchorRectForElement = useCallback((el: Element): SelectionOverlayRect | null => {
    const mapping = measureSectionToRoot(el.ownerDocument, readerRootRef.current);
    if (!mapping) return null;
    const rect = el.getBoundingClientRect();
    return visibleFrameRectInRoot({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, mapping);
  }, []);

  // Wire the footnote engine once: it turns footnote-reference clicks into a
  // rendered fragment shown in the popover (regular links still navigate). The
  // detached view is given the scrolled flow and the reader's content styles.
  useEffect(() => {
    let handler: FoliateFootnoteHandler | null = null;
    let cancelled = false;

    const onBeforeRender = (event: Event) => {
      const { view } = (event as CustomEvent<FoliateFootnoteBeforeRenderDetail>).detail;
      view.style.width = "100%";
      view.style.height = "100%";
      // Attach to the off-screen stage so the otherwise-detached view has a real
      // size and actually loads the fragment (a 0-size view never fires `load`).
      footnoteStageRef.current?.replaceChildren(view);
    };
    const onRender = (event: Event) => {
      const detail = (event as CustomEvent<FoliateFootnoteRenderDetail>).detail;
      const doc = detail.view.renderer?.getContents?.()?.[0]?.doc;
      const text = (doc?.body?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        // Drop the leading marker the source repeats ("[150]", "150.", "12) ")…
        .replace(/^\[?\d+\]?[.):\s]+/, "")
        // …and a trailing back-reference glyph, if any.
        .replace(/\s*[↩↵⮌⤴]︎?\s*$/u, "")
        .trim();
      // Done with the engine's view — detach it from the stage and tear it down.
      footnoteStageRef.current?.replaceChildren();
      void detail.view.close().catch((error) => log.warn("Could not close footnote view", error));
      if (!text) return;
      setFootnote(
        {
          anchorRect: footnoteAnchorRectRef.current,
          label: footnoteLabel(detail.type, tRef.current),
          text,
        },
        detail.requestId,
      );
    };

    void createFootnoteHandler().then((created) => {
      if (cancelled) return;
      handler = created;
      handler.addEventListener("before-render", onBeforeRender);
      handler.addEventListener("render", onRender);
      footnoteHandlerRef.current = handler;
    });

    return () => {
      cancelled = true;
      handler?.removeEventListener("before-render", onBeforeRender);
      handler?.removeEventListener("render", onRender);
      footnoteHandlerRef.current = null;
    };
  }, [setFootnote]);

  const {
    settingsRef: readerSettingsRef,
    applyMaxInlineSize: applyReaderMaxInlineSize,
    injectStyles: injectReaderStyles,
    prepareStyles: prepareReaderStyles,
    applyPageColors: applyReaderPageColors,
  } = useReaderTypography({
    readerSettings,
    viewRef,
    readerRootRef,
    viewportRef,
    isFixedLayoutRef,
    readingModeRef,
    layoutForReadingMode,
  });

  // Page zoom for fixed-layout books: the book's remembered zoom, and the
  // keys, pinches and zoom wheels that change it.
  const fixedLayoutZoom = useFixedLayoutZoom({
    bookId: selectedBook?.id,
    viewRef,
    isFixedLayoutRef,
    readerRootRef,
    viewportRef,
  });

  useEffect(() => {
    loadedBookRef.current = initialBook;
  }, [initialBook]);
  useEffect(() => {
    tocEntriesRef.current = tocEntries;
  }, [tocEntries]);
  useEffect(() => {
    emitTocChange(tocEntries);
  }, [tocEntries]);
  useEffect(() => {
    currentChapterHrefRef.current = currentChapterHref;
  }, [currentChapterHref]);
  useEffect(() => {
    emitCurrentChapterChange(currentChapterHref);
  }, [currentChapterHref]);

  useEffect(() => {
    lastLocationTargetRef.current = initialProgress?.cfi ?? initialProgress?.href ?? null;
    initialFractionRef.current =
      initialProgress?.progressPercent != null ? Math.max(0, Math.min(1, initialProgress.progressPercent / 100)) : 0;
  }, [initialProgress?.cfi, initialProgress?.href, initialProgress?.progressPercent]);

  const clearNativeSelection = useCallback((origin: DomainActor) => {
    try {
      clearNativeSelectionRef.current?.(origin);
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

  const clearSelection = useCallback(
    (source: DomainActor = "user") => {
      const origin = causalActor(source);
      cancelPendingShellOpen();
      clearNativeSelection(origin);
      selectionRef.current = null;
      suppressContentClickRef.current = false;
      if (suppressContentClickTimeoutRef.current != null) {
        window.clearTimeout(suppressContentClickTimeoutRef.current);
        suppressContentClickTimeoutRef.current = null;
      }
      setSelection(null);
      const identity = selectionContentRef.current;
      if (identity) readingRuntime.selectionChanged(identity.sessionId, null, origin);
    },
    [cancelPendingShellOpen, clearNativeSelection],
  );

  const {
    isCrossing,
    crossTo,
    handleWheelCrossingRef,
    dismissShellOnScrollDistanceRef,
    enqueuePageTurn,
    advancePage,
    turnPage,
    resetShellScrollTravel,
    resetPageTurnQueue,
    resetCrossing,
  } = useReaderPagination({
    viewRef,
    readingModeRef,
    shellVisibleRef,
    onContentScrollRef,
    clearSelection,
    onAdvancePastEnd: openCompletion,
  });

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

  const captureSelectionFromDoc = useCallback(
    (
      doc: Document,
      index: number,
      {
        suppressContentClick = false,
        origin: source = "user",
      }: { suppressContentClick?: boolean; origin?: DomainActor } = {},
    ) => {
      const origin = causalActor(source);
      const view = viewRef.current;
      // Check ownership before even clearing an invalid selection: an unloaded
      // iframe's late event must not dismiss the replacement reader's selection.
      if (!view?.renderer?.getContents().some((content) => content.index === index && content.doc === doc))
        return false;
      const win = doc.defaultView;
      const selectionInDoc = win?.getSelection?.() ?? doc.getSelection?.() ?? null;
      const mapping = measureSectionToRoot(doc, readerRootRef.current);
      if (!mapping || !selectionInDoc) {
        clearSelection(origin);
        return false;
      }

      const text = getNormalizedSelectionText(selectionInDoc);
      if (!text || selectionInDoc.rangeCount === 0) {
        clearSelection(origin);
        return false;
      }

      const range = selectionInDoc.getRangeAt(0);
      if (range.collapsed) {
        clearSelection(origin);
        return false;
      }

      clearNativeSelectionRef.current = (origin) => {
        (win?.getSelection?.() ?? doc.getSelection?.())?.removeAllRanges();
        acknowledgeReadingSelection(doc, origin);
      };

      const rects = getSelectionOverlayRects(range)
        .map((rect) => visibleFrameRectInRoot(rect, mapping))
        .filter((rect): rect is SelectionOverlayRect => rect != null);

      if (rects.length === 0) {
        clearSelection(origin);
        return false;
      }

      let cfiRange: string | null = null;
      try {
        cfiRange = view.getCFI(index, range);
      } catch {
        cfiRange = null;
      }

      const identity = selectionContentRef.current;
      const captured = captureReadingSelection(identity, view, index, range, text);
      const nextSelection: ReaderSelectionState = {
        anchorRect: rects[rects.length - 1] ?? null,
        appearance: "selection",
        cfiRange,
        chapterHref: currentChapterHrefRef.current,
        rects,
        text,
        context: getSelectionContext(range, text),
        captured,
      };

      setActiveAnnotation(null);
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
      acknowledgeReadingSelection(doc, origin);
      if (identity) readingRuntime.selectionChanged(identity.sessionId, captured, origin);
      if (suppressContentClick) armContentClickSuppression();
      // iOS：原生选中菜单会和 app 的选择菜单叠成双份（#10）。捕获完成后立刻
      // 清掉原生选区——菜单没了依附；高亮由 ReaderSelectionHighlight 自绘补回。
      if (isIOS()) clearNativeSelectionRef.current?.(origin);

      return true;
    },
    [armContentClickSuppression, clearSelection],
  );

  // ----- chapter navigation (refs so stable across renders) -----------------

  const goToChapter = useCallback(
    async (href: string) => {
      const view = viewRef.current;
      if (!view) return;
      try {
        setError(null);
        clearSelection();
        if (selectedBookId && readingRuntime.snapshot().bookId === selectedBookId) {
          await readingRuntime.navigate({ bookId: selectedBookId, href });
        } else await view.goTo(href);
      } catch (nextError) {
        setError(describeReaderFailure(nextError));
      }
    },
    [clearSelection, describeReaderFailure, selectedBookId],
  );

  const revisitFromCompletion = useCallback(
    (cfiRange: string) => {
      const view = viewRef.current;
      const sessionId = readingRuntime.snapshot().sessionId;
      dismissCompletion();
      if (completionRevisitTimerRef.current != null) window.clearTimeout(completionRevisitTimerRef.current);
      // Keep the fade, but never apply an old completion card to a replacement book.
      completionRevisitTimerRef.current = window.setTimeout(() => {
        completionRevisitTimerRef.current = null;
        if (viewRef.current === view && readingRuntime.snapshot().sessionId === sessionId) void goToChapter(cfiRange);
      }, COMPLETION_FADE_MS);
    },
    [dismissCompletion, goToChapter],
  );

  /** Jump to a position in the book by fraction — the header progress bar's
   *  scrub target. The engine maps it back through its section sizes, so the
   *  landing spot matches the fraction it reports while reading. Behind the
   *  cross-fade: the scrub lands wherever the reader was not looking, and a
   *  hard swap of the page reads as a glitch. */
  const goToFraction = useCallback(
    async (fraction: number) => {
      const view = viewRef.current;
      if (!view) return;
      setError(null);
      clearSelection();
      // The relocate this lands is a jump the user asked for from the header, not
      // a page turn away from it — it must not take the chrome down with it.
      suppressShellDismissRef.current = true;
      await crossTo(async () => {
        try {
          const target = Math.min(1, Math.max(0, fraction));
          if (selectedBookId && readingRuntime.snapshot().bookId === selectedBookId) {
            await readingRuntime.navigate({ bookId: selectedBookId, fraction: target });
          } else await viewRef.current?.goToFraction(target);
        } catch (nextError) {
          setError(describeReaderFailure(nextError));
        }
      });
      suppressShellDismissRef.current = false;
    },
    [clearSelection, crossTo, describeReaderFailure, selectedBookId],
  );

  const goToAdjacentChapter = useCallback(
    async (direction: -1 | 1) => {
      const session = readingRuntime.snapshot();
      if (selectedBookId && session.bookId === selectedBookId && session.sessionId) {
        setError(null);
        clearSelection();
        try {
          await readingRuntime.step(direction === 1 ? "next-chapter" : "previous-chapter", undefined, {
            bookId: selectedBookId,
            sessionId: session.sessionId,
          });
        } catch (error) {
          setError(describeReaderFailure(error));
        }
      } else {
        const next = adjacentTocEntry(tocEntriesRef.current, currentChapterHrefRef.current, direction);
        if (next) await goToChapter(next.href);
      }
    },
    [clearSelection, describeReaderFailure, goToChapter, selectedBookId],
  );

  // ----- plugin-defined text-unit mode ----------------------------------------

  // Fixed-layout books have no reflowable text to segment; the mode never
  // activates there (the shell hides its toggle via onFixedLayoutChange).
  const textUnitModeEngineActive = textUnitModeActive && textUnitMode !== null && !isFixedLayout;
  const textUnitModeSuspended = textUnitModeActive && textUnitMode === null;

  const emitFixedLayoutChange = useEffectEvent((fixedLayout: boolean) => onFixedLayoutChange?.(fixedLayout));
  useEffect(() => {
    emitFixedLayoutChange(isFixedLayout);
  }, [isFixedLayout]);
  const emitTextUnitModeStep = useEffectEvent(() => onTextUnitModeStep?.());

  // Host behavior settings (step unit, tap-to-advance, scroll-to-step, bar
  // readouts) — stored in the mode plugin's own settings object, edited on
  // its settings page. The section-document listeners read them at event time
  // through `textUnitGestures`.
  const [textUnitModeSettings, patchTextUnitModeSettings] = useAtom(textUnitModeSettingsAtom);
  const persistedModeState = useMemo(
    () => (selectedBookId ? readTextUnitModeState(selectedBookId) : null),
    [selectedBookId],
  );
  const prefsUnitId = textUnitMode ? textUnitModeSettings.unitId : null;
  const persistedUnitId =
    textUnitMode &&
    persistedModeState &&
    (persistedModeState.modeKey === null || persistedModeState.modeKey === textUnitMode.key)
      ? persistedModeState.unitId
      : null;
  const preferredUnitId = modeRequest?.unitId ?? prefsUnitId ?? persistedUnitId;
  const resolvedModeUnit = textUnitMode ? resolveReaderModeUnit(textUnitMode, preferredUnitId) : null;
  const activeUnitId = resolvedModeUnit?.id ?? preferredUnitId ?? "mode-unavailable";
  useEffect(() => {
    if (modeController || !textUnitMode || !resolvedModeUnit) return;
    if (textUnitModeSettings.unitId !== resolvedModeUnit.id) {
      patchTextUnitModeSettings({ unitId: resolvedModeUnit.id });
    }
  }, [modeController, patchTextUnitModeSettings, resolvedModeUnit, textUnitMode, textUnitModeSettings.unitId]);
  /** The text-unit mode's gesture policy, as of now — for listeners that
   *  outlive the render that attached them. */
  const textUnitGestures = useEffectEvent(() => ({
    active: textUnitModeEngineActive,
    tapToAdvance: textUnitModeSettings.tapToAdvance,
    scrollToStep: textUnitModeSettings.scrollToStep,
  }));

  const textUnitNavigator = useTextUnitNavigator({
    configurationRevision: modeRequest?.revision,
    configurationOrigin: modeRequest?.origin,
    onPersistence: modeController?.persistPosition,
    active: textUnitModeEngineActive,
    suspended: textUnitModeSuspended,
    bookId: selectedBook?.id ?? null,
    modeKey: textUnitMode?.key ?? null,
    unitId: activeUnitId,
    segmentText: textUnitMode?.segmentText ?? EMPTY_READER_SEGMENTER,
    viewRef,
    readerRootRef,
    veilColor: readerPalette.bg,
    onResumeChange: reportReadingModeResume,
  });
  useEffect(
    () => modeController?.bindPositionWaiter(textUnitNavigator.waitForPosition),
    [modeController, textUnitNavigator.waitForPosition],
  );
  useEffect(
    () => modeController?.bindStepper(textUnitNavigator.stepNative),
    [modeController, textUnitNavigator.stepNative],
  );
  // Feedback is keyed on where the position points; a new object for the same place is not news.
  const navigatorPosition = useEffectEvent(() => textUnitNavigator.position);
  useEffect(() => {
    modeController?.feedback(
      textUnitNavigator.configurationRevision,
      textUnitMode?.key ?? null,
      activeUnitId,
      {
        status: textUnitNavigator.status,
        errorCode: textUnitNavigator.errorCode,
        progress: textUnitNavigator.progress,
        cfiRange: textUnitNavigator.current?.cfiRange ?? null,
        position: navigatorPosition(),
      },
      textUnitNavigator.origin,
    );
  }, [
    modeController,
    textUnitMode,
    activeUnitId,
    textUnitNavigator.configurationRevision,
    textUnitNavigator.status,
    textUnitNavigator.errorCode,
    textUnitNavigator.progress,
    textUnitNavigator.current,
    textUnitNavigator.position?.location.cfi,
    textUnitNavigator.position?.location.contentVersion,
    textUnitNavigator.origin,
  ]);
  const readAloud = useReadAloud({
    bookId: selectedBook?.id ?? null,
    enabled: textUnitModeEngineActive,
    current: textUnitNavigator.current,
    origin:
      modeRequest && modeRequest.revision !== textUnitNavigator.configurationRevision
        ? modeRequest.origin
        : textUnitNavigator.origin,
    peekNext: textUnitNavigator.peekNext,
  });
  const {
    copyTargetText,
    handleHighlight,
    handleUnderline,
    handleAddNote,
    handleLookUp,
    handleAskAI,
    handleRecolorAnnotation,
    handleRemoveAnnotation,
    handleAddNoteForAnnotation,
    handleAskAIAboutAnnotation,
    handleNavigatorMark,
    handleNavigatorAddNote,
    handleNavigatorLookUp,
    handleNavigatorAskAI,
    openExistingNote,
    pluginInputForSource,
    noteEditor,
  } = useReaderTextActions({
    selectedBook,
    selection,
    activeAnnotation,
    setActiveAnnotation,
    textUnitNavigator,
    clearSelection,
    notesRef,
    currentChapterHrefRef,
  });

  // The engine's listeners outlive this render; they reach the navigator
  // (whose identity changes every render) as of the moment they fire.
  const currentTextUnitNavigator = useEffectEvent(() => textUnitNavigator);

  // 导航条的面板直达按钮：意图 atom 由 session（点亮 chrome）与
  // ReaderShellOverlay（打开目标面板）各自消费。
  const dispatchPanelIntent = useSetAtom(readerPanelIntentAtom);
  const openReaderPanel = useCallback(
    (panel: ReaderPanelKind) => {
      const id = selectedBook?.id;
      if (id) dispatchPanelIntent(createReaderPanelIntent(id, panel));
    },
    [dispatchPanelIntent, selectedBook?.id],
  );

  // ── Touch: the hold menu stands in for the navigator bar ──────────────────
  // A finger held on the page opens the resting unit's actions where it
  // rests; the desktop keeps the floating bar and the anchored sentence menu.
  const coarsePointer = hasCoarsePointer();
  const holdMenuRowRef = useRef<HTMLDivElement | null>(null);
  const holdContent = useTextUnitHoldActions({
    mode: textUnitMode,
    unitId: activeUnitId,
    tapToAdvance: textUnitModeSettings.tapToAdvance,
    canStep: textUnitNavigator.status === "ready" || textUnitNavigator.status === "empty",
    canReturn: textUnitNavigator.canReturn,
    returnPending: textUnitNavigator.hasReturnPoint,
    canAnnotate: textUnitNavigator.status === "ready" && textUnitNavigator.current?.cfiRange != null,
    askAiEnabled,
    readAloud: {
      available: readAloud.available,
      playing: readAloud.playing,
      canStart: readAloud.snapshot.unavailableReason === null,
      toggle: readAloud.toggle,
    },
    pluginInput: pluginInputForSource("navigator"),
    on: {
      highlight: () => {
        void handleNavigatorMark("highlight");
      },
      underline: () => {
        void handleNavigatorMark("underline");
      },
      addNote: handleNavigatorAddNote,
      askAI: handleNavigatorAskAI,
      copy: () => {
        void copyTargetText(textUnitNavigator.current?.text ?? "");
      },
      prev: textUnitNavigator.prev,
      next: textUnitNavigator.next,
      returnToCurrent: textUnitNavigator.returnToCurrent,
      unitChange: (unitId) => {
        if (onModeUnitChange) onModeUnitChange(unitId);
        else patchTextUnitModeSettings({ unitId });
      },
      openPanel: openReaderPanel,
      exit: () => onExitTextUnitMode?.(),
    },
  });
  const holdActionsRef = useRef(holdContent.actions);
  holdActionsRef.current = holdContent.actions;
  const holdMenu = useReaderHoldMenu({
    enabled: textUnitModeEngineActive && coarsePointer,
    readerRootRef,
    menuRef: holdMenuRowRef,
    liveDocuments: () => viewRef.current?.renderer?.getContents().map((content) => content.doc) ?? [],
    run: (index) => holdActionsRef.current[index]?.run(),
    itemCount: holdContent.actions.length + 1,
  });
  // Touch: the tap on the resting sentence opens the hold menu where the
  // finger landed (or closes it when it is already open).
  const toggleHoldMenuAt = useEffectEvent((doc: Document, clientX: number, clientY: number) => {
    if (holdMenu.isOpen()) {
      holdMenu.close();
      return;
    }
    const mapping = measureSectionToRoot(doc, readerRootRef.current);
    const anchor = mapping ? framePointAnchorInRoot({ x: clientX, y: clientY }, mapping) : null;
    if (anchor) holdMenu.openAt({ x: anchor.left, y: anchor.top });
  });

  // A hidden gesture gets one introduction per device, the first time the
  // mode is entered on a touch screen.
  const { toast } = useToast();
  useEffect(() => {
    if (!(textUnitModeEngineActive && coarsePointer)) return;
    if (localKV.getItem(HOLD_MENU_HINT_KEY)) return;
    localKV.setItem(HOLD_MENU_HINT_KEY, "1");
    toast({ description: t("holdMenu.hint"), duration: 8000 });
  }, [coarsePointer, t, textUnitModeEngineActive, toast]);

  // Stepping to another unit is a "resume reading" gesture: it dismisses
  // overlays raised for the one left behind (footnote and annotation menu)
  // because their content is stale the moment the wash moves on, and
  // hands the workspace the cue to drop the shell chrome, taking the TOC/chat
  // panels with it. Keyed on the resting unit so every step entry point
  // (bar, keyboard, volume keys, tap-to-advance, scroll-to-step) is covered. The
  // note editor is deliberately spared: auto-closing it would discard whatever
  // the user has typed.
  const textUnitTargetKey = textUnitNavigator.current
    ? (textUnitNavigator.current.cfiRange ?? textUnitNavigator.current.text)
    : null;
  const previousTextUnitTargetKeyRef = useRef(textUnitTargetKey);
  useEffect(() => {
    if (previousTextUnitTargetKeyRef.current === textUnitTargetKey) return;
    previousTextUnitTargetKeyRef.current = textUnitTargetKey;
    // Losing the unit (deactivation, section unload) is not a step.
    if (textUnitTargetKey == null) return;
    sessionTimerActivityRef.current?.();
    setFootnote(null);
    setActiveAnnotation(null);
    setUnitMenuAnchor(null);
    emitTextUnitModeStep();
  }, [textUnitTargetKey, setFootnote]);

  // 句级菜单的其余关闭时机：拉出选区（选区菜单接管）、模式关闭、页移
  // （锚点随布局失效；步进换句已在上面的 targetKey effect 里关）。
  useEffect(() => {
    if (selection) setUnitMenuAnchor(null);
  }, [selection]);
  useEffect(() => {
    if (!textUnitModeEngineActive) setUnitMenuAnchor(null);
  }, [textUnitModeEngineActive]);

  /** Step the text-unit mode's wash — the wheel, touch, tap and key gestures'
   *  shared action, always against the current navigator. */
  const stepTextUnit = useEffectEvent((direction: -1 | 1) => {
    if (direction > 0) textUnitNavigator.next();
    else textUnitNavigator.prev();
  });

  // ----- page-turn input preferences ----------------------------------------

  const pageTurnSettings = useAtomValue(pageTurnSettingsAtom);

  /** The page turn a content click at this section point asks for under the
   *  tap-zone preference, or null (zones off, or the center band). Zones are
   *  measured across the whole reader, so a spread's two pages share them. */
  const pageTurnTapAt = useEffectEvent((doc: Document, event: MouseEvent): PageTurnTap | null => {
    if (pageTurnSettings.tapZones === "off") return null;
    const mapping = measureSectionToRoot(doc, readerRootRef.current);
    if (!mapping) return null;
    const point = framePointToRoot({ x: event.clientX, y: event.clientY }, mapping);
    return resolvePageTurnTap({
      x: point.x,
      width: mapping.rootRect.width,
      zones: pageTurnSettings.tapZones,
      zoneWidth: pageTurnSettings.tapZoneWidth,
      rtl: viewRef.current?.book?.dir === "rtl",
    });
  });

  /** Turn as the arrow keys do: a zoomed fixed-layout page pans a screenful
   *  toward the turn first, and reading on from the last page opens the
   *  completion screen (turnPage asks isAtEndOfBook). */
  const turnPageByTap = useEffectEvent((tap: PageTurnTap) => {
    if (fixedLayoutZoom.panByKey("x", tap.side)) return;
    void turnPage(tap.step);
  });

  // Android volume keys turn pages while the preference is on, exactly like
  // ArrowDown/ArrowUp. An active text-unit mode claims the keys for stepping
  // instead (useTextUnitNavigator), so the two never hold them at once.
  useVolumeKeySteps(pageTurnSettings.volumeKeys && !textUnitModeEngineActive && !isLoading && !error, (step) => {
    if (!loadedBookRef.current) return;
    if (!fixedLayoutZoom.panByKey("y", step)) void turnPage(step);
  });

  // ----- wheel / touch navigation routing -----------------------------------

  // Discrete-gesture state for the wheel stream, shared by every surface the
  // wheel handler is attached to (section documents + the reader root).
  const wheelGesturesRef = useRef<{ step: WheelGesture; pageTurn: WheelGesture } | null>(null);
  if (wheelGesturesRef.current == null) {
    wheelGesturesRef.current = {
      step: createWheelGesture({ threshold: WHEEL_STEP_THRESHOLD_PX }),
      pageTurn: createWheelGesture({ threshold: WHEEL_PAGE_TURN_THRESHOLD_PX }),
    };
  }

  // Ground-truth gesture phases from the shell (macOS): both machines learn
  // when fingers touch and when momentum starts/ends, which replaces their
  // timing heuristics with exact once-per-swipe behavior. Elsewhere no edges
  // ever arrive and the machines keep their heuristics.
  useEffect(() => {
    const gestures = wheelGesturesRef.current;
    if (!gestures) return;
    return subscribeWheelPhaseEdges((edge) => {
      gestures.step.notifyPhase(edge);
      gestures.pageTurn.notifyPhase(edge);
    });
  }, []);

  // One clock for the gesture machines, anchored to the main window's
  // performance.now(). `event.timeStamp` is relative to each document's own
  // time origin — a section iframe's clock starts near zero when the section
  // loads, while the reader root's counts from app launch — so a gesture whose
  // events straddle the two listener surfaces (or a section swap mid-momentum)
  // would jump the raw clock by minutes, which the machine reads as a quiet
  // gap: it unlatches against the swipe's leftover momentum and fires a
  // second, phantom turn. Translate every timestamp with a min-tracked
  // per-target offset instead of stamping arrival time directly: within one
  // document the hardware spacing is preserved (a delivery stall can only
  // overestimate an offset candidate, never shrink the tracked minimum), and
  // across documents the origins line up on one axis.
  const wheelClockOffsetsRef = useRef(new WeakMap<EventTarget, number>());
  const wheelEventTime = useCallback((event: WheelEvent): number => {
    const target = event.currentTarget;
    const now = performance.now();
    if (!target) return now;
    const offsets = wheelClockOffsetsRef.current;
    const candidate = now - event.timeStamp;
    const known = offsets.get(target);
    const offset = known == null ? candidate : Math.min(known, candidate);
    offsets.set(target, offset);
    return event.timeStamp + offset;
  }, []);

  // Route a wheel event by axis and mode:
  // - Paginated layouts: a mostly-horizontal delta is a trackpad two-finger
  //   swipe — turn one page per gesture, in the swipe's physical direction
  //   (goLeft/goRight keep it correct in RTL books).
  // - Navigator with scroll-to-step on: the wheel is claimed for stepping —
  //   one step per gesture (scroll down / swipe up = forward), never a scroll.
  // - Paginated layouts, mostly-vertical delta: nothing scrolls vertically in
  //   a paginated layout, so the wheel turns the page — a mouse's scroll
  //   wheel's only axis (issue #20), and a vertical trackpad swipe. Scroll
  //   down reads forward; turnPage's logical next/prev stays correct in RTL
  //   books and ends at the completion screen. ctrl+wheel is a trackpad
  //   pinch, never a page turn.
  // - Otherwise: scroll mode's shell-dismissal and section-crossing
  //   accumulators, as before.
  // Fixed-layout books come first: ctrl+wheel zooms their pages, and a page
  // zoomed past the viewport pans before it turns — a gesture that moved the
  // page is spent on that, so only a new one at the edge turns it.
  const handleWheelEvent = useEffectEvent((event: WheelEvent) => {
    const gestures = wheelGesturesRef.current;
    if (!gestures) return;
    if (fixedLayoutZoom.handleZoomWheel(event)) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (readingModeRef.current !== "scroll" && !event.ctrlKey && fixedLayoutZoom.panByWheel(event)) {
      gestures.pageTurn.claim(horizontal ? event.deltaX : event.deltaY, wheelEventTime(event));
      return;
    }
    if (readingModeRef.current !== "scroll" && horizontal) {
      // Without preventDefault the webview may read the swipe as overscroll
      // or a history-navigation gesture.
      if (event.cancelable) event.preventDefault();
      const turned = gestures.pageTurn.feed(event.deltaX, wheelEventTime(event));
      if (turned !== 0) {
        clearSelection();
        // Forward goes through advancePage so the last page opens the
        // completion screen; backward can always just queue.
        if (turned > 0) advancePage(() => viewRef.current?.goRight?.());
        else enqueuePageTurn(() => viewRef.current?.goLeft?.());
      }
      return;
    }
    if (textUnitModeEngineActive && textUnitModeSettings.scrollToStep) {
      if (event.cancelable) event.preventDefault();
      const stepped = gestures.step.feed(event.deltaY, wheelEventTime(event));
      if (stepped !== 0) stepTextUnit(stepped > 0 ? 1 : -1);
      return;
    }
    if (readingModeRef.current !== "scroll" && !event.ctrlKey) {
      if (event.cancelable) event.preventDefault();
      // The SAME machine as the horizontal branch, so a diagonal swipe (each
      // event routed by its dominant axis) accumulates as one gesture instead
      // of firing once per axis.
      const turned = gestures.pageTurn.feed(event.deltaY, wheelEventTime(event));
      if (turned !== 0) void turnPage(turned);
      return;
    }
    dismissShellOnScrollDistanceRef.current(event.deltaY);
    handleWheelCrossingRef.current(event.deltaY);
  });

  // Touch counterpart, one tracker per surface. A finger drag scrolls natively
  // inside a section, but at the top/bottom edge it moves nothing and emits no
  // wheel events — so the drag's travel feeds the same crossing/dismissal
  // accumulators (finger up = content forward = positive wheel delta; screenY
  // so the value is unaffected by any scrolling of the frame itself). While the
  // navigator's scroll-to-step option is on, the swipe is claimed instead: no
  // native scroll, and one step per touch once the drag travels far enough and
  // is clearly vertical — mostly-horizontal drags stay with the paginator's
  // own page-drag handling. The returned handlers read the mode's gesture
  // policy at event time, so a tracker outlives settings changes.
  const createTouchNavHandlers = useEffectEvent(() => {
    let touch: { startX: number; startY: number; lastY: number; stepped: boolean } | null = null;
    return {
      onTouchStart: (event: TouchEvent) => {
        const point = event.touches.length === 1 ? event.touches[0] : null;
        touch = point ? { startX: point.screenX, startY: point.screenY, lastY: point.screenY, stepped: false } : null;
      },
      onTouchMove: (event: TouchEvent) => {
        if (!touch || event.touches.length !== 1) return;
        const point = event.touches[0];
        const deltaY = touch.lastY - point.screenY;
        touch.lastY = point.screenY;
        const gestures = textUnitGestures();
        if (gestures.active && gestures.scrollToStep) {
          if (event.cancelable) event.preventDefault();
          if (touch.stepped) return;
          const travelY = touch.startY - point.screenY;
          const travelX = touch.startX - point.screenX;
          if (Math.abs(travelY) < TOUCH_STEP_THRESHOLD_PX || Math.abs(travelY) <= Math.abs(travelX)) {
            return;
          }
          touch.stepped = true;
          stepTextUnit(travelY > 0 ? 1 : -1);
          return;
        }
        dismissShellOnScrollDistanceRef.current(deltaY);
        handleWheelCrossingRef.current(deltaY, TOUCH_SECTION_CROSS_OVERSCROLL_PX);
      },
      onTouchEnd: () => {
        touch = null;
      },
    };
  });

  // Reads the latest props, selection actions and navigator at key time; the
  // window and every section document listen through it.
  const handleReaderKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    // Foliate renders every section in an iframe, whose keyboard events never
    // reach app-global shortcuts. Forward them first, then leave claimed chords
    // (Command Palette, Settings, plugin commands) out of reader navigation.
    if (event.currentTarget !== window) {
      forwardKeyDownToApp(event);
      if (event.defaultPrevented) return;
    }
    if (!loadedBookRef.current) return;
    if (isEditableKeyTarget(event.target)) return;

    // Configurable reader shortcuts, checked before the modifier guard so a
    // rebinding may include modifiers. Left/right page turns are direction-aware
    // (RTL-correct).
    const shortcut = appShortcutForEvent(event);
    if (event.defaultPrevented) return;
    // Page zoom is a fixed-layout control; a reflowable book sizes its text
    // through the appearance settings instead.
    if (isFixedLayoutRef.current && (shortcut === "zoom-in" || shortcut === "zoom-out" || shortcut === "zoom-reset")) {
      event.preventDefault();
      if (shortcut === "zoom-reset") fixedLayoutZoom.resetZoom();
      else fixedLayoutZoom.stepZoom(shortcut === "zoom-in" ? 1 : -1);
      return;
    }
    // Paged flows only: a continuous scroll is read by scrolling.
    if (isFixedLayoutRef.current && shortcut === "zoom-lock" && readingModeRef.current !== "scroll") {
      event.preventDefault();
      fixedLayoutZoom.toggleLock();
      return;
    }
    // A zoomed fixed-layout page pans a screenful toward the turn before it
    // turns (see handleWheelEvent).
    if (shortcut === "next-page") {
      event.preventDefault();
      if (fixedLayoutZoom.panByKey("x", 1)) return;
      advancePage(() => viewRef.current?.goRight?.());
      return;
    }
    if (shortcut === "prev-page") {
      event.preventDefault();
      if (fixedLayoutZoom.panByKey("x", -1)) return;
      enqueuePageTurn(() => viewRef.current?.goLeft?.());
      return;
    }
    if (shortcut === "next-chapter") {
      event.preventDefault();
      void goToAdjacentChapter(1);
      return;
    }
    if (shortcut === "prev-chapter") {
      event.preventDefault();
      void goToAdjacentChapter(-1);
      return;
    }
    // Toggles the reader shell (the chrome), not the page — peeking at the
    // controls shouldn't also advance your place.
    if (shortcut === "toggle-controls") {
      event.preventDefault();
      onContentClick?.();
      return;
    }

    // Text-unit mode only. Its step keys intercept
    // ahead of the hardcoded ArrowUp/Down page scroll below; the selection
    // action keys double as actions on the resting unit while no text is
    // selected (a live selection keeps first claim on them, further down).
    if (textUnitModeEngineActive) {
      if (shortcut === "reader-mode-next-unit") {
        event.preventDefault();
        textUnitNavigator.next();
        return;
      }
      if (shortcut === "reader-mode-prev-unit") {
        event.preventDefault();
        textUnitNavigator.prev();
        return;
      }
      if (!selectionRef.current && textUnitNavigator.current) {
        if (shortcut === "selection-copy") {
          event.preventDefault();
          void copyTargetText(textUnitNavigator.current.text);
          return;
        }
        if (shortcut === "selection-highlight") {
          event.preventDefault();
          void handleNavigatorMark("highlight");
          return;
        }
        if (shortcut === "selection-underline") {
          event.preventDefault();
          void handleNavigatorMark("underline");
          return;
        }
        if (shortcut === "selection-add-note") {
          event.preventDefault();
          handleNavigatorAddNote();
          return;
        }
        if (shortcut === "selection-look-up") {
          event.preventDefault();
          handleNavigatorLookUp();
          return;
        }
        if (askAiEnabled && shortcut === "selection-ask-ai") {
          event.preventDefault();
          handleNavigatorAskAI();
          return;
        }
      }
    }

    // Selection actions — only while text is selected (the selection menu is
    // up). Checked before the modifier guard so a rebinding may include
    // modifiers. Fixed-layout books (PDF, comics) annotate too: a selection can
    // only exist where the page has a text layer, and that is exactly where an
    // annotation can be anchored. Ask AI still needs AI configured.
    if (selectionRef.current) {
      if (shortcut === "selection-copy") {
        event.preventDefault();
        // Copy also clears the selection so a keyboard copy gives the same
        // "done" feedback (menu dismissed) the other actions do; the rest
        // clear themselves.
        void copyTargetText(selectionRef.current.text);
        clearSelection();
        return;
      }
      if (shortcut === "selection-highlight") {
        event.preventDefault();
        void handleHighlight();
        return;
      }
      if (shortcut === "selection-underline") {
        event.preventDefault();
        handleUnderline();
        return;
      }
      if (shortcut === "selection-add-note") {
        event.preventDefault();
        handleAddNote();
        return;
      }
      if (shortcut === "selection-look-up") {
        event.preventDefault();
        handleLookUp();
        return;
      }
      if (askAiEnabled && shortcut === "selection-ask-ai") {
        event.preventDefault();
        handleAskAI();
        return;
      }
    }

    // Another surface's binding must not also trigger the vertical fallback.
    if (isAppSurfaceShortcut(shortcut) || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      if (selectionRef.current) clearSelection();
      else if (textUnitModeEngineActive) onExitTextUnitMode?.();
    }
    // Vertical keys map to forward/back directly, a zoomed fixed-layout page
    // panning through first.
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      if (!fixedLayoutZoom.panByKey("y", 1)) void turnPage(1);
    }
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      if (!fixedLayoutZoom.panByKey("y", -1)) void turnPage(-1);
    }
  });

  // ----- per-section listeners (attached on each `load`) --------------------

  /** A click in a section document: hold-menu and mark taps, dismissals,
   *  tap-to-advance, and the (double-click guarded) shell toggle. Runs with
   *  the latest props and state however long ago the document was attached. */
  const handleSectionClick = useEffectEvent((doc: Document, index: number, event: MouseEvent) => {
    // The click a touch synthesizes after a hold gesture is not a tap; and
    // while the hold menu rests open, a tap on the page only dismisses it.
    if (holdMenu.consumeClick()) {
      cancelPendingShellOpen();
      return;
    }
    if (holdMenu.isOpen()) {
      holdMenu.close();
      cancelPendingShellOpen();
      return;
    }
    // Tapping an existing mark opens its recolor menu (via `show-annotation`);
    // skip the tap-to-toggle-shell handling so the two don't fight.
    const hit = viewRef.current?.renderer
      ?.getContents?.()
      .find((content) => content.index === index)
      ?.overlayer?.hitTest({ x: event.clientX, y: event.clientY });
    if (hit && hit[0]) {
      // hitTest 回的是绘制的 value（CFI），不是 overlayKey —— 与静息句的
      // cfiRange 相等即命中导航 wash：在点击处开合句级动作菜单（用户标注的
      // 命中仍走 show-annotation 的重着色菜单，互不相扰）。触屏点按即前进时
      // 静息句可能走到手指下方，这一下会打断步进去开菜单——这是读者要的：
      // 菜单就长在句子上，点菜单外再继续步进。
      const tap = resolveDrawnRangeTap({
        hitValue: hit[0],
        restingCfi: textUnitNavigator.current?.cfiRange,
        modeActive: textUnitModeEngineActive,
      });
      cancelPendingShellOpen();
      if (tap === "unit-menu") {
        // Touch has one sentence menu — the hold menu — opened by tap or hold alike.
        if (hasCoarsePointer()) toggleHoldMenuAt(doc, event.clientX, event.clientY);
        else toggleUnitMenuAt(doc, event.clientX, event.clientY);
      }
      return;
    }
    // A tap on empty content dismisses any open recolor menu.
    setActiveAnnotation(null);
    setUnitMenuAnchor(null);
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

    // Let in-book links and controls handle their own taps. (Book content is
    // XHTML, so match by localName rather than a `closest("a, …")` selector.)
    if (isInteractiveTarget(event.target)) {
      return;
    }

    // By default a tap on book content only toggles the reader shell — it
    // never turns the page. Page turns use the wheel, swipe, keyboard or page
    // controls, so a stray click while reading can't cost you your place; tap
    // zones that turn pages are an opt-in reading preference (below).
    cancelPendingShellToggle();

    // Closing needs no double-click guard. The guard exists solely to stop a
    // word-selecting double-click from flashing the shell *open* mid-select;
    // dismissing it has no such hazard — the first click closes it as a smooth
    // slide-out, and if the tap turns out to be a double-click, selecting the
    // word underneath a dismissed shell is fine. Deferring the close would only
    // make a single tap feel laggy, so close immediately.
    if (shellVisibleRef.current) {
      onContentClick?.();
      return;
    }

    // Navigator tap-to-advance: while the mode is on, a quick tap on the
    // page is the step-forward gesture (immediately — the double-click guard
    // below would make rapid stepping feel laggy; word selection by double
    // click is disarmed for the mode's duration in the mousedown listener).
    // The dismissed-shell branch above still wins, so a tap with the chrome
    // open closes it first and the next tap steps.
    if (textUnitModeEngineActive && textUnitModeSettings.tapToAdvance) {
      stepTextUnit(1);
      return;
    }

    // Tap zones (an opt-in reading preference): a quick tap on a side zone
    // turns the page at once, the center band falls through to the shell
    // toggle. A word-selecting double-click is disarmed inside the zones by
    // the mousedown listener, as for tap-to-advance, so no guard is needed.
    const pageTurnTap = pageTurnTapAt(doc, event);
    if (pageTurnTap) {
      turnPageByTap(pageTurnTap);
      return;
    }

    // Only a mouse double-clicks to select a word. A touch selects by holding
    // (which never reaches here as a tap), and a quick second tap is just
    // another tap, so the guard below would only make the shell slow to
    // appear: a touch opens it at once.
    if (shellTapPointerRef.current === "touch") {
      onContentClick?.();
      return;
    }

    // Opening is deferred: a double-click lands within the guard window
    // (cancelled by the `dblclick` listener below) or leaves a selection
    // behind, either of which suppresses the toggle so selecting a word no
    // longer flashes the shell. A plain single tap toggles after the wait.
    pendingShellToggleTimerRef.current = window.setTimeout(() => {
      pendingShellToggleTimerRef.current = null;
      if (selectionRef.current) return;
      const liveSelection = doc.defaultView?.getSelection?.();
      if (liveSelection && liveSelection.rangeCount > 0 && !liveSelection.getRangeAt(0).collapsed) {
        return;
      }
      emitContentClick();
    }, SHELL_TOGGLE_DBLCLICK_GUARD_MS);
  });

  /**
   * Wire a freshly loaded section document. Runs once per document (see the
   * engine's `load` handler); its listeners live as long as the document and
   * reach reactive values only through effect events and refs, never through
   * this render's closure.
   */
  const attachDocListeners = useEffectEvent((doc: Document, index: number) => {
    // Desktop: kill the webview's native right-click menu inside book content too.
    suppressNativeContextMenu(doc);
    // Touch: a held finger opens the text-unit mode's action menu. Listeners
    // live as long as the section document does.
    holdMenu.attach(doc);

    // Reading-activity signal for the time tracker. Pointer movement, keys,
    // scrolling, and wheel inside the book all mean "still reading" — vital in
    // scroll mode, where there are no page turns and a reader can linger on one
    // screenful. These events never bubble out of the iframe, so they must be
    // observed on the section document; capture+passive keeps it unobtrusive.
    const bumpReadingActivity = () => emitReadingActivity();
    const activityOptions = { passive: true, capture: true } as const;
    doc.addEventListener("pointermove", bumpReadingActivity, activityOptions);
    doc.addEventListener("pointerdown", bumpReadingActivity, activityOptions);
    doc.addEventListener("keydown", bumpReadingActivity, activityOptions);
    doc.addEventListener("wheel", bumpReadingActivity, activityOptions);
    doc.addEventListener("scroll", bumpReadingActivity, activityOptions);

    doc.addEventListener("keydown", (event) => handleReaderKeyDown(event));

    // Fixed-layout page zoom: trackpad and two-finger pinches over the page.
    fixedLayoutZoom.attachDocument(doc);

    // Fixed-layout page turns by horizontal swipe. The refs are read at
    // gesture time, not attach time: layout detection can land after the
    // first section loads, and the reading mode may change over the doc's
    // lifetime. Short + decisively horizontal keeps long-press selection
    // and vertical scrolling (scroll mode) untouched. A page zoomed past the
    // viewport is dragged around instead, turning only for a swipe that
    // started at its edge on that side.
    {
      let swipeStart: { x: number; y: number; at: number; edges: { left: boolean; right: boolean } } | null = null;
      doc.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.touches[0];
          swipeStart =
            event.touches.length === 1 && touch
              ? { x: touch.screenX, y: touch.screenY, at: Date.now(), edges: fixedLayoutZoom.panEdges() }
              : null;
        },
        { passive: true },
      );
      doc.addEventListener(
        "touchend",
        (event) => {
          const start = swipeStart;
          swipeStart = null;
          if (!start) return;
          if (!isFixedLayoutRef.current || readingModeRef.current === "scroll") return;
          const touch = event.changedTouches[0];
          if (!touch) return;
          const dx = touch.screenX - start.x;
          const dy = touch.screenY - start.y;
          if (Date.now() - start.at > FIXED_SWIPE_MAX_MS) return;
          if (Math.abs(dx) < FIXED_SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) {
            return;
          }
          if (!(dx < 0 ? start.edges.right : start.edges.left)) return;
          // Visual direction: swiping the content leftwards reveals the page
          // on the right, and vice versa — correct under RTL too.
          const view = viewRef.current;
          void (dx < 0 ? view?.goRight() : view?.goLeft())?.catch((error) => setError(describeReaderFailure(error)));
        },
        { passive: true },
      );
    }

    // Touch selection: long-pressing hands the gesture to the system's
    // selection handles and our pointer stream ends in `pointercancel`, so the
    // pointerup capture below never sees a touch-made selection. Watch
    // selectionchange instead and surface the menu once the handles rest;
    // dragging a handle keeps deferring it, releasing re-anchors the menu.
    if (hasCoarsePointer()) {
      let settleTimer: number | null = null;
      doc.addEventListener("selectionchange", (event) => {
        if (settleTimer != null) window.clearTimeout(settleTimer);
        const feedback = readingSelectionFeedback(doc, event);
        if (feedback.handled) {
          settleTimer = null;
          return;
        }
        settleTimer = window.setTimeout(() => {
          settleTimer = null;
          if (!feedback.current() || !viewRef.current?.renderer?.getContents().some((content) => content.doc === doc))
            return;
          const sel = doc.getSelection?.();
          const hasSelection =
            !!sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && getNormalizedSelectionText(sel).length > 0;
          if (hasSelection) {
            captureSelectionFromDoc(doc, index, { suppressContentClick: true, origin: feedback.origin });
          } else if (selectionRef.current) {
            // The system selection was dismissed (tap elsewhere, Cut/Copy…);
            // don't leave our menu floating over nothing.
            clearSelection(feedback.origin);
          }
        }, TOUCH_SELECTION_SETTLE_MS);
      });
    }

    doc.addEventListener(
      "pointerdown",
      (event) => {
        cancelPendingShellOpen();
        const hadSelection = !!selectionRef.current;
        shellTapIntentRef.current = {
          eligible: event.isPrimary && event.button === 0,
          moved: false,
          pointerType: event.pointerType,
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
      },
      true,
    );

    // While a tap steps (tap-to-advance) or turns the page (a tap zone),
    // rapid clicks must not turn into a word-selecting double-click
    // (selection is mousedown's default action at detail > 1) — except over a
    // drawn range (the navigator's resting wash or a user mark), where single
    // clicks don't step or turn anyway (the click handler's hit test routes
    // them to menus), so double-click keeps selecting words there. Drag and
    // long-press selection still work everywhere.
    doc.addEventListener(
      "mousedown",
      (event) => {
        if (event.detail <= 1) return;
        const gestures = textUnitGestures();
        const tapSteps = gestures.active && gestures.tapToAdvance;
        if (!tapSteps && !pageTurnTapAt(doc, event)) return;
        const hit = viewRef.current?.renderer
          ?.getContents?.()
          .find((content) => content.index === index)
          ?.overlayer?.hitTest({ x: event.clientX, y: event.clientY });
        if (hit && hit[0]) return;
        event.preventDefault();
      },
      true,
    );

    doc.addEventListener(
      "pointermove",
      (event) => {
        const intent = shellTapIntentRef.current;
        if (!intent?.eligible || intent.moved) return;
        if (
          Math.abs(event.clientX - intent.startX) > SHELL_TAP_MAX_MOVE_PX ||
          Math.abs(event.clientY - intent.startY) > SHELL_TAP_MAX_MOVE_PX
        ) {
          intent.moved = true;
          intent.eligible = false;
        }
      },
      true,
    );

    doc.addEventListener(
      "pointercancel",
      () => {
        shellTapIntentRef.current = null;
        cancelPendingShellOpen();
      },
      true,
    );

    doc.addEventListener(
      "pointerup",
      () => {
        const intent = shellTapIntentRef.current;
        shellTapIntentRef.current = null;

        const sel = doc.defaultView?.getSelection?.() ?? doc.getSelection?.() ?? null;
        const hasSelection =
          !!sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && getNormalizedSelectionText(sel).length > 0;

        if (hasSelection) {
          captureSelectionFromDoc(doc, index, { suppressContentClick: true });
          shouldOpenShellOnClickRef.current = false;
          return;
        }

        if (intent?.eligible) {
          const wasQuickTap = performance.now() - intent.startedAt <= SHELL_TAP_MAX_DURATION_MS;
          shouldOpenShellOnClickRef.current = wasQuickTap && !intent.startedWithSelection && !selectionRef.current;
          shellTapPointerRef.current = intent.pointerType;
        } else {
          cancelPendingShellOpen();
        }
      },
      true,
    );

    // 掌阅式内联脚注（<img zy-footnote="注文" class="epub-footnote">）：注文
    // 就在属性里 —— 点击直接进现有的脚注弹层。链接式 noteref 走 foliate 的
    // link 事件路径,互不相扰。先于下面的 shell-toggle click 注册,拦下命中。
    doc.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const marker = target?.closest?.("img[zy-footnote], img.epub-footnote, img.zhangyue-footnote");
        if (!marker) return;
        const text = (marker.getAttribute("zy-footnote") ?? marker.getAttribute("alt") ?? "").trim();
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPendingShellToggle();
        setFootnote({
          anchorRect: anchorRectForElement(marker),
          label: footnoteLabel("footnote", tRef.current),
          text,
        });
      },
      true,
    );

    // Tapping an illustration opens the full-screen viewer (issue #13). The
    // footnote intercept above registered first, so its marker images never
    // reach here. Fixed layout stays out: comic and pre-paginated pages ARE
    // images, and a tap there must keep meaning "toggle the shell".
    doc.addEventListener(
      "click",
      (event) => {
        if (isFixedLayoutRef.current) return;
        const image = resolveActivatedImage(event.target);
        if (!image) return;
        const identity = selectionContentRef.current;
        if (!identity?.view.renderer?.getContents().some((content) => content.doc === doc)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPendingShellToggle();
        cancelPendingShellOpen();
        setLightboxImage({ ...image, session: { bookId: identity.bookId, sessionId: identity.sessionId } });
      },
      true,
    );

    doc.addEventListener("click", (event) => handleSectionClick(doc, index, event), true);

    // A double-click selects a word; cancel the toggle its first click queued so
    // the shell doesn't flash up while you're selecting.
    doc.addEventListener("dblclick", cancelPendingShellToggle, true);

    // A native intra-section scroll (anchor jump, focus) should still drop a live
    // selection; shell dismissal is driven by the wheel-distance accumulator and
    // the relocate page check, not by the raw scroll event.
    doc.addEventListener(
      "scroll",
      (event) => {
        if (!viewRef.current?.renderer?.getContents().some((content) => content.doc === doc)) return;
        clearSelection(readingRenderActor(readingInputContext(event)));
      },
      true,
    );

    // Wheel routing (see handleWheelEvent): trackpad page turns in paginated
    // layouts, scroll-to-step while the navigator claims the wheel, and in
    // continuous-scroll mode the section-boundary bridge + the shell's
    // scroll-distance dismissal. Non-passive: the first two must preventDefault.
    doc.addEventListener("wheel", (event) => handleWheelEvent(event), { passive: false });

    // Touch counterpart (see createTouchNavHandlers): without it, touch could
    // never cross into the adjacent chapter in scroll mode, and swipe-to-step
    // would have no touch gesture. Non-passive for the same reason as wheel.
    const touchNav = createTouchNavHandlers();
    doc.addEventListener("touchstart", touchNav.onTouchStart, { passive: true });
    doc.addEventListener("touchmove", touchNav.onTouchMove, { passive: false });
    doc.addEventListener("touchend", touchNav.onTouchEnd);
  });

  // ----- global keydown + viewport resize -----------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleReaderKeyDown(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  useReaderViewportResize({
    viewportRef,
    viewRef,
    selectionRef,
    clearSelection,
    applyMaxInlineSize: applyReaderMaxInlineSize,
  });

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

    // Containment guard for every bridge below: the overlays that render as
    // viewport siblings (image lightbox, selection/annotation menus, footnote
    // popover) bubble their wheel/touch/click events through this host too —
    // React-level stopPropagation can't help, React 19 listens at the app
    // root, ABOVE this native listener on the bubble path. Scrolling, pinch-
    // zooming, or dragging inside an overlay must not move the book under it.
    const insideViewport = (event: Event): boolean => {
      const target = event.target as Node | null;
      return target != null && !!viewportRef.current?.contains(target);
    };

    const onWheel = (event: WheelEvent) => {
      if (!insideViewport(event)) return;
      handleWheelEvent(event);
    };

    // Touch parallel for the same dead zone, with its own per-surface tracker.
    // Every event of a touch sequence targets the element the finger landed
    // on, so the per-event guard admits or excludes whole gestures. touchend
    // stays unguarded: it only clears the tracker, and clearing is always
    // safe — gating it could strand a stale tracker instead.
    const touchNav = createTouchNavHandlers();
    const onTouchStart = (event: TouchEvent) => {
      if (insideViewport(event)) touchNav.onTouchStart(event);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (insideViewport(event)) touchNav.onTouchMove(event);
    };
    const onTouchEnd = () => touchNav.onTouchEnd();

    const onClick = (event: MouseEvent) => {
      if (!insideViewport(event)) return;
      if (selectionRef.current) {
        clearSelection();
        return;
      }
      // Same tap-to-advance routing as clicks inside the book content: the
      // empty area below a short section is still "the page" to a reader.
      const gestures = textUnitGestures();
      if (gestures.active && gestures.tapToAdvance) {
        if (shellVisibleRef.current) {
          emitContentClick();
          return;
        }
        stepTextUnit(1);
        return;
      }
      emitContentClick();
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("click", onClick);
    };
  }, [clearSelection]);

  useEffect(() => {
    return () => {
      cancelPendingShellOpen();
      cancelPendingShellToggle();
      if (completionExitTimerRef.current != null) {
        window.clearTimeout(completionExitTimerRef.current);
      }
      if (completionRevisitTimerRef.current != null) {
        window.clearTimeout(completionRevisitTimerRef.current);
      }
      if (suppressContentClickTimeoutRef.current != null) {
        window.clearTimeout(suppressContentClickTimeoutRef.current);
      }
    };
  }, [cancelPendingShellOpen, cancelPendingShellToggle]);

  // Tapping a mark anchors the recolor/remove menu over it; tapping a note
  // marker opens that note for reading/editing.
  const showAnnotation = useEffectEvent((detail: FoliateShowAnnotationDetail) => {
    const highlight = highlightsRef.current.find((item) => item.cfiRange === detail.value);
    if (!highlight) {
      const note = notesRef.current.find((item) => item.cfiRange === detail.value);
      if (note) {
        openExistingNote(note);
        clearSelection();
      }
      setActiveAnnotation(null);
      return;
    }
    const range = detail.range;
    const mapping = measureSectionToRoot(range?.startContainer?.ownerDocument, readerRootRef.current);
    if (!range || !mapping) {
      setActiveAnnotation(null);
      return;
    }
    const rects = getSelectionOverlayRects(range)
      .map((rect) => visibleFrameRectInRoot(rect, mapping))
      .filter((rect): rect is SelectionOverlayRect => rect != null);
    if (rects.length === 0) {
      setActiveAnnotation(null);
      return;
    }
    clearSelection();
    setActiveAnnotation({ highlight, anchorRect: rects[rects.length - 1] });
  });

  // ----- open the book ------------------------------------------------------

  /**
   * Open `session`'s book into a fresh foliate view. Runs once per engine
   * session (see useReaderEngineSession): only the book, its library id and
   * the reading mode re-open the engine. Everything the engine's listeners
   * need later is reached through effect events and refs, never captured
   * from this render.
   */
  const openEngine = (session: ReaderEngineSession<LoadedBook, DomainActor>) => {
    const container = viewportRef.current;
    if (!container) return;
    // The session's key, not this render's props: they are the same value
    // here, and the key is what the session is for.
    const { source: initialBook, readingMode } = session.key;

    let view: FoliateView | null = null;
    let releaseBook: (() => Promise<void>) | undefined;
    const runtimeSession = readingRuntime.snapshot();
    const sessionId = runtimeSession.bookId === selectedBook?.id ? runtimeSession.sessionId : null;
    const openingActor =
      engineLoadSource.current?.origin ?? (sessionId ? readingRuntime.openingActor(sessionId) : causalActor("system"));
    const openingContext = readingRenderContext(openingActor);
    // Bindings are undone with the retiring actor, or the opening one when
    // the retirement has no cause of its own.
    const defer = (teardown: (origin: DomainActor) => void) =>
      session.onClose((origin) => teardown(origin ?? openingActor));
    const retainParsedBook = (parsed: FoliateBook) => {
      const release = retainBook(parsed);
      releaseBook = release;
      session.onRelease(() => {
        void release().catch((error) => log.warn("Could not close parsed book", error));
      });
    };
    session.onRelease(() => {
      highlightsRef.current = [];
      notesRef.current = [];
    });

    clearSelection(openingActor);
    setIsLoading(true);
    setError(null);
    setTocEntries([]);
    setCurrentChapterHref(null);
    setIsFixedLayout(false);
    // Drop the previous book's position so its first relocate only sets a fresh
    // baseline instead of reading as a page turn.
    prevReadingLocationRef.current = null;
    reportedProgressRef.current = null;
    resetShellScrollTravel();
    resetPageTurnQueue();
    resetCrossing();

    void (async () => {
      try {
        const invalidation = selectedBook ? contentInvalidationRevision(selectedBook.id) : "initial";
        view = await createFoliateView();
        const createdView = view;
        session.onRelease(() => {
          void createdView.close().catch((error) => log.warn("Could not close reader", error));
          createdView.remove();
          if (viewRef.current === createdView) viewRef.current = null;
        });
        if (session.closed) return;
        viewRef.current = view;
        view.style.display = "block";
        view.style.width = "100%";
        view.style.height = "100%";
        container.append(view);

        await registerHighlightDrawing(view);
        let parsedBook: FoliateBook;
        let contentProvider: ReturnType<typeof resolveContentProvider> | undefined;
        let contentVersion = sessionId ? `session:${sessionId}` : "unmanaged";
        if (initialBook.virtual) {
          // Plugin-provided book: resolve the content provider and build a
          // foliate-conforming object — no file, no parser.
          const provider = resolveContentProvider(initialBook.virtual);
          if (!provider) {
            throw new Error("The plugin providing this book is disabled or uninstalled.");
          }
          const content = await provider.load(initialBook.virtual.key);
          if (resolveContentProvider(initialBook.virtual) !== provider) {
            throw new AppError("library/content-unavailable", "Book content provider changed while loading");
          }
          contentProvider = provider;
          contentVersion = await virtualContentVersion(content);
          if (session.closed) return;
          parsedBook = await buildVirtualFoliateBook(content);
        } else {
          const source = initialBook.file;
          if (!source) throw new Error("Missing book file.");
          const file =
            typeof source.name === "string"
              ? source
              : new File([await source.arrayBuffer()], initialBook.fileName, { type: source.type });
          // Parse first, then repair a deficient nav BEFORE the view opens —
          // foliate builds its TOC progress (relocate's tocItem) from book.toc
          // at open time, so the synthesized map has to be in place already.
          parsedBook = await parseBookFile(file);
          retainParsedBook(parsedBook);
          if (session.closed) return;
          // Navigation repaired or rebuilt before is stored with the book's text; reuse it
          // rather than parsing the book again.
          const persisted = selectedBook
            ? await getRepairedNavigation(selectedBook.id).catch((error: unknown) => {
                log.warn("Stored navigation unavailable", error);
                return null;
              })
            : null;
          if (session.closed) return;
          await ensureUsableToc(parsedBook, { persisted });
          if (selectedBook && sessionId) contentVersion = await fileContentVersion(selectedBook.id);
        }
        if (!releaseBook) retainParsedBook(parsedBook);
        if (session.closed) return;
        if (selectedBook && !isFixedLayoutBook(parsedBook)) {
          const language = await detectBookLanguage(parsedBook);
          if (session.closed) return;
          rememberReaderBookLanguage(selectedBook.id, language, openingActor);
          // Seed the very first stylesheet before React's shared-language update
          // arrives. Book overrides still win; opening must not flash the fallback font.
          const override = getReaderOverrides()[selectedBook.id];
          const font =
            override?.scope === "book"
              ? override.settings
              : readerPreferencesForLanguage(getReaderPreferences(), language);
          if (
            readerSettingsRef.current.fontFamily !== font.fontFamily ||
            readerSettingsRef.current.fontWeight !== font.fontWeight
          ) {
            readerSettingsRef.current = stampEventCause(
              { ...readerSettingsRef.current, fontFamily: font.fontFamily, fontWeight: font.fontWeight },
              openingActor,
            );
          }
        }
        // The opening stylesheet is awaited before the first page renders;
        // read its font from this device while the book finishes opening.
        prepareReaderStyles(readerSettingsRef.current);
        if (selectedBook && sessionId)
          defer(
            registerActiveBookContent(
              selectedBook.id,
              parsedBook,
              contentVersion,
              contentProvider,
              invalidation,
              initialBook.virtual?.key,
            ),
          );
        const chapterStarts = readerChapterStarts(parsedBook, await chapterMapFor(parsedBook));
        if (session.closed) return;
        await view.open(parsedBook);
        if (session.closed) return;
        const resetPosition = initialBook.resetPosition && resetPositionSourceRef.current !== initialBook;
        // After open, so the opened position's resting unit resolves against
        // this book; before the first navigation, so its section load finds it.
        // Starting over leaves no unit to rest on.
        if (selectedBook)
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
          currentTextUnitNavigator().handleContentVersion(
            selectedBook.id,
            contentVersion,
            openingActor,
            resetPosition ? null : initialProgress?.readingMode,
          );
        if (view.renderer) view.renderer.inputBridge = readingNativeInput;
        if (view.renderer && "setChapterStarts" in view.renderer) view.renderer.setChapterStarts(chapterStarts);

        const book = view.book;
        const fixedLayout = book ? isFixedLayoutBook(book) : false;
        isFixedLayoutRef.current = fixedLayout;
        setIsFixedLayout(fixedLayout);

        // Apply the chosen reading mode. Both the reflowable paginator and the
        // fixed-layout PDF renderer honor these attributes. Scroll mode keeps
        // the current chapter's source documents; other modes keep a section/spread.
        const { flow, maxColumnCount } = layoutForReadingMode(readingMode);
        // Before the first navigation, so the opening render already draws the
        // page in the reader's palette instead of flashing white and redrawing.
        if (fixedLayout) applyReaderPageColors(readerSettingsRef.current, view.renderer, openingActor);
        // Likewise the book's zoom, so the first page is laid out and
        // rastered at it once.
        if (fixedLayout) fixedLayoutZoom.prepareRenderer(view.renderer, openingContext);
        if (fixedLayout && view.renderer && "setLayout" in view.renderer) {
          // WebKit may defer custom-element attribute reactions until after the
          // first navigation. Configure fixed layout atomically so that first
          // paint cannot race against the old, paired-spread model.
          view.renderer.setLayout(flow, maxColumnCount, openingContext);
        } else {
          if (view.renderer && "setLayoutAttributes" in view.renderer)
            view.renderer.setLayoutAttributes(
              {
                flow,
                "max-column-count": String(maxColumnCount),
              },
              openingContext,
            );
        }
        if (fixedLayout && view.renderer) {
          // Every finished page raster keeps the busy signal fresh while the
          // stack prerenders around a scrolling reader.
          const rendererTarget = view.renderer;
          const onRendered = (event: Event) => {
            if (!session.closed && sessionId)
              emitAppEvent(
                "reader-demand-activity",
                { sessionId, reason: "render" },
                readingRenderActor((event as CustomEvent<object>).detail, openingActor),
              );
          };
          rendererTarget.addEventListener("rendered", onRendered);
          defer(() => rendererTarget.removeEventListener("rendered", onRendered));
        }
        {
          // The margin preset drives the text measure and the paginator gap
          // together (see reader-css.ts). Portrait containers render a single
          // column regardless of max-column-count (see applyReaderMaxInlineSize).
          const width = readerRootRef.current?.clientWidth ?? window.innerWidth;
          const height = readerRootRef.current?.clientHeight ?? window.innerHeight;
          const effectiveColumns = width > height ? maxColumnCount : 1;
          const { gap, margin } = readerLayoutSpacing(readerSettingsRef.current, readingMode);
          if (view.renderer && "setLayoutAttributes" in view.renderer)
            view.renderer.setLayoutAttributes(
              {
                gap,
                margin,
                "max-inline-size": `${computeReaderMaxInlineSize(readerSettingsRef.current, width, effectiveColumns)}px`,
              },
              openingContext,
            );
        }
        // Style the renderer before its first navigation loads a section: the
        // page must never be revealed in the publisher's bare styles, then
        // repaint when the stylesheet lands (a cold start reads the reader
        // font from IndexedDB, which can outlast opening a small book).
        await injectReaderStyles(readerSettingsRef.current, view.renderer, openingActor);
        if (session.closed) return;
        // Glide page turns / arrow-key scrolls instead of snapping (unless motion
        // is reduced). The runtime watcher effect keeps this in sync afterwards.
        syncRendererAnimated(view.renderer);

        let entries = flattenToc(book?.toc ?? []);
        if (!session.closed) setTocEntries(entries);
        void attachTocFractions(view, entries)
          .then((resolved) => {
            if (session.closed) return;
            entries = resolved;
            setTocEntries(resolved);
          })
          .catch((error) => log.warn("Could not prepare chapter marks", error));

        const onRelocate = (event: Event) => {
          if (!view || session.closed || (sessionId && readingRuntime.snapshot().sessionId !== sessionId)) return;
          // Tell background pipelines (text extraction) the reader is busy —
          // the page being read must win the PDF worker and the blob channel.
          const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
          const origin = readingRenderActor(detail);
          if (sessionId) emitAppEvent("reader-demand-activity", { sessionId, reason: "relocate" }, origin);
          clearSelection(origin);
          setActiveAnnotation(null);
          const fraction = Math.max(0, Math.min(1, detail.fraction ?? 0));
          const { current, total } = readingPagePosition(view.isFixedLayout, detail);
          const cfi = detail.cfi ?? null;
          const href = detail.tocItem?.href ?? null;
          const activeTocIndex = findTocIndexForHref(entries, href);
          const chapterTitle = detail.tocItem?.label?.trim() || entries[activeTocIndex]?.label?.trim() || undefined;
          const chapterProgress = chapterProgressAt(entries, href, fraction);
          const visibleText = normalizeReadingCursorText(readingVisibleText(view).text);
          lastLocationTargetRef.current = cfi ?? href;
          const progressPercent = Math.round(fraction * 100);
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
          emitLocation({
            current,
            total,
            fraction,
            progress: {
              currentLocation: current,
              totalLocations: total,
              progressPercent,
              cfi,
              href,
              // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
              readingMode: currentTextUnitNavigator().resume(),
            },
            cursor: {
              ...(cfi ? { anchor: cfi } : {}),
              ...(href ? { chapter: href } : {}),
              ...(chapterTitle ? { chapterTitle } : {}),
              bookProgress: fraction,
              ...(chapterProgress !== undefined ? { chapterProgress } : {}),
              ...(total > 0 ? { location: { current, total } } : {}),
              ...(visibleText ? { visibleText } : {}),
            },
          });
          setCurrentChapterHref(href);

          // Paginated dismissal (see relocateDismissesShell for what counts as a
          // turn). Scroll mode is left to the wheel-distance accumulator so a
          // small scroll keeps the shell until it's gone far enough — matching
          // the "after a distance, not on the first tick" rule. A jump the
          // header itself issued is exempt: scrubbing the progress bar would
          // otherwise pull the bar out from under the pointer.
          if (
            !suppressShellDismissRef.current &&
            shellVisibleRef.current &&
            readingModeRef.current !== "scroll" &&
            relocateDismissesShell({
              reason: detail.reason ?? undefined,
              previous: prevReadingLocationRef.current,
              next: { current, cfi },
            })
          ) {
            onContentScrollRef.current?.(origin);
          }
          // 句级菜单只在页码真的变了时随位置收掉。Android 上点击后常跟着一次
          // 并非翻页的 relocate（视口/布局微调），无条件关会让菜单开了即灭。
          const previousLocation = prevReadingLocationRef.current;
          if (previousLocation && previousLocation.current !== current) {
            setUnitMenuAnchor(null);
          }
          prevReadingLocationRef.current = { current, cfi };
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
          currentTextUnitNavigator().handleRelocate(detail);
        };

        const onLoad = (event: Event) => {
          if (session.closed) return;
          const { doc, index } = (event as CustomEvent<FoliateLoadDetail>).detail;
          if (!fixedLayout) {
            markReaderChapterStarts(doc, index, chapterStarts);
            markReaderInlineMedia(doc);
            normalizeReaderTextSizes(doc);
          }
          // The fixed-layout renderer keeps section documents alive in its
          // spread cache and re-announces 'load' whenever one becomes current
          // again — listeners attach once per document (a duplicate keydown
          // listener would turn one keypress into two page turns). Navigator
          // ownership follows relocate: load also announces offscreen source
          // continuations and cached pages that aren't the reading position.
          if (!docsWithListenersRef.current.has(doc)) {
            docsWithListenersRef.current.add(doc);
            // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
            attachDocListeners(doc, index);
          }
        };

        const onCreateOverlay = () => {
          if (!view || session.closed) return;
          applyHighlights(view, highlightsRef.current);
          applyNotes(view, notesRef.current, highlightsRef.current);
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
          currentTextUnitNavigator().handleOverlayReady();
        };

        // Tapping a mark anchors the recolor/remove menu over it; tapping a note
        // marker opens that note for reading/editing.
        const onShowAnnotation = (event: Event) => {
          if (session.closed) return;
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
          showAnnotation((event as CustomEvent<FoliateShowAnnotationDetail>).detail);
        };

        // Footnote/endnote references open the popover; other links navigate.
        const nativeLinks =
          sessionId && selectedBook
            ? createNativeLinkNavigator(
                readingRuntime,
                { sessionId, bookId: selectedBook.id, contentVersion },
                (error) => setError(describeReaderFailure(error)),
                () => {
                  setError(null);
                  clearSelection();
                },
              )
            : null;
        if (nativeLinks) defer(nativeLinks.dispose);
        const onLink = (event: Event) => {
          const detail = (event as CustomEvent<FoliateLinkDetail>).detail;
          if (detail?.a) footnoteAnchorRectRef.current = anchorRectForElement(detail.a);
          const handler = footnoteHandlerRef.current;
          if (handler && book)
            void handler
              .handle(book, event as CustomEvent<FoliateLinkDetail>, beginNativeFootnote())
              ?.catch((error) => log.warn("Could not render footnote", error));
          void nativeLinks?.handle(event as CustomEvent<FoliateLinkDetail>);
        };

        // Pushing past the last page — a touch swipe's snap turns pages inside
        // the engine, so this is the only place that gesture can finish the
        // book; keyboard, wheel and tap turns already ask isAtEndOfBook first.
        const onEdge = (event: Event) => {
          if (session.closed) return;
          const detail = (event as CustomEvent<FoliateEdgeDetail>).detail;
          if (detail?.dir === 1 && isAtEndOfBook(view)) openCompletion();
        };
        const renderer = view.renderer;
        renderer?.addEventListener("edge", onEdge);
        defer(() => renderer?.removeEventListener("edge", onEdge));

        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoad);
        view.addEventListener("create-overlay", onCreateOverlay);
        view.addEventListener("show-annotation", onShowAnnotation);
        view.addEventListener("link", onLink);
        defer(() => view?.removeEventListener("relocate", onRelocate));
        defer(() => view?.removeEventListener("load", onLoad));
        defer(() => view?.removeEventListener("create-overlay", onCreateOverlay));
        defer(() => view?.removeEventListener("show-annotation", onShowAnnotation));
        defer(() => view?.removeEventListener("link", onLink));

        if (session.closed) return;
        if (selectedBook) {
          try {
            defer(
              observeReaderAnnotations(selectedBook.id, view, highlightsRef, notesRef, (items) => {
                setActiveAnnotation((current) => {
                  if (!current) return null;
                  const next = items.find((item) => item.id === current.highlight.id);
                  return next && JSON.stringify(next) === JSON.stringify(current.highlight) ? current : null;
                });
              }),
            );
          } catch (error) {
            // Reading remains usable; the annotations panel has its own retry/error surface.
            log.warn("Could not observe reader annotations", error);
          }
        }

        await restoreReadingPosition(view, {
          virtual: !!initialBook.virtual,
          reset: !!resetPosition,
          target: lastLocationTargetRef.current,
          fraction: initialFractionRef.current,
          context: openingContext,
        });
        if (view) {
          applyHighlights(view, highlightsRef.current);
          applyNotes(view, notesRef.current, highlightsRef.current);
        }
        // A zoomed fixed-layout page reopens on the passage it was read at,
        // not at its corner; the place is followed from here on.
        if (fixedLayout) defer(fixedLayoutZoom.restoreFocus(view.renderer));
        // A PDF iframe can load before its raster. Public readiness and metadata
        // enrichment must wait for the displayed page, not a background render.
        await waitForReadingPaint(view);
        if (session.closed) return;
        if (selectedBook) assertContentNotInvalidated(selectedBook.id, invalidation);
        if (resetPosition) resetPositionSourceRef.current = initialBook;
        if (sessionId && selectedBook) {
          const emphasis = await createReadingEmphasisAdapter(view);
          if (session.closed) {
            emphasis.retire();
            return;
          }
          defer(() => emphasis.retire());
          assertContentNotInvalidated(selectedBook.id, invalidation);
          const sourceRevision = contentProvider
            ? virtualSourceRevision(selectedBook.id, contentProvider, initialBook.virtual!.key)
            : contentVersion;
          if (!session.closed)
            defer(attachReadingEngine(view, sessionId, selectedBook.id, contentVersion, sourceRevision, openingActor));
          const identity = { view, sessionId, bookId: selectedBook.id, contentVersion };
          selectionContentRef.current = identity;
          defer(
            readingRuntime.bindSelection(
              sessionId,
              createReadingSelectionAdapter(
                view,
                () => selectionRef.current,
                (doc, index, origin) => captureSelectionFromDoc(doc, index, { origin }),
                clearSelection,
                selectionRender,
              ),
              openingActor,
            ),
          );
          defer(readingEmphasis.bind(sessionId, selectedBook.id, contentVersion, emphasis));
          defer((origin) => {
            if (selectionContentRef.current !== identity) return;
            selectionContentRef.current = null;
            readingRuntime.selectionChanged(sessionId, null, origin);
          });
        }
        // oxlint-disable-next-line react-hooks/rules-of-hooks -- openEngine runs inside useReaderEngineSession's effect event
        if (book && !session.closed) emitBookReady(book);
      } catch (nextError) {
        if (sessionId && !session.closed) readingRuntime.fail(sessionId, nextError, openingActor);
        if (!session.closed) setError(describeReaderFailure(nextError, "load"));
        await view?.close().catch((error) => log.warn("Could not close failed reader", error));
        await releaseBook?.().catch((error) => log.warn("Could not close failed book", error));
      } finally {
        if (!session.closed) setIsLoading(false);
      }
    })();
  };

  // Keyed on selectedBook?.id (not the object): progress saves replace the
  // selectedBook object each tick. `readingMode` re-opens so switching layout
  // re-initializes the engine, restoring position from the live CFI. No
  // callback is part of the key: a new identity never re-parses the book.
  useReaderEngineSession<LoadedBook, DomainActor>({
    source: initialBook,
    bookId: selectedBook?.id ?? null,
    readingMode,
    open: openEngine,
    retiringOrigin: () => engineLoadSource.current?.origin,
  });

  useEffect(() => {
    if (!chapterNavigationRequest?.href) return;
    void goToChapter(chapterNavigationRequest.href);
  }, [chapterNavigationRequest?.href, chapterNavigationRequest?.requestId, goToChapter]);

  useEffect(() => {
    const cfiRange = annotationNavigationRequest?.cfiRange;
    if (!cfiRange) return;
    void goToChapter(cfiRange);
  }, [annotationNavigationRequest?.cfiRange, annotationNavigationRequest?.requestId, goToChapter]);

  useEffect(() => {
    const fraction = fractionNavigationRequest?.fraction;
    if (fraction == null) return;
    void goToFraction(fraction);
    // requestId, not the fraction alone: scrubbing back to the same spot is
    // still a new jump to make.
  }, [fractionNavigationRequest?.fraction, fractionNavigationRequest?.requestId, goToFraction]);

  // Spreads leave the page edges clear; wheel, swipe and keyboard turn pages.
  // Single-page mode retains its explicit edge controls.
  const showPageTurnControls = readingMode === "paginated-single" && !isLoading && !error;

  // Each strip adds its height to the side it sits on — padding holds the
  // content back while the matching `--foliate-reserved-*` lets the paginator
  // take the space out of the page margin instead of the text column.
  const stripTopInset = stripSpace.top
    ? `calc(var(--ra-safe-top) + ${READER_STRIP_HEIGHT_PX}px)`
    : "var(--ra-safe-top)";
  const stripBottomInset = stripSpace.bottom
    ? `calc(var(--ra-safe-bottom) + ${READER_STRIP_HEIGHT_PX}px)`
    : "var(--ra-safe-bottom)";

  return (
    <section ref={readerRootRef} className="relative h-full w-full overflow-hidden">
      <ReaderBackgroundLayer palette={readerPalette} />
      <div
        ref={viewportRef}
        aria-label={selectedBook?.title ?? initialBook?.fileName ?? t("readerLabel")}
        className={cn(
          // Safe-area padding keeps the book content clear of the display
          // cutout (Dynamic Island / punch-hole) and the home indicator while
          // the reader runs immersive; env() resolves to 0 on desktop. An
          // active header/footer strip adds its height on that side.
          "relative h-full w-full transition-opacity ease-out",
          isCrossing ? "duration-150" : "duration-500",
          (isLoading || !!error || isCrossing) && "opacity-0",
        )}
        style={
          // The paginator counts `--foliate-reserved-*` toward its own
          // top/bottom page margin rather than adding the full margin inside
          // it, which left a phone's paginated pages ~80px of blank below the
          // last line. The strips borrow the same margin seam: reserved space
          // on their side grows by the strip height, so enabling one never
          // reflows text that already fit.
          {
            paddingTop: stripTopInset,
            paddingBottom: stripBottomInset,
            "--foliate-reserved-top": stripTopInset,
            "--foliate-reserved-bottom": stripBottomInset,
          } as CSSProperties
        }
      />
      <ReaderPageTurnControls
        visible={showPageTurnControls}
        onPrev={() => void turnPage(-1)}
        onNext={() => void turnPage(1)}
      />
      {isFixedLayout && (
        <ReaderZoomIndicator
          feedback={fixedLayoutZoom.feedback}
          controlsVisible={shellVisible}
          canLock={readingMode !== "scroll"}
          locked={fixedLayoutZoom.locked}
          onToggleLock={() => fixedLayoutZoom.toggleLock()}
          onReset={() => fixedLayoutZoom.resetZoom()}
        />
      )}
      {isIOS() && <ReaderSelectionHighlight selection={selection} />}
      <ReaderSelectionMenu
        selection={selection}
        onCopy={() => copyTargetText(selectionRef.current?.text ?? "")}
        onHighlight={() => {
          void handleHighlight();
        }}
        onUnderline={handleUnderline}
        onAddNote={handleAddNote}
        onAskAI={handleAskAI}
        pluginInput={pluginInputForSource("selection")}
      />
      {/* 逐句模式的句级菜单：点中当前句的 wash 弹出，动作与选区菜单同一套
          （含用户在设置里的排布），只是目标换成静息句。与选区菜单互斥：
          活动选区在场时句级菜单让位（关闭 effect 之外再加渲染护栏，任何
          时序下两者都不可能同帧出现）。 */}
      {textUnitModeEngineActive && !coarsePointer && !selection && textUnitNavigator.current && (
        <ReaderSelectionMenu
          selection={
            unitMenuAnchor
              ? {
                  anchorRect: unitMenuAnchor,
                  cfiRange: textUnitNavigator.current.cfiRange,
                  text: textUnitNavigator.current.text,
                }
              : null
          }
          onCopy={() => copyTargetText(textUnitNavigator.current?.text ?? "")}
          onHighlight={() => {
            setUnitMenuAnchor(null);
            void handleNavigatorMark("highlight");
          }}
          onUnderline={() => {
            setUnitMenuAnchor(null);
            void handleNavigatorMark("underline");
          }}
          onAddNote={() => {
            setUnitMenuAnchor(null);
            handleNavigatorAddNote();
          }}
          onAskAI={() => {
            setUnitMenuAnchor(null);
            handleNavigatorAskAI();
          }}
          allowAnnotations={textUnitNavigator.current.cfiRange != null}
          pluginInput={pluginInputForSource("navigator")}
        />
      )}
      {textUnitMode && coarsePointer && (
        <ReaderHoldMenu
          state={holdMenu.state}
          title={holdContent.title}
          actions={holdContent.actions}
          moreLabel={holdContent.moreLabel}
          moreItems={holdContent.moreItems}
          menuRef={holdMenuRowRef}
          onMoreOpenChange={holdMenu.setMoreOpen}
          onClose={holdMenu.close}
        />
      )}
      {textUnitMode && !coarsePointer && (
        <TextUnitNavigatorBar
          visible={textUnitModeEngineActive && !isLoading && !error}
          mode={textUnitMode}
          containerRef={readerRootRef}
          canReturn={textUnitNavigator.canReturn}
          returnPending={textUnitNavigator.hasReturnPoint}
          canStep={textUnitNavigator.status === "ready" || textUnitNavigator.status === "empty"}
          tapToAdvance={textUnitModeSettings.tapToAdvance}
          unitId={activeUnitId}
          onUnitChange={(unitId) =>
            onModeUnitChange ? onModeUnitChange(unitId) : patchTextUnitModeSettings({ unitId })
          }
          onOpenPanel={openReaderPanel}
          onPrev={textUnitNavigator.prev}
          onNext={textUnitNavigator.next}
          onReturnToCurrent={textUnitNavigator.returnToCurrent}
          canAnnotate={textUnitNavigator.status === "ready" && textUnitNavigator.current?.cfiRange != null}
          onHighlight={() => {
            setUnitMenuAnchor(null);
            void handleNavigatorMark("highlight");
          }}
          onUnderline={() => {
            setUnitMenuAnchor(null);
            void handleNavigatorMark("underline");
          }}
          onAddNote={() => {
            setUnitMenuAnchor(null);
            handleNavigatorAddNote();
          }}
          onExit={() => onExitTextUnitMode?.()}
          readAloudAvailable={readAloud.available}
          readAloudPlaying={readAloud.playing}
          readAloudCanStart={readAloud.snapshot.unavailableReason === null}
          onToggleReadAloud={readAloud.toggle}
        />
      )}
      {textUnitMode && (
        <TextUnitReadoutChip
          key={selectedBook?.id}
          visible={textUnitModeEngineActive && !isLoading && !error}
          containerRef={readerRootRef}
          progress={textUnitNavigator.progress}
          showProgress={textUnitModeSettings.showProgress}
          sessionTimer={textUnitModeSettings.sessionTimer}
          activityRef={sessionTimerActivityRef}
        />
      )}
      {/* Off-screen stage where the engine loads + extracts a footnote fragment. */}
      <div
        ref={footnoteStageRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-[-9999px] top-0 h-96 w-96 overflow-hidden"
      />
      {footnote && (
        <ReaderFootnotePopover
          key={footnote.previewId ?? "native"}
          foreground={!!footnote.previewId}
          anchorRect={footnote.anchorRect}
          label={footnote.label}
          text={footnote.text}
          onClose={closeFootnote}
        />
      )}
      {lightboxImage && (
        <ReaderImageLightbox
          key={lightboxImage.id}
          viewerId={lightboxImage.id}
          session={lightboxImage.session}
          lifetime={lightboxImage.lifetime}
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={(origin) => closeLightbox(origin, lightboxImage.id)}
        />
      )}
      <ReaderAnnotationMenu
        anchorRect={activeAnnotation?.anchorRect ?? null}
        activeColor={activeAnnotation?.highlight.color ?? "yellow"}
        onRecolor={(color) => {
          void handleRecolorAnnotation(color);
        }}
        onCopy={() => copyTargetText(activeAnnotation?.highlight.text ?? "")}
        onAddNote={handleAddNoteForAnnotation}
        onAskAI={handleAskAIAboutAnnotation}
        onRemove={() => {
          void handleRemoveAnnotation();
        }}
        pluginInput={pluginInputForSource("annotation")}
      />

      {showLoader && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper">
          <Spinner size="md" label={t("opening", { name: initialBook?.fileName ?? t("book") })} />
        </div>
      )}

      {error && (
        <ReaderFailureView
          title={t(error.kind === "load" ? "openErrorTitle" : "navigationErrorTitle")}
          bookTitle={selectedBook?.title ?? initialBook?.fileName}
          message={error.message}
          action={
            error.kind === "navigation"
              ? { label: t("continueReading"), onClick: () => setError(null) }
              : error.retryable && onRetryOpen
                ? { label: t("tryAgain"), onClick: onRetryOpen }
                : undefined
          }
          onBack={onCloseReader}
        />
      )}

      <NoteEditor
        key={noteEditor.draftKey}
        isOpen={noteEditor.isOpen}
        isSaving={noteEditor.isSaving}
        selectedText={noteEditor.target?.text || ""}
        initialContent={noteEditor.current?.content || ""}
        onSave={(content) => void noteEditor.save(content)}
        onCancel={noteEditor.close}
        isEditing={!!noteEditor.current}
      />

      {completionMounted && selectedBook ? (
        <ReaderCompletionScreen
          book={selectedBook}
          theme={readerSettings.theme}
          visible={completionVisible}
          shellVisible={shellVisible}
          finished={declaredFinished}
          onFinishedChange={setDeclaredFinished}
          onRevisit={revisitFromCompletion}
          onCloseReader={onCloseReader}
          onTapPage={() => onContentClick?.()}
          lookBackAsked={lookBackAsked}
          onLookBackAsked={() => setLookBackAsked(true)}
          onDismiss={dismissCompletion}
        />
      ) : null}
    </section>
  );
}
