import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useAtom, useAtomValue } from "jotai";
import { Body, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { textUnitModePrefsAtom, shortcutBindingsAtom } from "../../../state/ui";
import { chordMatchesEvent, resolveBinding } from "../../settings/lib/shortcuts";
import type { LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { formatReaderError } from "../lib/format-reader-error";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import {
  getNormalizedSelectionText,
  getSelectionContext,
  getSelectionOverlayRects,
  type ReaderSelectionState,
  type SelectionOverlayRect,
} from "../lib/selection-overlay";
import { flattenToc, findTocIndexForHref } from "../lib/epub-utils";
import { attachTocFractions } from "../lib/toc-fractions";
import { chapterProgressAt, normalizeReadingCursorText } from "../lib/reading-cursor";
import { relocateDismissesShell } from "../lib/shell-dismissal";
import type { LoadedBook, ReadingCursor, TocEntry, TocNavItem } from "../lib/reader-types";
import {
  createFoliateView,
  createFootnoteHandler,
  isFixedLayout as isFixedLayoutBook,
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
import {
  applyHighlights,
  applyNotes,
  registerHighlightDrawing,
} from "../lib/highlight-renderer";
import { parseBookFile } from "../lib/parse-book";
import { ensureUsableToc } from "../lib/toc-synthesis";
import { useReadAloud } from "../hooks/useReadAloud";
import { useTextUnitNavigator } from "../hooks/useTextUnitNavigator";
import {
  preferredTextUnitModeUnitId,
  readTextUnitModeState,
} from "../lib/text-unit-mode-state";
import { createWheelGesture, type WheelGesture } from "../lib/wheel-gesture";
import { ReaderAnnotationMenu } from "./ReaderAnnotationMenu";
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";
import { TextUnitNavigatorBar } from "./TextUnitNavigatorBar";
import { ReaderPageTurnControls } from "./ReaderPageTurnControls";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { ReaderCompletionScreen } from "./ReaderCompletionScreen";
import { NoteEditor } from "../../annotations/components/NoteEditor";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import type { Note, Highlight } from "../../annotations/lib/annotation-types";
import {
  listHighlights,
  listNotes,
} from "../../annotations/lib/annotation-db";
import { hasCoarsePointer, suppressNativeContextMenu } from "../../../platform/environment";
import {
  forwardKeyDownToApp,
  isEditableKeyTarget,
} from "../../../platform/app-keydown";
import { subscribeWheelPhaseEdges } from "../../../platform/wheel-phase";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useReaderTypography } from "../hooks/useReaderTypography";
import { useReaderPagination } from "../hooks/useReaderPagination";
import { useReaderTextActions } from "../hooks/useReaderTextActions";
import {
  computeReaderMaxInlineSize,
  readerGapForMargins,
} from "../../settings/lib/reader-css";
import { useReaderPalette } from "../../settings/hooks/useReaderPalette";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";
import { buildVirtualFoliateBook } from "../lib/virtual-book";
import { resolveContentProvider } from "../../plugins/lib/virtual-books";
import type {
  RegisteredReaderMode,
} from "../../plugins/lib/plugin-types";

type FoliateReaderViewProps = {
  selectedBook?: LibraryBook | null;
  initialBook?: LoadedBook | null;
  readerSettings?: ReaderSettings;
  /** Whether the reader shell (header overlay) is currently open. Lets the view
   *  reset its scroll-dismissal distance each time the shell appears. */
  shellVisible?: boolean;
  /** Leave the reader for the shelf — offered on the end-of-book screen. */
  onCloseReader?: () => void;
  onContentClick?: () => void;
  /** Dismiss the reader shell. Fired once a scroll travels far enough (scroll
   *  mode) or as soon as a page turn lands (paginated mode). */
  onContentScroll?: () => void;
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

const SELECTION_CLICK_SUPPRESSION_MS = 180;
const SHELL_TAP_MAX_DURATION_MS = 220;
const SHELL_TAP_MAX_MOVE_PX = 6;
const EMPTY_READER_SEGMENTER: RegisteredReaderMode["segmentText"] = () => [];
// Touch selection settles (handles released, no further changes) for this long
// before the selection menu appears; each drag of a handle defers it again.
const TOUCH_SELECTION_SETTLE_MS = 350;
// A center tap toggles the reader shell, but a double-click (to select a word)
// begins with a single click too. Defer the toggle by this window so the second
// click — or the resulting selection — can cancel it, instead of the shell
// flashing up mid-selection. A genuine single tap just toggles after the wait.
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
// a page on a horizontal trackpad swipe in paginated layouts.
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

/**
 * A section iframe may be displayed scaled — the fixed-layout renderer fits a
 * page to the window with a CSS transform. Rects measured inside the iframe are
 * in its own unscaled coordinate space, so they need that factor applied before
 * they mean anything in the host. Reflowable sections render 1:1 and get 1.
 */
function frameScaleOf(frameElement: Element, frameRect: DOMRect): number {
  const layoutWidth = frameElement.clientWidth;
  if (!layoutWidth || !frameRect.width) return 1;
  return frameRect.width / layoutWidth;
}

/** The text the selection / annotation menus act on (copy, note, look up, AI). */
function clampRectToViewport(
  rect: SelectionOverlayRect,
  frameRect: DOMRect,
  viewportRect: DOMRect,
  scale = 1,
): SelectionOverlayRect | null {
  const left = frameRect.left + rect.left * scale - viewportRect.left;
  const top = frameRect.top + rect.top * scale - viewportRect.top;
  const right = frameRect.left + (rect.left + rect.width) * scale - viewportRect.left;
  const bottom = frameRect.top + (rect.top + rect.height) * scale - viewportRect.top;

  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clippedRight = Math.min(viewportRect.width, right);
  const clippedBottom = Math.min(viewportRect.height, bottom);
  const width = clippedRight - clippedLeft;
  const height = clippedBottom - clippedTop;

  if (width <= 0 || height <= 0) return null;

  return { left: clippedLeft, top: clippedTop, width, height };
}

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
]);

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
  onCloseReader,
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
  onExitTextUnitMode,
  onTextUnitModeStep,
  initialProgress = null,
  chapterNavigationRequest = null,
  annotationNavigationRequest = null,
  fractionNavigationRequest = null,
}: FoliateReaderViewProps) {
  const { t } = useTranslation("reader");
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
  const lastLocationTargetRef = useRef<string | null>(null);
  const initialFractionRef = useRef(0);
  const loadedBookRef = useRef<LoadedBook | null>(null);
  const tocEntriesRef = useRef<TocEntry[]>([]);
  const currentChapterHrefRef = useRef<string | null>(null);
  const selectionRef = useRef<ReaderSelectionState | null>(null);
  // Latest selection-menu actions, kept in a ref so the stable key handler can
  // invoke them without depending on these per-render closures (which would
  // re-subscribe the keydown listeners and tear down the engine).
  const selectionActionsRef = useRef<{
    copy: () => void;
    highlight: () => void;
    underline: () => void;
    addNote: () => void;
    lookUp: () => void;
    askAI: () => void;
  } | null>(null);
  const clearNativeSelectionRef = useRef<(() => void) | null>(null);
  const suppressContentClickRef = useRef(false);
  const suppressContentClickTimeoutRef = useRef<number | null>(null);
  const shellTapIntentRef = useRef<ShellTapIntent | null>(null);
  const shouldOpenShellOnClickRef = useRef(false);
  const pendingShellToggleTimerRef = useRef<number | null>(null);
  const highlightsRef = useRef<Highlight[]>([]);
  const notesRef = useRef<Note[]>([]);
  // New one-click marks use this colour; recoloring a mark updates it (persisted).
  const isFixedLayoutRef = useRef(false);

  const readingMode = readerSettings.readingMode;
  const readingModeRef = useRef(readingMode);
  useEffect(() => { readingModeRef.current = readingMode; }, [readingMode]);

  // Reader-shell auto-dismissal state. `shellScrollAccumRef` is the signed
  // scroll distance since the shell opened (scroll mode); `prevReadingLocationRef`
  // is the last reported page so a paginated turn can be detected on `relocate`.
  const shellVisibleRef = useRef(shellVisible);
  const prevReadingLocationRef = useRef<{ current: number; cfi: string | null } | null>(null);
  // Set while a jump issued FROM the header chrome is in flight (a progress-bar
  // scrub). Its relocate must not read as "the reader turned a page and wants
  // the chrome out of the way" — the reader is holding that chrome.
  const suppressShellDismissRef = useRef(false);
  useEffect(() => {
    shellVisibleRef.current = shellVisible;
    // Every fresh open starts the dismissal distance from zero, so scroll that
    // happened before the shell appeared can't dismiss it on the next tick.
    if (shellVisible) resetShellScrollTravel();
  }, [shellVisible]);

  const onContentClickRef = useRef(onContentClick);
  const onContentScrollRef = useRef(onContentScroll);
  const onReadingActivityRef = useRef(onReadingActivity);
  const onPageChangeRef = useRef(onPageChange);
  const onProgressChangeRef = useRef(onProgressChange);
  const onFractionChangeRef = useRef(onFractionChange);
  const onTocChangeRef = useRef(onTocChange);
  const onCurrentChapterChangeRef = useRef(onCurrentChapterChange);
  const onReadingCursorChangeRef = useRef(onReadingCursorChange);
  const onBookReadyRef = useRef(onBookReady);

  useEffect(() => { onContentClickRef.current = onContentClick; }, [onContentClick]);
  useEffect(() => { onContentScrollRef.current = onContentScroll; }, [onContentScroll]);
  useEffect(() => { onReadingActivityRef.current = onReadingActivity; }, [onReadingActivity]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { onProgressChangeRef.current = onProgressChange; }, [onProgressChange]);
  useEffect(() => { onFractionChangeRef.current = onFractionChange; }, [onFractionChange]);
  useEffect(() => { onTocChangeRef.current = onTocChange; }, [onTocChange]);
  useEffect(() => { onCurrentChapterChangeRef.current = onCurrentChapterChange; }, [onCurrentChapterChange]);
  useEffect(() => { onReadingCursorChangeRef.current = onReadingCursorChange; }, [onReadingCursorChange]);
  useEffect(() => { onBookReadyRef.current = onBookReady; }, [onBookReady]);

  /**
   * The completion screen crosses in and out rather than snapping. `mounted`
   * keeps it in the tree long enough for the exit animation to play; `visible`
   * picks which animation runs. Both can be set in the same frame — the screen
   * animates with keyframes, so nothing has to observe an initial paint.
   */
  const [completionMounted, setCompletionMounted] = useState(false);
  const [completionVisible, setCompletionVisible] = useState(false);
  const completionExitTimerRef = useRef<number | null>(null);

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
  const revisitFromCompletion = useCallback(
    (cfiRange: string) => {
      // Fade out first, then land on the passage — arriving mid-fade would show
      // the jump happening behind the screen.
      dismissCompletion();
      window.setTimeout(() => void viewRef.current?.goTo(cfiRange), COMPLETION_FADE_MS);
    },
    [dismissCompletion],
  );
  const [declaredFinished, setDeclaredFinished] = useState(
    selectedBook?.readingStatus === "finished",
  );
  /**
   * Whether this reading session already asked the agent to look back. Kept
   * here rather than on the completion screen because that screen unmounts when
   * dismissed — the reader who reopens it should not be made to re-ask. This
   * component remounts per book, so the flag resets with the session.
   */
  const [lookBackAsked, setLookBackAsked] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only surface the loader once a load is genuinely slow, so fast opens (the
  // common case) fade straight in without a flashed indicator.
  const showLoader = useDelayedFlag(isLoading, 250);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null);
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const [selection, setSelection] = useState<ReaderSelectionState | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<{
    highlight: Highlight;
    anchorRect: SelectionOverlayRect;
  } | null>(null);


  // "Ask AI about this" hands a passage to the note panel's chat (a sibling
  // component) via this atom; the shell reveals the Chat tab and the chat panel
  // adopts the passage. Whether the action is offered follows the user's
  // conversational-Q&A preference, mirrored to a ref for the stable key handler.
  // Notify annotation lists (TOC indicators, chapter flyout) to re-read when a
  // mark is created/removed/recolored here, so they update live.
  const askAiEnabled = useAskAiEnabled();
  const askAiEnabledRef = useRef(askAiEnabled);
  useEffect(() => {
    askAiEnabledRef.current = askAiEnabled;
  }, [askAiEnabled]);

  // Live page-turn key bindings, mirrored to a ref so the stable key handler
  // reads the latest without being re-created on every edit.
  const shortcutBindings = useAtomValue(shortcutBindingsAtom);
  const shortcutBindingsRef = useRef(shortcutBindings);
  useEffect(() => {
    shortcutBindingsRef.current = shortcutBindings;
  }, [shortcutBindings]);

  // Footnote popover: the engine loads + extracts the note into an off-screen
  // staging view; we read its text and show it in the popover.
  const [footnote, setFootnote] = useState<{
    anchorRect: SelectionOverlayRect | null;
    label: string;
    text: string;
  } | null>(null);
  const footnoteHandlerRef = useRef<FoliateFootnoteHandler | null>(null);
  const footnoteAnchorRectRef = useRef<SelectionOverlayRect | null>(null);
  const footnoteStageRef = useRef<HTMLDivElement | null>(null);
  const closeFootnote = useCallback(() => setFootnote(null), []);

  // 逐句模式：点中静息句的 wash → 在点击处开合该句的动作菜单（复制/高亮/
  // 下划线/笔记/问 AI + 插件 lookup），代替伸到底部工具栏。移动端"够不着"
  // 的核心修复：动作长在句子上，工具栏只留导航。
  const [unitMenuAnchor, setUnitMenuAnchor] = useState<SelectionOverlayRect | null>(null);
  const unitMenuToggleRef = useRef<(doc: Document, x: number, y: number) => void>(() => {});
  unitMenuToggleRef.current = (doc, clientX, clientY) => {
    const readerRoot = readerRootRef.current;
    const frameElement = doc.defaultView?.frameElement;
    if (!readerRoot || !(frameElement instanceof HTMLElement)) return;
    setUnitMenuAnchor((open) =>
      open
        ? null
        : clampRectToViewport(
            { left: clientX, top: clientY, width: 1, height: 1 },
            frameElement.getBoundingClientRect(),
            readerRoot.getBoundingClientRect(),
          ),
    );
  };

  /** Map an in-book element's rect to reader-viewport coords for anchoring. */
  const anchorRectForElement = useCallback((el: Element): SelectionOverlayRect | null => {
    const readerRoot = readerRootRef.current;
    const frameElement = el.ownerDocument?.defaultView?.frameElement;
    if (!readerRoot || !(frameElement instanceof HTMLElement)) return null;
    const rect = el.getBoundingClientRect();
    return clampRectToViewport(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      frameElement.getBoundingClientRect(),
      readerRoot.getBoundingClientRect(),
    );
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
      detail.view.renderer?.destroy?.();
      if (!text) return;
      setFootnote({
        anchorRect: footnoteAnchorRectRef.current,
        label: footnoteLabel(detail.type, tRef.current),
        text,
      });
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
  }, []);

  const {
    settingsRef: readerSettingsRef,
    applyMaxInlineSize: applyReaderMaxInlineSize,
    injectStyles: injectReaderStyles,
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

  const {
    isCrossing,
    crossTo,
    crossSection,
    handleWheelCrossingRef,
    dismissShellOnScrollDistanceRef,
    enqueuePageTurn,
    advancePage,
    turnPage,
    resetShellScrollTravel,
    resetPageTurnQueue,
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
    const frameScale = frameScaleOf(frameElement, frameRect);
    const rects = getSelectionOverlayRects(range)
      .map((rect) => clampRectToViewport(rect, frameRect, viewportRect, frameScale))
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
      context: getSelectionContext(range, text),
    };

    setActiveAnnotation(null);
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    if (suppressContentClick) armContentClickSuppression();

    return true;
  }, [armContentClickSuppression, clearSelection]);

  // ----- chapter navigation (refs so stable across renders) -----------------

  const goToChapter = useCallback(async (href: string) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      setError(null);
      clearSelection();
      await view.goTo(href);
    } catch (nextError) {
      setError(formatReaderError(nextError, tRef.current));
    }
  }, [clearSelection]);

  /** Jump to a position in the book by fraction — the header progress bar's
   *  scrub target. The engine maps it back through its section sizes, so the
   *  landing spot matches the fraction it reports while reading. Behind the
   *  cross-fade: the scrub lands wherever the reader was not looking, and a
   *  hard swap of the page reads as a glitch. */
  const goToFraction = useCallback(async (fraction: number) => {
    const view = viewRef.current;
    if (!view) return;
    setError(null);
    clearSelection();
    // The relocate this lands is a jump the user asked for from the header, not
    // a page turn away from it — it must not take the chrome down with it.
    suppressShellDismissRef.current = true;
    await crossTo(async () => {
      try {
        await viewRef.current?.goToFraction(Math.min(1, Math.max(0, fraction)));
      } catch (nextError) {
        setError(formatReaderError(nextError, tRef.current));
      }
    });
    suppressShellDismissRef.current = false;
  }, [clearSelection, crossTo]);

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

  // ----- plugin-defined text-unit mode ----------------------------------------

  // Fixed-layout books have no reflowable text to segment; the mode never
  // activates there (the shell hides its toggle via onFixedLayoutChange).
  const textUnitModeEngineActive = textUnitModeActive && textUnitMode !== null && !isFixedLayout;
  const textUnitModeSuspended = textUnitModeActive && textUnitMode === null;

  const onFixedLayoutChangeRef = useRef(onFixedLayoutChange);
  useEffect(() => { onFixedLayoutChangeRef.current = onFixedLayoutChange; }, [onFixedLayoutChange]);
  useEffect(() => { onFixedLayoutChangeRef.current?.(isFixedLayout); }, [isFixedLayout]);

  const onExitTextUnitModeRef = useRef(onExitTextUnitMode);
  useEffect(() => { onExitTextUnitModeRef.current = onExitTextUnitMode; }, [onExitTextUnitMode]);
  const onTextUnitModeStepRef = useRef(onTextUnitModeStep);
  useEffect(() => { onTextUnitModeStepRef.current = onTextUnitModeStep; }, [onTextUnitModeStep]);
  const textUnitModeActiveStateRef = useRef(textUnitModeEngineActive);
  useEffect(() => {
    textUnitModeActiveStateRef.current = textUnitModeEngineActive;
  }, [textUnitModeEngineActive]);

  // Host behavior prefs (step unit, tap-to-advance, scroll-to-step) —
  // app-level, shared with the settings panel. Read through refs by the stable
  // doc listeners.
  const [textUnitModePrefs, setTextUnitModePrefs] = useAtom(textUnitModePrefsAtom);
  const persistedModeState = useMemo(
    () => (selectedBook ? readTextUnitModeState(selectedBook.id) : null),
    [selectedBook?.id],
  );
  const prefsUnitId =
    textUnitMode
      ? preferredTextUnitModeUnitId(textUnitModePrefs, textUnitMode.key)
      : null;
  const persistedUnitId =
    textUnitMode &&
    persistedModeState &&
    (persistedModeState.modeKey === null || persistedModeState.modeKey === textUnitMode.key)
      ? persistedModeState.unitId
      : null;
  const preferredUnitId = prefsUnitId ?? persistedUnitId;
  const resolvedModeUnit = textUnitMode
    ? resolveReaderModeUnit(textUnitMode, preferredUnitId)
    : null;
  const activeUnitId = resolvedModeUnit?.id ?? preferredUnitId ?? "mode-unavailable";
  useEffect(() => {
    if (
      !textUnitMode ||
      !resolvedModeUnit ||
      (textUnitModePrefs.modeKey === textUnitMode.key &&
        textUnitModePrefs.unitId === resolvedModeUnit.id)
    ) {
      return;
    }
    setTextUnitModePrefs({
      ...textUnitModePrefs,
      modeKey: textUnitMode.key,
      unitId: resolvedModeUnit.id,
    });
  }, [resolvedModeUnit, setTextUnitModePrefs, textUnitMode, textUnitModePrefs]);
  const tapToAdvanceRef = useRef(textUnitModePrefs.tapToAdvance);
  const scrollToStepRef = useRef(textUnitModePrefs.scrollToStep);
  useEffect(() => {
    tapToAdvanceRef.current = textUnitModePrefs.tapToAdvance;
    scrollToStepRef.current = textUnitModePrefs.scrollToStep;
  }, [textUnitModePrefs.tapToAdvance, textUnitModePrefs.scrollToStep]);

  // Stepping off either end of a section: scroll mode gets the cross-fade with
  // an explicit spine target (next/prev only cross when pinned at an edge);
  // paginated modes flip like a page turn, crossing at the section's last page.
  const textUnitModeCrossSection = useCallback(
    async (direction: -1 | 1, fromSectionIndex: number | null) => {
      const view = viewRef.current;
      if (!view) return;
      if (readingModeRef.current === "scroll") {
        await crossSection(
          direction,
          fromSectionIndex != null ? fromSectionIndex + direction : undefined,
        );
        return;
      }
      try {
        await (direction === 1 ? view.next() : view.prev());
      } catch {
        // At the first/last section — stay put.
      }
    },
    [crossSection],
  );

  const textUnitNavigator = useTextUnitNavigator({
    active: textUnitModeEngineActive,
    suspended: textUnitModeSuspended,
    bookId: selectedBook?.id ?? null,
    modeKey: textUnitMode?.key ?? null,
    unitId: activeUnitId,
    segmentText: textUnitMode?.segmentText ?? EMPTY_READER_SEGMENTER,
    viewRef,
    readerRootRef,
    crossSection: textUnitModeCrossSection,
    veilColor: readerPalette.bg,
  });
  const readAloud = useReadAloud({
    enabled: textUnitModeEngineActive,
    current: textUnitNavigator.current,
    next: textUnitNavigator.next,
    peekNext: textUnitNavigator.peekNext,
  });
  // The engine's mount-once effect and the stable key handler reach the
  // navigator through this ref (its identity changes every render).
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
    viewRef,
    highlightsRef,
    notesRef,
    currentChapterHrefRef,
  });

  const textUnitNavigatorRef = useRef(textUnitNavigator);
  useEffect(() => { textUnitNavigatorRef.current = textUnitNavigator; });

  // Stepping to another unit is a "resume reading" gesture: it dismisses
  // overlays raised for the one left behind (footnote and annotation menu)
  // because their content is stale the moment the wash moves on, and
  // hands the workspace the cue to drop the shell chrome, taking the TOC/chat
  // panels with it. Keyed on the resting unit so every step entry point
  // (bar, keyboard, volume keys, tap-to-advance, scroll-to-step) is covered. The
  // note editor is deliberately spared: auto-closing it would discard whatever
  // the user has typed.
  const textUnitTargetKey = textUnitNavigator.current
    ? textUnitNavigator.current.cfiRange ?? textUnitNavigator.current.text
    : null;
  const previousTextUnitTargetKeyRef = useRef(textUnitTargetKey);
  useEffect(() => {
    if (previousTextUnitTargetKeyRef.current === textUnitTargetKey) return;
    previousTextUnitTargetKeyRef.current = textUnitTargetKey;
    // Losing the unit (deactivation, section unload) is not a step.
    if (textUnitTargetKey == null) return;
    setFootnote(null);
    setActiveAnnotation(null);
    setUnitMenuAnchor(null);
    onTextUnitModeStepRef.current?.();
  }, [textUnitTargetKey]);

  // 句级菜单的其余关闭时机：拉出选区（选区菜单接管）、模式关闭、页移
  // （锚点随布局失效；步进换句已在上面的 targetKey effect 里关）。
  useEffect(() => {
    if (selection) setUnitMenuAnchor(null);
  }, [selection]);
  useEffect(() => {
    if (!textUnitModeEngineActive) setUnitMenuAnchor(null);
  }, [textUnitModeEngineActive]);

  // Latest navigator actions for the stable key handler (see selectionActionsRef).
  const textUnitModeActionsRef = useRef<{
    hasTarget: boolean;
    next: () => void;
    prev: () => void;
    copy: () => void;
    highlight: () => void;
    underline: () => void;
    addNote: () => void;
    lookUp: () => void;
    askAI: () => void;
  } | null>(null);

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
  // - Otherwise: scroll mode's shell-dismissal and section-crossing
  //   accumulators, as before (both no-op in paginated layouts).
  const handleWheelEvent = useCallback((event: WheelEvent) => {
    const gestures = wheelGesturesRef.current;
    if (!gestures) return;
    if (
      readingModeRef.current !== "scroll" &&
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ) {
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
    if (textUnitModeActiveStateRef.current && scrollToStepRef.current) {
      if (event.cancelable) event.preventDefault();
      const stepped = gestures.step.feed(event.deltaY, wheelEventTime(event));
      if (stepped !== 0) textUnitModeActionsRef.current?.[stepped > 0 ? "next" : "prev"]();
      return;
    }
    dismissShellOnScrollDistanceRef.current(event.deltaY);
    handleWheelCrossingRef.current(event.deltaY);
  }, [clearSelection, enqueuePageTurn, wheelEventTime]);
  const handleWheelEventRef = useRef(handleWheelEvent);
  useEffect(() => { handleWheelEventRef.current = handleWheelEvent; }, [handleWheelEvent]);

  // Touch counterpart, one tracker per surface. A finger drag scrolls natively
  // inside a section, but at the top/bottom edge it moves nothing and emits no
  // wheel events — so the drag's travel feeds the same crossing/dismissal
  // accumulators (finger up = content forward = positive wheel delta; screenY
  // so the value is unaffected by any scrolling of the frame itself). While the
  // navigator's scroll-to-step option is on, the swipe is claimed instead: no
  // native scroll, and one step per touch once the drag travels far enough and
  // is clearly vertical — mostly-horizontal drags stay with the paginator's
  // own page-drag handling.
  const createTouchNavHandlers = useCallback(() => {
    let touch: { startX: number; startY: number; lastY: number; stepped: boolean } | null =
      null;
    return {
      onTouchStart: (event: TouchEvent) => {
        const point = event.touches.length === 1 ? event.touches[0] : null;
        touch = point
          ? { startX: point.screenX, startY: point.screenY, lastY: point.screenY, stepped: false }
          : null;
      },
      onTouchMove: (event: TouchEvent) => {
        if (!touch || event.touches.length !== 1) return;
        const point = event.touches[0];
        const deltaY = touch.lastY - point.screenY;
        touch.lastY = point.screenY;
        if (textUnitModeActiveStateRef.current && scrollToStepRef.current) {
          if (event.cancelable) event.preventDefault();
          if (touch.stepped) return;
          const travelY = touch.startY - point.screenY;
          const travelX = touch.startX - point.screenX;
          if (
            Math.abs(travelY) < TOUCH_STEP_THRESHOLD_PX ||
            Math.abs(travelY) <= Math.abs(travelX)
          ) {
            return;
          }
          touch.stepped = true;
          textUnitModeActionsRef.current?.[travelY > 0 ? "next" : "prev"]();
          return;
        }
        dismissShellOnScrollDistanceRef.current(deltaY);
        handleWheelCrossingRef.current(deltaY, TOUCH_SECTION_CROSS_OVERSCROLL_PX);
      },
      onTouchEnd: () => {
        touch = null;
      },
    };
  }, []);

  const handleReaderKeyDown = useCallback((event: KeyboardEvent) => {
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
    const bindings = shortcutBindingsRef.current;
    if (chordMatchesEvent(resolveBinding("next-page", bindings), event)) {
      event.preventDefault();
      advancePage(() => viewRef.current?.goRight?.());
      return;
    }
    if (chordMatchesEvent(resolveBinding("prev-page", bindings), event)) {
      event.preventDefault();
      enqueuePageTurn(() => viewRef.current?.goLeft?.());
      return;
    }
    if (chordMatchesEvent(resolveBinding("next-chapter", bindings), event)) {
      event.preventDefault();
      void goToAdjacentChapter(1);
      return;
    }
    if (chordMatchesEvent(resolveBinding("prev-chapter", bindings), event)) {
      event.preventDefault();
      void goToAdjacentChapter(-1);
      return;
    }
    // Toggles the reader shell (the chrome), not the page — peeking at the
    // controls shouldn't also advance your place.
    if (chordMatchesEvent(resolveBinding("toggle-controls", bindings), event)) {
      event.preventDefault();
      onContentClickRef.current?.();
      return;
    }

    // Text-unit mode only. Its step keys intercept
    // ahead of the hardcoded ArrowUp/Down page scroll below; the selection
    // action keys double as actions on the resting unit while no text is
    // selected (a live selection keeps first claim on them, further down).
    const textUnitModeActions = textUnitModeActionsRef.current;
    if (textUnitModeActiveStateRef.current && textUnitModeActions) {
      if (chordMatchesEvent(resolveBinding("reader-mode-next-unit", bindings), event)) {
        event.preventDefault();
        textUnitModeActions.next();
        return;
      }
      if (chordMatchesEvent(resolveBinding("reader-mode-prev-unit", bindings), event)) {
        event.preventDefault();
        textUnitModeActions.prev();
        return;
      }
      if (!selectionRef.current && textUnitModeActions.hasTarget) {
        if (chordMatchesEvent(resolveBinding("selection-copy", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.copy();
          return;
        }
        if (chordMatchesEvent(resolveBinding("selection-highlight", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.highlight();
          return;
        }
        if (chordMatchesEvent(resolveBinding("selection-underline", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.underline();
          return;
        }
        if (chordMatchesEvent(resolveBinding("selection-add-note", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.addNote();
          return;
        }
        if (chordMatchesEvent(resolveBinding("selection-look-up", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.lookUp();
          return;
        }
        if (askAiEnabledRef.current && chordMatchesEvent(resolveBinding("selection-ask-ai", bindings), event)) {
          event.preventDefault();
          textUnitModeActions.askAI();
          return;
        }
      }
    }

    // Selection actions — only while text is selected (the selection menu is
    // up). Checked before the modifier guard so a rebinding may include
    // modifiers. Fixed-layout books (PDF, comics) annotate too: a selection can
    // only exist where the page has a text layer, and that is exactly where an
    // annotation can be anchored. Ask AI still needs AI configured.
    const selectionActions = selectionActionsRef.current;
    if (selectionRef.current && selectionActions) {
      if (chordMatchesEvent(resolveBinding("selection-copy", bindings), event)) {
        event.preventDefault();
        selectionActions.copy();
        return;
      }
      if (chordMatchesEvent(resolveBinding("selection-highlight", bindings), event)) {
        event.preventDefault();
        selectionActions.highlight();
        return;
      }
      if (chordMatchesEvent(resolveBinding("selection-underline", bindings), event)) {
        event.preventDefault();
        selectionActions.underline();
        return;
      }
      if (chordMatchesEvent(resolveBinding("selection-add-note", bindings), event)) {
        event.preventDefault();
        selectionActions.addNote();
        return;
      }
      if (chordMatchesEvent(resolveBinding("selection-look-up", bindings), event)) {
        event.preventDefault();
        selectionActions.lookUp();
        return;
      }
      if (askAiEnabledRef.current && chordMatchesEvent(resolveBinding("selection-ask-ai", bindings), event)) {
        event.preventDefault();
        selectionActions.askAI();
        return;
      }
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      if (selectionRef.current) clearSelection();
      else if (textUnitModeActiveStateRef.current) onExitTextUnitModeRef.current?.();
    }
    // Vertical keys map to forward/back directly.
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      void turnPage(1);
    }
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      void turnPage(-1);
    }
  }, [clearSelection, enqueuePageTurn, goToAdjacentChapter, turnPage]);

  // Keep the key handler's view of the selection actions current. These handlers
  // are plain per-render closures over the live `selection`; refreshing the ref
  // every render hands the stable key handler the latest ones with no staleness.
  // Copy also clears the selection so a keyboard copy gives the same "done"
  // feedback (menu dismissed) the other actions do; the rest clear themselves.
  useEffect(() => {
    selectionActionsRef.current = {
      copy: () => {
        void copyTargetText(selectionRef.current?.text ?? "");
        clearSelection();
      },
      highlight: () => void handleHighlight(),
      underline: handleUnderline,
      addNote: handleAddNote,
      lookUp: handleLookUp,
      askAI: handleAskAI,
    };
    textUnitModeActionsRef.current = {
      hasTarget: !!textUnitNavigator.current,
      next: textUnitNavigator.next,
      prev: textUnitNavigator.prev,
      copy: () => void copyTargetText(textUnitNavigator.current?.text ?? ""),
      highlight: () => void handleNavigatorMark("highlight"),
      underline: () => void handleNavigatorMark("underline"),
      addNote: handleNavigatorAddNote,
      lookUp: handleNavigatorLookUp,
      askAI: handleNavigatorAskAI,
    };
  });

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

    // Fixed-layout page turns by horizontal swipe. The refs are read at
    // gesture time, not attach time: layout detection can land after the
    // first section loads, and the reading mode may change over the doc's
    // lifetime. Short + decisively horizontal keeps long-press selection
    // and vertical scrolling (scroll mode) untouched.
    {
      let swipeStart: { x: number; y: number; at: number } | null = null;
      doc.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.touches[0];
          swipeStart =
            event.touches.length === 1 && touch
              ? { x: touch.screenX, y: touch.screenY, at: Date.now() }
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
          // Visual direction: swiping the content leftwards reveals the page
          // on the right, and vice versa — correct under RTL too.
          const view = viewRef.current;
          if (dx < 0) void view?.goRight();
          else void view?.goLeft();
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
      doc.addEventListener("selectionchange", () => {
        if (settleTimer != null) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          settleTimer = null;
          const sel = doc.getSelection?.();
          const hasSelection =
            !!sel &&
            sel.rangeCount > 0 &&
            !sel.getRangeAt(0).collapsed &&
            getNormalizedSelectionText(sel).length > 0;
          if (hasSelection) {
            captureSelectionFromDoc(doc, index, { suppressContentClick: true });
          } else if (selectionRef.current) {
            // The system selection was dismissed (tap elsewhere, Cut/Copy…);
            // don't leave our menu floating over nothing.
            clearSelection();
          }
        }, TOUCH_SELECTION_SETTLE_MS);
      });
    }

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

    // While tap-to-advance is on, rapid stepping clicks must not turn into a
    // word-selecting double-click (selection is mousedown's default action at
    // detail > 1) — except over a drawn range (the navigator's resting wash or
    // a user mark), where single clicks don't step anyway (the click handler's
    // hit test swallows them), so double-click keeps selecting words there.
    // Drag and long-press selection still work everywhere.
    doc.addEventListener("mousedown", (event) => {
      if (!textUnitModeActiveStateRef.current || !tapToAdvanceRef.current) return;
      if (event.detail <= 1) return;
      const hit = viewRef.current?.renderer
        ?.getContents?.()
        .find((content) => content.index === index)
        ?.overlayer?.hitTest({ x: event.clientX, y: event.clientY });
      if (hit && hit[0]) return;
      event.preventDefault();
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

    // 掌阅式内联脚注（<img zy-footnote="注文" class="epub-footnote">）：注文
    // 就在属性里 —— 点击直接进现有的脚注弹层。链接式 noteref 走 foliate 的
    // link 事件路径,互不相扰。先于下面的 shell-toggle click 注册,拦下命中。
    doc.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const marker = target?.closest?.(
          "img[zy-footnote], img.epub-footnote, img.zhangyue-footnote",
        );
        if (!marker) return;
        const text = (
          marker.getAttribute("zy-footnote") ?? marker.getAttribute("alt") ?? ""
        ).trim();
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

    doc.addEventListener("click", (event) => {
      // Tapping an existing mark opens its recolor menu (via `show-annotation`);
      // skip the tap-to-toggle-shell handling so the two don't fight.
      const hit = viewRef.current?.renderer
        ?.getContents?.()
        .find((content) => content.index === index)
        ?.overlayer?.hitTest({ x: event.clientX, y: event.clientY });
      if (hit && hit[0]) {
        cancelPendingShellOpen();
        // hitTest 回的是绘制的 value（CFI），不是 overlayKey —— 与静息句的
        // cfiRange 相等即命中导航 wash：开合句级动作菜单（用户标注的命中
        // 仍走 show-annotation 的重着色菜单，互不相扰）。
        const restingCfi = textUnitNavigatorRef.current.current?.cfiRange;
        if (
          textUnitModeActiveStateRef.current &&
          restingCfi != null &&
          hit[0] === restingCfi
        ) {
          unitMenuToggleRef.current(doc, event.clientX, event.clientY);
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

      // A tap on book content only toggles the reader shell — it never turns
      // the page. Page turns are explicit (the edge buttons or keyboard), so a
      // stray click while reading can't cost you your place.
      cancelPendingShellToggle();

      // Closing needs no double-click guard. The guard exists solely to stop a
      // word-selecting double-click from flashing the shell *open* mid-select;
      // dismissing it has no such hazard — the first click closes it as a smooth
      // slide-out, and if the tap turns out to be a double-click, selecting the
      // word underneath a dismissed shell is fine. Deferring the close would only
      // make a single tap feel laggy, so close immediately.
      if (shellVisibleRef.current) {
        onContentClickRef.current?.();
        return;
      }

      // Navigator tap-to-advance: while the mode is on, a quick tap on the
      // page is the step-forward gesture (immediately — the double-click guard
      // below would make rapid stepping feel laggy; word selection by double
      // click is disarmed for the mode's duration in the mousedown listener).
      // The dismissed-shell branch above still wins, so a tap with the chrome
      // open closes it first and the next tap steps.
      if (textUnitModeActiveStateRef.current && tapToAdvanceRef.current) {
        textUnitModeActionsRef.current?.next();
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
        if (
          liveSelection &&
          liveSelection.rangeCount > 0 &&
          !liveSelection.getRangeAt(0).collapsed
        ) {
          return;
        }
        onContentClickRef.current?.();
      }, SHELL_TOGGLE_DBLCLICK_GUARD_MS);
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

    // Wheel routing (see handleWheelEvent): trackpad page turns in paginated
    // layouts, scroll-to-step while the navigator claims the wheel, and in
    // continuous-scroll mode the section-boundary bridge + the shell's
    // scroll-distance dismissal. Non-passive: the first two must preventDefault.
    doc.addEventListener(
      "wheel",
      (event) => handleWheelEventRef.current(event),
      { passive: false },
    );

    // Touch counterpart (see createTouchNavHandlers): without it, touch could
    // never cross into the adjacent chapter in scroll mode, and swipe-to-step
    // would have no touch gesture. Non-passive for the same reason as wheel.
    const touchNav = createTouchNavHandlers();
    doc.addEventListener("touchstart", touchNav.onTouchStart, { passive: true });
    doc.addEventListener("touchmove", touchNav.onTouchMove, { passive: false });
    doc.addEventListener("touchend", touchNav.onTouchEnd);
  }, [anchorRectForElement, armContentClickSuppression, captureSelectionFromDoc, cancelPendingShellOpen, cancelPendingShellToggle, clearSelection, createTouchNavHandlers, handleReaderKeyDown]);

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

    const onWheel = (event: WheelEvent) => handleWheelEventRef.current(event);

    // Touch parallel for the same dead zone, with its own per-surface tracker.
    const { onTouchStart, onTouchMove, onTouchEnd } = createTouchNavHandlers();

    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !viewportRef.current?.contains(target)) return;
      if (selectionRef.current) {
        clearSelection();
        return;
      }
      // Same tap-to-advance routing as clicks inside the book content: the
      // empty area below a short section is still "the page" to a reader.
      if (textUnitModeActiveStateRef.current && tapToAdvanceRef.current) {
        if (shellVisibleRef.current) {
          onContentClickRef.current?.();
          return;
        }
        textUnitModeActionsRef.current?.next();
        return;
      }
      onContentClickRef.current?.();
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
  }, [clearSelection, createTouchNavHandlers]);

  useEffect(() => {
    return () => {
      cancelPendingShellOpen();
      cancelPendingShellToggle();
      if (completionExitTimerRef.current != null) {
        window.clearTimeout(completionExitTimerRef.current);
      }
      if (suppressContentClickTimeoutRef.current != null) {
        window.clearTimeout(suppressContentClickTimeoutRef.current);
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
    resetShellScrollTravel();
    resetPageTurnQueue();

    void (async () => {
      try {
        view = await createFoliateView();
        if (cancelled) return;
        viewRef.current = view;
        view.style.display = "block";
        view.style.width = "100%";
        view.style.height = "100%";
        container.append(view);

        await registerHighlightDrawing(view);
        let parsedBook: unknown;
        if (initialBook.virtual) {
          // Plugin-provided book: resolve the content provider and build a
          // foliate-conforming object — no file, no parser.
          const provider = resolveContentProvider(initialBook.virtual);
          if (!provider) {
            throw new Error(
              "The plugin providing this book is disabled or uninstalled.",
            );
          }
          const content = await provider.load(initialBook.virtual.key);
          if (cancelled) return;
          parsedBook = buildVirtualFoliateBook(content);
        } else {
          const source = initialBook.file;
          if (!source) throw new Error("Missing book file.");
          const file = typeof source.name === "string"
            ? source
            : new File([source as Blob], initialBook.fileName, { type: source.type });
          // Parse first, then repair a deficient nav BEFORE the view opens —
          // foliate builds its TOC progress (relocate's tocItem) from book.toc
          // at open time, so the synthesized map has to be in place already.
          parsedBook = await parseBookFile(file);
          if (cancelled) return;
          await ensureUsableToc(parsedBook);
        }
        if (cancelled) return;
        await view.open(parsedBook as FoliateBook);
        if (cancelled) return;

        const book = view.book;
        const fixedLayout = book ? isFixedLayoutBook(book) : false;
        isFixedLayoutRef.current = fixedLayout;
        setIsFixedLayout(fixedLayout);

        // Apply the chosen reading mode. Both the reflowable paginator and the
        // fixed-layout PDF renderer honor these attributes; each keeps only the
        // current section/spread live, so memory stays bounded.
        const { flow, maxColumnCount } = layoutForReadingMode(readingMode);
        // Before the first navigation, so the opening render already draws the
        // page in the reader's palette instead of flashing white and redrawing.
        if (fixedLayout) applyReaderPageColors(readerSettingsRef.current, view.renderer);
        if (fixedLayout && view.renderer?.setLayout) {
          // WebKit may defer custom-element attribute reactions until after the
          // first navigation. Configure fixed layout atomically so that first
          // paint cannot race against the old, paired-spread model.
          view.renderer.setLayout(flow, maxColumnCount);
        } else {
          view.renderer?.setAttribute("flow", flow);
          view.renderer?.setAttribute("max-column-count", String(maxColumnCount));
        }
        const firstFixedLayoutRender = fixedLayout && view.renderer
          ? new Promise<void>((resolve) => {
              (view?.renderer as unknown as EventTarget).addEventListener(
                "rendered",
                () => resolve(),
                { once: true },
              );
            })
          : null;
        {
          // The margin preset drives the text measure and the paginator gap
          // together (see reader-css.ts). Portrait containers render a single
          // column regardless of max-column-count (see applyReaderMaxInlineSize).
          const width = readerRootRef.current?.clientWidth ?? window.innerWidth;
          const height = readerRootRef.current?.clientHeight ?? window.innerHeight;
          const effectiveColumns = width > height ? maxColumnCount : 1;
          const margins = readerSettingsRef.current.pageMargins;
          view.renderer?.setAttribute("gap", readerGapForMargins(margins));
          view.renderer?.setAttribute(
            "max-inline-size",
            `${computeReaderMaxInlineSize(width, margins, effectiveColumns)}px`,
          );
        }
        void injectReaderStyles(readerSettingsRef.current, view.renderer);
        // Glide page turns / arrow-key scrolls instead of snapping (unless motion
        // is reduced). The runtime watcher effect keeps this in sync afterwards.
        syncRendererAnimated(view.renderer);

        const entries = attachTocFractions(
          view,
          flattenToc((book?.toc ?? []) as unknown as TocNavItem[])
            .map((entry, entryIndex) => ({ ...entry, spineIndex: entryIndex })),
        );
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
          const activeTocIndex = findTocIndexForHref(entries, href);
          const chapterTitle =
            detail.tocItem?.label?.trim() || entries[activeTocIndex]?.label?.trim() || undefined;
          const chapterProgress = chapterProgressAt(entries, href, fraction);
          const visibleText = normalizeReadingCursorText(detail.range?.toString() ?? "");
          lastLocationTargetRef.current = cfi ?? href;
          const progressPercent = Math.round(fraction * 100);
          onPageChangeRef.current?.(current, total);
          onFractionChangeRef.current?.(fraction);
          onProgressChangeRef.current?.({
            currentLocation: current,
            totalLocations: total,
            progressPercent,
            cfi,
            href,
          });
          onReadingCursorChangeRef.current?.({
            ...(cfi ? { anchor: cfi } : {}),
            ...(href ? { chapter: href } : {}),
            ...(chapterTitle ? { chapterTitle } : {}),
            bookProgress: fraction,
            ...(chapterProgress !== undefined ? { chapterProgress } : {}),
            ...(total > 0 ? { location: { current, total } } : {}),
            ...(visibleText ? { visibleText } : {}),
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
              reason: detail.reason,
              previous: prevReadingLocationRef.current,
              next: { current, cfi },
            })
          ) {
            onContentScrollRef.current?.();
          }
          prevReadingLocationRef.current = { current, cfi };
          textUnitNavigatorRef.current.handleRelocate(detail);
          // 页移让句级菜单的锚点失效——随位置一起收掉
          setUnitMenuAnchor(null);
        };

        const onLoad = (event: Event) => {
          const { doc, index } = (event as CustomEvent<FoliateLoadDetail>).detail;
          attachDocListeners(doc, index);
          textUnitNavigatorRef.current.handleSectionLoad(doc, index);
        };

        const onCreateOverlay = () => {
          if (!view) return;
          applyHighlights(view, highlightsRef.current);
          applyNotes(view, notesRef.current, highlightsRef.current);
          textUnitNavigatorRef.current.handleOverlayReady();
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
              openExistingNote(note);
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
          const frameScale = frameScaleOf(frameElement, frameRect);
          const rects = getSelectionOverlayRects(range)
            .map((rect) => clampRectToViewport(rect, frameRect, viewportRect, frameScale))
            .filter((rect): rect is SelectionOverlayRect => rect != null);
          if (rects.length === 0) {
            setActiveAnnotation(null);
            return;
          }
          clearSelection();
          setActiveAnnotation({ highlight, anchorRect: rects[rects.length - 1] });
        };

        // Footnote/endnote references open the popover; other links navigate.
        const onLink = (event: Event) => {
          const detail = (event as CustomEvent<FoliateLinkDetail>).detail;
          if (detail?.a) footnoteAnchorRectRef.current = anchorRectForElement(detail.a);
          const handler = footnoteHandlerRef.current;
          if (handler && book) void handler.handle(book, event);
        };

        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoad);
        view.addEventListener("create-overlay", onCreateOverlay);
        view.addEventListener("show-annotation", onShowAnnotation);
        view.addEventListener("link", onLink);
        cleanups.push(() => view?.removeEventListener("relocate", onRelocate));
        cleanups.push(() => view?.removeEventListener("load", onLoad));
        cleanups.push(() => view?.removeEventListener("create-overlay", onCreateOverlay));
        cleanups.push(() => view?.removeEventListener("show-annotation", onShowAnnotation));
        cleanups.push(() => view?.removeEventListener("link", onLink));

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
        // Fixed-layout navigation resolves when its iframe loads, before PDF.js
        // has painted the canvas. Delay non-critical metadata/cover work until
        // that first paint so cover rendering cannot compete with the visible
        // page on PDF.js's worker. Reflowable sections are already painted here.
        if (book && firstFixedLayoutRender) {
          void firstFixedLayoutRender.then(() => {
            if (!cancelled) onBookReadyRef.current?.(book);
          });
        } else if (book) {
          onBookReadyRef.current?.(book);
        }
      } catch (nextError) {
        if (!cancelled) setError(formatReaderError(nextError, tRef.current));
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

  useEffect(() => {
    const fraction = fractionNavigationRequest?.fraction;
    if (fraction == null) return;
    void goToFraction(fraction);
    // requestId, not the fraction alone: scrubbing back to the same spot is
    // still a new jump to make.
  }, [fractionNavigationRequest?.fraction, fractionNavigationRequest?.requestId, goToFraction]);

  // Paginated layouts turn by explicit controls; scroll mode uses the native
  // scroller and crosses pages at its edges.
  const showPageTurnControls =
    readingMode !== "scroll" && !isLoading && !error;

  return (
    <section ref={readerRootRef} className="relative h-full w-full overflow-hidden">
      <div
        ref={viewportRef}
        aria-label={selectedBook?.title ?? initialBook?.fileName ?? t("readerLabel")}
        className={cn(
          // Safe-area padding keeps the book content clear of the display
          // cutout (Dynamic Island / punch-hole) and the home indicator while
          // the reader runs immersive; env() resolves to 0 on desktop.
          "h-full w-full pt-[var(--ra-safe-top)] pb-[var(--ra-safe-bottom)] transition-opacity ease-out",
          isCrossing ? "duration-150" : "duration-500",
          (isLoading || !!error || isCrossing) && "opacity-0",
        )}
      />
      <ReaderPageTurnControls
        visible={showPageTurnControls}
        onPrev={() => void turnPage(-1)}
        onNext={() => void turnPage(1)}
      />
      <ReaderSelectionMenu
        selection={selection}
        onCopy={() => copyTargetText(selectionRef.current?.text ?? "")}
        onHighlight={() => { void handleHighlight(); }}
        onUnderline={handleUnderline}
        onAddNote={handleAddNote}
        onAskAI={handleAskAI}
        pluginInput={pluginInputForSource("selection")}
      />
      {/* 逐句模式的句级菜单：点中当前句的 wash 弹出，动作与选区菜单同一套
          （含用户在设置里的排布），只是目标换成静息句。与选区菜单互斥：
          活动选区在场时句级菜单让位（关闭 effect 之外再加渲染护栏，任何
          时序下两者都不可能同帧出现）。 */}
      {textUnitModeEngineActive && !selection && textUnitNavigator.current && (
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
      {textUnitMode && (
        <TextUnitNavigatorBar
          visible={textUnitModeEngineActive && !isLoading && !error}
          mode={textUnitMode}
          containerRef={readerRootRef}
          canReturn={textUnitNavigator.canReturn}
          tapToAdvance={textUnitModePrefs.tapToAdvance}
          unitId={activeUnitId}
          onUnitChange={(unitId) =>
            setTextUnitModePrefs({
              ...textUnitModePrefs,
              modeKey: textUnitMode.key,
              unitId,
            })
          }
          onToggleToolbars={() => onContentClickRef.current?.()}
          onPrev={textUnitNavigator.prev}
          onNext={textUnitNavigator.next}
          onReturnToCurrent={textUnitNavigator.returnToCurrent}
          onExit={() => onExitTextUnitModeRef.current?.()}
          readAloudAvailable={readAloud.available}
          readAloudPlaying={readAloud.playing}
          onToggleReadAloud={readAloud.toggle}
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
          anchorRect={footnote.anchorRect}
          label={footnote.label}
          text={footnote.text}
          onClose={closeFootnote}
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
        <div className="absolute inset-0 flex items-center justify-center bg-inherit">
          <Spinner size="md" label={t("opening", { name: initialBook?.fileName ?? t("book") })} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit px-8 text-center">
          <Body className="max-w-md text-sm text-fg-muted">{error}</Body>
        </div>
      )}

      <NoteEditor
        isOpen={noteEditor.isOpen}
        selectedText={noteEditor.target?.text || ""}
        initialContent={noteEditor.current?.content || ""}
        onSave={noteEditor.save}
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
          onTapPage={() => onContentClickRef.current?.()}
          lookBackAsked={lookBackAsked}
          onLookBackAsked={() => setLookBackAsked(true)}
          onDismiss={dismissCompletion}
        />
      ) : null}

    </section>
  );
}
