import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { Body, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { shortcutBindingsAtom } from "../../../state/ui";
import { chordMatchesEvent, resolveBinding } from "../../settings/lib/shortcuts";
import type { LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { formatReaderError } from "../lib/format-reader-error";
import {
  getNormalizedSelectionText,
  getSelectionOverlayRects,
  type ReaderSelectionState,
  type SelectionOverlayRect,
} from "../lib/selection-overlay";
import { flattenToc, findTocIndexForHref } from "../lib/epub-utils";
import type { LoadedBook, TocEntry, TocNavItem } from "../lib/reader-types";
import {
  createFoliateView,
  createFootnoteHandler,
  getScrollEdges,
  isFixedLayout as isFixedLayoutBook,
  type FoliateFootnoteBeforeRenderDetail,
  type FoliateFootnoteHandler,
  type FoliateFootnoteRenderDetail,
  type FoliateLinkDetail,
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
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";
import { ReaderPageTurnControls } from "./ReaderPageTurnControls";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { NoteEditor } from "../../annotations/components/NoteEditor";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { annotationsRevisionAtom } from "../../annotations/state/annotations-revision";
import type { Note, Highlight } from "../../annotations/lib/annotation-types";
import {
  createHighlight,
  createNote,
  updateNote,
  listHighlights,
  listNotes,
  recolorHighlight,
  deleteAnnotation,
} from "../../annotations/lib/annotation-db";
import {
  getDefaultMarkColor,
  setDefaultMarkColor,
} from "../../annotations/lib/annotation-prefs";
import { hasCoarsePointer, suppressNativeContextMenu } from "../../../platform/environment";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  readerGapForMargins,
} from "../../settings/lib/reader-css";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { curatedFontId, DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";
import { ensureCuratedFontFaceCss } from "../../settings/lib/curated-font-loader";

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
// Touch selection settles (handles released, no further changes) for this long
// before the selection menu appears; each drag of a handle defers it again.
const TOUCH_SELECTION_SETTLE_MS = 350;
const SHELL_TAP_MAX_MOVE_PX = 6;
// A center tap toggles the reader shell, but a double-click (to select a word)
// begins with a single click too. Defer the toggle by this window so the second
// click — or the resulting selection — can cancel it, instead of the shell
// flashing up mid-selection. A genuine single tap just toggles after the wait.
const SHELL_TOGGLE_DBLCLICK_GUARD_MS = 250;
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
// Touch uses a lower threshold: wheel deltas are synthetic momentum units, but
// a finger drag maps 1:1 to CSS pixels, loses the system's touch slop, and a
// device-pixel swipe halves again through the density divisor — 260 CSS px of
// pull is over half a screen. 120px is still a deliberate pull, not a graze.
const TOUCH_SECTION_CROSS_OVERSCROLL_PX = 120;
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
  const { t } = useTranslation("reader");
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

  // "Ask AI about this" hands a passage to the note panel's chat (a sibling
  // component) via this atom; the shell reveals the Chat tab and the chat panel
  // adopts the passage. Whether the action is offered follows the user's
  // conversational-Q&A preference, mirrored to a ref for the stable key handler.
  const dispatchAskAi = useSetAtom(askAiRequestAtom);
  // Notify annotation lists (TOC indicators, chapter flyout) to re-read when a
  // mark is created/removed/recolored here, so they update live.
  const bumpAnnotationsRevision = useSetAtom(annotationsRevisionAtom);
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
    const height =
      readerRootRef.current?.clientHeight ??
      viewportRef.current?.clientHeight ??
      window.innerHeight;
    const { maxColumnCount } = layoutForReadingMode(readingModeRef.current);
    // foliate renders a single column in portrait containers regardless of
    // max-column-count, so size the measure for the columns that will
    // actually show — halving it in portrait would just shrink the one column.
    const effectiveColumns = width > height ? maxColumnCount : 1;
    const margins = readerSettingsRef.current.pageMargins;
    const px = computeReaderMaxInlineSize(width, margins, effectiveColumns);
    renderer.setAttribute("max-inline-size", `${px}px`);
    renderer.setAttribute("gap", readerGapForMargins(margins));
  }, []);

  // Inject the reader stylesheet, first ensuring the active curated webfont is
  // downloaded so its @font-face (with on-demand blob URLs) ships in the same
  // CSS. System/preset fonts need no @font-face, so they apply immediately.
  const injectReaderStyles = useCallback(
    async (
      settings: ReaderSettings,
      renderer = viewRef.current?.renderer,
    ) => {
      const id = curatedFontId(settings.fontFamily);
      const fontFaceCss = id ? await ensureCuratedFontFaceCss(id).catch(() => "") : "";
      renderer?.setStyles?.(buildReaderContentCss(settings, fontFaceCss));
    },
    [],
  );

  // Settings change -> re-inject reader CSS and refresh the text measure.
  useEffect(() => {
    readerSettingsRef.current = readerSettings;
    void injectReaderStyles(readerSettings);
    applyReaderMaxInlineSize();
  }, [readerSettings, applyReaderMaxInlineSize, injectReaderStyles]);

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
  const handleWheelCrossing = useCallback((
    deltaY: number,
    threshold: number = SECTION_CROSS_OVERSCROLL_PX,
  ) => {
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

    if (overscrollRef.current >= threshold) {
      overscrollRef.current = 0;
      void crossSectionRef.current(1);
    } else if (overscrollRef.current <= -threshold) {
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
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))) {
      return;
    }

    // Configurable reader shortcuts, checked before the modifier guard so a
    // rebinding may include modifiers. Left/right page turns are direction-aware
    // (RTL-correct).
    const bindings = shortcutBindingsRef.current;
    if (chordMatchesEvent(resolveBinding("next-page", bindings), event)) {
      event.preventDefault();
      void viewRef.current?.goRight?.();
      return;
    }
    if (chordMatchesEvent(resolveBinding("prev-page", bindings), event)) {
      event.preventDefault();
      void viewRef.current?.goLeft?.();
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

    // Selection actions — only while text is selected (the selection menu is
    // up). Checked before the modifier guard so a rebinding may include
    // modifiers. Mirrors the menu's gating: annotation actions need annotations
    // allowed (not a fixed-layout PDF); Ask AI needs AI configured.
    const selectionActions = selectionActionsRef.current;
    if (selectionRef.current && selectionActions) {
      const annotationsAllowed = !isFixedLayoutRef.current;
      if (chordMatchesEvent(resolveBinding("selection-copy", bindings), event)) {
        event.preventDefault();
        selectionActions.copy();
        return;
      }
      if (annotationsAllowed && chordMatchesEvent(resolveBinding("selection-highlight", bindings), event)) {
        event.preventDefault();
        selectionActions.highlight();
        return;
      }
      if (annotationsAllowed && chordMatchesEvent(resolveBinding("selection-underline", bindings), event)) {
        event.preventDefault();
        selectionActions.underline();
        return;
      }
      if (annotationsAllowed && chordMatchesEvent(resolveBinding("selection-add-note", bindings), event)) {
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
      clearSelection();
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
  }, [clearSelection, goToAdjacentChapter, turnPage]);

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

    // Continuous-scroll mode: bridge section boundaries and feed the shell's
    // scroll-distance dismissal. Native scroll handles movement within a section;
    // when the wheel pushes past the top/bottom edge, lazily load the adjacent
    // section (the engine unloads the one left behind).
    doc.addEventListener("wheel", (event) => {
      dismissShellOnScrollDistanceRef.current(event.deltaY);
      handleWheelCrossingRef.current(event.deltaY);
    }, { passive: true });

    // Touch counterpart of the wheel bridge: a finger drag scrolls natively
    // inside the section, but at the top/bottom edge the drag moves nothing and
    // emits no wheel events — so without this, touch could never cross into the
    // adjacent chapter. Feed the drag's travel into the same overscroll
    // accumulator (finger up = content forward = positive wheel delta). Uses
    // screenY so the value is unaffected by any scrolling of the frame itself.
    let lastTouchY: number | null = null;
    doc.addEventListener("touchstart", (event) => {
      lastTouchY = event.touches.length === 1 ? event.touches[0].screenY : null;
    }, { passive: true });
    doc.addEventListener("touchmove", (event) => {
      if (lastTouchY == null || event.touches.length !== 1) return;
      const y = event.touches[0].screenY;
      const deltaY = lastTouchY - y;
      lastTouchY = y;
      dismissShellOnScrollDistanceRef.current(deltaY);
      handleWheelCrossingRef.current(deltaY, TOUCH_SECTION_CROSS_OVERSCROLL_PX);
    }, { passive: true });
    doc.addEventListener("touchend", () => {
      lastTouchY = null;
    });
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

    // Touch parallel for the same dead zone (see the iframe-document listener
    // for the sign convention).
    let lastTouchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches.length === 1 ? event.touches[0].screenY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (lastTouchY == null || event.touches.length !== 1) return;
      const y = event.touches[0].screenY;
      const deltaY = lastTouchY - y;
      lastTouchY = y;
      dismissShellOnScrollDistanceRef.current(deltaY);
      handleWheelCrossingRef.current(deltaY, TOUCH_SECTION_CROSS_OVERSCROLL_PX);
    };
    const onTouchEnd = () => {
      lastTouchY = null;
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
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
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

  function requestAskAi(target: ActionTarget) {
    if (!selectedBook) return;
    dispatchAskAi({
      id: crypto.randomUUID(),
      bookId: selectedBook.id,
      attachment: {
        kind: "selection",
        text: target.text,
        cfiRange: target.cfiRange,
        chapterHref: target.chapterHref,
      },
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
      bumpAnnotationsRevision((c) => c + 1);
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
    try {
      const updated = await recolorHighlight(activeAnnotation.highlight, color);
      highlightsRef.current = highlightsRef.current.map((highlight) =>
        highlight.id === updated.id ? updated : highlight,
      );
      // Re-adding under the same CFI replaces the drawn mark in the new color.
      if (viewRef.current) applyHighlight(viewRef.current, updated);
      bumpAnnotationsRevision((c) => c + 1);
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
      bumpAnnotationsRevision((c) => c + 1);
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
    requestAskAi(target);
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
      bumpAnnotationsRevision((c) => c + 1);
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
    requestAskAi({
      text: selection.text,
      cfiRange: selection.cfiRange,
      chapterHref: selection.chapterHref,
    });
    clearSelection();
  }

  // Paginated layouts (and fixed-layout PDFs, which always paginate) turn by
  // explicit controls now; scroll mode turns by scrolling. Only surface the
  // edge buttons once the book is actually on screen.
  const showPageTurnControls =
    (readingMode !== "scroll" || isFixedLayout) && !isLoading && !error;

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
        allowAnnotations={!isFixedLayout}
        onCopy={() => copyTargetText(selectionRef.current?.text ?? "")}
        onHighlight={() => { void handleHighlight(); }}
        onUnderline={handleUnderline}
        onAddNote={handleAddNote}
        onLookUp={handleLookUp}
        onAskAI={handleAskAI}
      />
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
        onLookUp={handleLookUpAnnotation}
        onAskAI={handleAskAIAboutAnnotation}
        onRemove={() => {
          void handleRemoveAnnotation();
        }}
      />

      {showLoader && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit">
          <Spinner size="md" label={t("opening", { name: initialBook?.fileName ?? t("book") })} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit px-8 text-center">
          <Body className="max-w-md text-sm text-red-800">{error}</Body>
        </div>
      )}

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

      <ReaderDictionaryModal
        open={dictionaryOpen}
        word={dictionaryWord}
        onClose={() => setDictionaryOpen(false)}
      />
    </section>
  );
}
