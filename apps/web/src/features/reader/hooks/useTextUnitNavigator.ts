import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { AppError, errorCode, type ReadingModePosition } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { TextUnitBuild } from "../lib/text-unit-build";
import { TextUnitPositionWaiter, positionUnavailable } from "../lib/text-unit-position-waiter";
import type { ModeFeedback, ModeStepResult } from "../lib/reading-mode-controller";
import { stepTextUnit, type TextUnitStepIndex } from "../lib/text-unit-stepper";
import { waitForReadingPaint } from "../lib/reading-engine-adapter";
import { resolveTextUnitPosition } from "../lib/text-unit-position";
import { readingRuntime } from "../../../domain/reading-runtime";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import {
  setVolumeKeyCapture,
  VOLUME_STEP_EVENT,
  type VolumeStepDirection,
} from "../../../platform/volume-keys";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import {
  applyNavigatorHighlight,
  removeNavigatorHighlight,
} from "../lib/highlight-renderer";
import {
  isTextUnitModeStateCompatible,
  readTextUnitModeState,
  writeTextUnitModeState,
  type TextUnitResting,
} from "../lib/text-unit-mode-state";
import {
  anchorTextUnitIndex,
  buildTextUnitRanges,
  type TextUnitId,
} from "../lib/text-unit-index";

/** The unit the navigator rests on — the target for the bar's actions. */
export type TextUnitTarget = {
  text: string;
  cfiRange: string | null;
};

/** Resting position within the loaded section's unit list (0-based). */
export type TextUnitProgress = { ordinal: number; total: number };

export type TextUnitNavigator = {
  status: "inactive" | "building" | "ready" | "empty" | "error";
  errorCode?: string;
  configurationRevision: number;
  current: TextUnitTarget | null;
  position: ReadingModePosition | null;
  waitForPosition(position: ReadingModePosition, signal: AbortSignal): Promise<ModeFeedback>;
  stepNative(direction: -1 | 1, signal: AbortSignal): Promise<ModeStepResult>;
  /** Where the wash rests within the loaded section, or null while it rests
   *  elsewhere (another section, mode off, unit-less section). */
  progress: TextUnitProgress | null;
  next: () => void;
  prev: () => void;
  /** Text of the unit after the resting one, within the loaded section. */
  peekNext: () => string | null;
  /** Bring the reader back to the unit the navigator rests on — even when
   *  page turns or chapter jumps have carried the view somewhere else. */
  returnToCurrent: () => void;
  /** Whether the navigator has a resting unit to return to. */
  canReturn: boolean;
  /** Engine bridges — invoke from the reader's `load` / `relocate` handlers. */
  handleSectionLoad: (doc: Document, index: number) => void;
  handleContentVersion: (bookId: string, contentVersion: string) => void;
  handleRelocate: (detail: FoliateRelocateDetail) => void;
  /** Invoke from the reader's `create-overlay` handler: the engine rebuilds a
   *  section's overlayer from scratch on re-layout (style injection, resize,
   *  reopen), and the wash must be re-drawn alongside the user's marks or it
   *  silently vanishes. */
  handleOverlayReady: () => void;
};

type UseTextUnitNavigatorOptions = {
  configurationRevision?: number;
  active: boolean;
  /** Temporarily unavailable because its plugin is disabled. The engine-side
   *  affordances are removed, but the persisted resting place is retained so
   *  re-enabling the plugin resumes exactly where it stopped. */
  suspended?: boolean;
  /** Persistence scope: the resting unit (and the mode itself) is
   *  remembered per book, so closing and reopening the book resumes in place. */
  bookId: string | null;
  /** Registered contribution identity. Null only while the plugin is absent. */
  modeKey: string | null;
  /** Opaque plugin unit id. Switching re-segments the loaded section and
   *  re-anchors the wash at the unit containing its old start. */
  unitId: TextUnitId;
  /** Plugin-owned segmentation policy; the host maps its offsets to Ranges. */
  segmentText: RegisteredReaderMode["segmentText"];
  viewRef: RefObject<FoliateView | null>;
  readerRootRef: RefObject<HTMLElement | null>;
  /** The reader's page color — the fill of the dimming veil drawn around the
   *  resting unit so the rest of the page recedes while navigating. */
  veilColor: string;
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
const log = createLogger("text-unit-navigator");

// Scroll-mode comfort band: how far above the viewport bottom the resting unit
// may sink before a step scrolls. Sized to clear the floating bar / bottom
// toolbar (which overlay the page) with breathing room on any screen height.
const SCROLL_COMFORT_BOTTOM_FRACTION = 0.2;
const SCROLL_COMFORT_BOTTOM_MIN_PX = 72;
const SCROLL_COMFORT_BOTTOM_MAX_PX = 240;

/**
 * Unit-by-unit reading position over the foliate view. Owns the
 * unit index for the loaded section, the current-unit wash (drawn via
 * the engine's overlayer so it survives page turns and re-layout), and
 * stepping — including crossing into adjacent sections at either end.
 *
 * Manual moves (page turns, scrolling, chapter jumps) never displace the
 * navigator: the wash keeps its unit, off-screen if need be, and is
 * restored when its section is flipped back into view. Stepping continues
 * from that resting unit, even when the viewport has moved elsewhere.
 */
export function useTextUnitNavigator({
  configurationRevision = 0,
  active,
  suspended = false,
  bookId,
  modeKey,
  unitId,
  segmentText,
  viewRef,
  readerRootRef,
  veilColor,
}: UseTextUnitNavigatorOptions): TextUnitNavigator {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [status, setStatus] = useState<TextUnitNavigator["status"]>("inactive");
  const [buildErrorCode, setBuildErrorCode] = useState<string>();
  const [preparedRevision, setPreparedRevision] = useState(-1);
  const configurationRef = useRef(configurationRevision);
  configurationRef.current = configurationRevision;
  const [buildSession] = useState(() => new TextUnitBuild());
  const [positionWaiter] = useState(() => new TextUnitPositionWaiter());
  const positionErrorRef = useRef<unknown>(undefined);
  const [current, setCurrent] = useState<TextUnitTarget | null>(null);
  const [progress, setProgress] = useState<TextUnitProgress | null>(null);
  const [canReturn, setCanReturn] = useState(false);

  // Current + progress travel together: both describe where the wash rests
  // in the loaded section, so every "nowhere" transition clears the pair.
  const clearUnit = useCallback(() => {
    setCurrent(null);
    setProgress(null);
    positionErrorRef.current = undefined;
    positionWaiter.notify();
  }, [positionWaiter]);

  const activeRef = useRef(active);
  const persistedActiveRef = useRef(active || suspended);
  const segmentTextRef = useRef(segmentText);
  segmentTextRef.current = segmentText;
  const sectionRef = useRef<{ doc: Document; index: number } | null>(null);
  const unitsRef = useRef<Range[] | null>(null);
  const currentIndexRef = useRef(-1);
  const appliedCfiRef = useRef<string | null>(null);
  const visibleRangeRef = useRef<Range | null>(null);
  const layoutReadyRef = useRef(false);
  // Unit to land on once the relocate that follows a section load fires
  // (layout is settled there; at `load` time the overlayer doesn't exist yet).
  const pendingAnchorRef = useRef<{ index: number; scroll: boolean } | null>(null);
  // Where the navigator rests, by section + ordinal — remembered across
  // section unloads so flipping away and back restores the wash in place.
  // Persisted per book, so it also survives closing and reopening the book.
  const restingRef = useRef<TextUnitResting | null>(null);
  const bookIdRef = useRef(bookId);
  const contentVersionRef = useRef<string | null>(null);
  const modeKeyRef = useRef(modeKey);
  const unitIdRef = useRef(unitId);
  const requestedModeKeyRef = useRef(modeKey);
  requestedModeKeyRef.current = modeKey;
  const requestedUnitIdRef = useRef(unitId);
  requestedUnitIdRef.current = unitId;

  // A theme change swaps the veil color but does NOT rebuild the overlayer —
  // the drawn annotation keeps the options it was added with. Re-apply the
  // wash in place (add on an existing CFI replaces the drawing) so the veil
  // doesn't keep washing the page with the previous theme's paper color.
  const veilColorRef = useRef(veilColor);
  useEffect(() => {
    veilColorRef.current = veilColor;
    if (!activeRef.current) return;
    const view = viewRef.current;
    const cfi = appliedCfiRef.current;
    if (!view || !cfi) return;
    applyNavigatorHighlight(view, cfi, veilColor);
  }, [veilColor, viewRef]);

  const setResting = useCallback((resting: TextUnitResting | null) => {
    restingRef.current = resting;
    setCanReturn(resting != null);
  }, []);

  // Drop outgoing document references before activation. Persisted positions
  // are restored only after the loader supplies the actual content version.
  useEffect(() => {
    buildSession.invalidate();
    bookIdRef.current = bookId;
    contentVersionRef.current = null;
    sectionRef.current = null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    visibleRangeRef.current = null;
    layoutReadyRef.current = false;
    appliedCfiRef.current = null;
    pendingAnchorRef.current = null;
    clearUnit();
    // Do not restore or overwrite a saved position before the loader provides
    // the actual content identity (file hash or virtual-content version).
    setResting(null);
  }, [bookId, buildSession, setResting]);

  useEffect(() => () => {
    buildSession.invalidate();
    positionErrorRef.current = positionUnavailable();
    positionWaiter.notify();
  }, [buildSession, positionWaiter]);

  const persistState = useCallback(() => {
    const id = bookIdRef.current;
    const currentModeKey = modeKeyRef.current;
    // A disabled/unavailable plugin must not overwrite its retained state with
    // an anonymous placeholder before it can register again.
    if (!id || !currentModeKey || !contentVersionRef.current) return;
    writeTextUnitModeState(id, {
      active: persistedActiveRef.current,
      resting: restingRef.current,
      modeKey: currentModeKey,
      unitId: unitIdRef.current,
      contentVersion: contentVersionRef.current,
    });
  }, []);

  const handleContentVersion = useCallback((id: string, version: string) => {
    if (id !== bookIdRef.current || !version) return;
    buildSession.invalidate();
    sectionRef.current = null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    appliedCfiRef.current = null;
    visibleRangeRef.current = null;
    layoutReadyRef.current = false;
    pendingAnchorRef.current = null;
    contentVersionRef.current = version;
    clearUnit();
    setStatus(activeRef.current ? "building" : "inactive");
    const saved = readTextUnitModeState(id);
    const key = modeKeyRef.current;
    setResting(persistedActiveRef.current && key && isTextUnitModeStateCompatible(saved, key, unitIdRef.current, version) ? saved.resting : null);
    // An exit while the file was loading could not yet persist its preference.
    persistState();
  }, [buildSession, clearUnit, setResting, persistState]);

  const waitForPosition = useCallback((position: ReadingModePosition, signal: AbortSignal): Promise<ModeFeedback> =>
    positionWaiter.wait(() => {
      if (positionErrorRef.current) throw positionErrorRef.current;
      if (!activeRef.current || position.modeKey !== modeKeyRef.current || position.unitId !== unitIdRef.current
        || position.location.bookId !== bookIdRef.current) throw positionUnavailable();
      if (position.location.contentVersion !== contentVersionRef.current) throw new AppError("reader/stale-location", "Mode content changed during return");
      const section = sectionRef.current;
      const units = unitsRef.current;
      const view = viewRef.current;
      if (!section || !units || !view || !layoutReadyRef.current) return;
      const index = resolveTextUnitPosition(view, position.location.cfi, section.doc, section.index, units);
      if (index !== currentIndexRef.current || !appliedCfiRef.current) return;
      return { status: "ready", progress: { ordinal: index, total: units.length }, cfiRange: appliedCfiRef.current,
        position: { ...position, location: { ...position.location, cfi: appliedCfiRef.current } } };
    }, signal), [positionWaiter, viewRef]);

  const restoredIndex = useCallback((units: Range[], doc: Document, sectionIndex: number): number => {
    const resting = restingRef.current;
    const view = viewRef.current;
    if (!view || !resting || resting.sectionIndex !== sectionIndex) return -1;
    try { return resolveTextUnitPosition(view, resting.cfiRange, doc, sectionIndex, units); }
    catch (error) {
      log.warn("discarding invalid reading mode position", error);
      setResting(null);
      persistState();
      return anchorTextUnitIndex(units, visibleRangeRef.current);
    }
  }, [viewRef, setResting, persistState]);

  /** Remove only the navigator's independent overlay at the resting CFI. */
  const clearWash = useCallback(() => {
    const cfi = appliedCfiRef.current;
    appliedCfiRef.current = null;
    if (!cfi) return;
    const view = viewRef.current;
    if (!view) return;
    removeNavigatorHighlight(view, cfi);
  }, [viewRef]);

  /** Whether every rect of the range sits inside the comfortable part of the
   *  reader viewport. In scroll mode the bottom is inset by a comfort band
   *  (the shell's bottom toolbar and the floating bar overlay the page there,
   *  and reading pinned to the last line is unpleasant anyway), so stepping
   *  scrolls before the unit actually reaches the edge. Paginated modes keep
   *  the exact bounds: a clipped unit means "on the next page", and anything
   *  short of clipped cannot be scrolled to — only flipped. */
  const rangeComfortablyVisible = useCallback((range: Range): boolean => {
    const root = readerRootRef.current;
    const frame = range.startContainer?.ownerDocument?.defaultView?.frameElement;
    if (!root || !(frame instanceof HTMLElement)) return true;
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1,
    );
    if (!rects.length) return true;
    const rootRect = root.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const comfortBottom = viewRef.current?.renderer?.scrolled
      ? Math.min(
          SCROLL_COMFORT_BOTTOM_MAX_PX,
          Math.max(
            SCROLL_COMFORT_BOTTOM_MIN_PX,
            rootRect.height * SCROLL_COMFORT_BOTTOM_FRACTION,
          ),
        )
      : 0;
    return rects.every(
      (rect) =>
        frameRect.top + rect.top >= rootRect.top - 1 &&
        frameRect.top + rect.bottom <= rootRect.bottom - comfortBottom + 1 &&
        frameRect.left + rect.left >= rootRect.left - 1 &&
        frameRect.left + rect.right <= rootRect.right + 1,
    );
  }, [readerRootRef, viewRef]);

  /** Rest on unit `index`: move the wash and (optionally) bring it into view. */
  const applyIndex = useCallback(
    (index: number, { scroll = true }: { scroll?: boolean } = {}) => {
      const view = viewRef.current;
      const section = sectionRef.current;
      const range = unitsRef.current?.[index];
      if (!view || !section || !range) return;
      clearWash();
      currentIndexRef.current = index;
      let cfi: string | null = null;
      try {
        cfi = view.getCFI(section.index, range);
      } catch {
        cfi = null;
      }
      setResting({ sectionIndex: section.index, ordinal: index, cfiRange: cfi });
      persistState();
      if (cfi) {
        appliedCfiRef.current = cfi;
        applyNavigatorHighlight(view, cfi, veilColorRef.current);
      }
      setCurrent({ text: normalizeText(range.toString()), cfiRange: cfi });
      setProgress({ ordinal: index, total: unitsRef.current?.length ?? 0 });
      positionWaiter.notify();
      if (scroll && !rangeComfortablyVisible(range)) {
        try {
          void view.renderer?.scrollToAnchor?.(range);
        } catch {
          // Geometry races during section teardown — the wash still applied.
        }
      }
    },
    [clearWash, persistState, rangeComfortablyVisible, setResting, viewRef, positionWaiter],
  );

  // The build lease covers both the Worker result and the caller's deferred
  // anchoring, including mode retirement and same-index document replacement.
  const buildUnits = useCallback(async () => {
    const section = sectionRef.current;
    if (!section) return null;
    const segmenter = segmentTextRef.current;
    const unit = unitIdRef.current;
    const revision = configurationRef.current;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    clearWash();
    clearUnit();
    setStatus("building");
    setPreparedRevision(revision);
    setBuildErrorCode(undefined);
    const result = await buildSession.run(signal => buildTextUnitRanges(section.doc, unit, segmenter, signal));
    const isCurrent = () => Boolean(result?.isCurrent() && activeRef.current && sectionRef.current === section
      && unitIdRef.current === unit && segmentTextRef.current === segmenter && configurationRef.current === revision);
    if (!result || !isCurrent()) return null;
    if (result.status === "failed") {
      const code = errorCode(result.error) ?? "reader/segmentation-failed";
      log.warn("reading mode segmentation failed", result.error);
      setStatus("error");
      setBuildErrorCode(code);
      positionErrorRef.current = new AppError(code, "Reading mode segmentation failed", { cause: result.error });
      positionWaiter.notify();
      toastRef.current({ description: describeError({ code }).body, variant: "destructive" });
      return null;
    }
    unitsRef.current = result.value;
    setStatus(result.value.length ? "ready" : "empty");
    positionWaiter.notify();
    return { units: result.value, isCurrent };
  }, [buildSession, clearUnit, clearWash, positionWaiter]);

  const stepNative = useCallback(async (direction: -1 | 1, signal: AbortSignal): Promise<ModeStepResult> => {
    const view = viewRef.current;
    const id = bookIdRef.current;
    const version = contentVersionRef.current;
    const key = modeKeyRef.current;
    const unit = unitIdRef.current;
    const revision = configurationRef.current;
    if (!view || !id || !version || !key) throw positionUnavailable();
    const check = () => {
      if (signal.aborted) throw signal.reason;
      if (!activeRef.current || viewRef.current !== view || bookIdRef.current !== id || modeKeyRef.current !== key
        || unitIdRef.current !== unit || configurationRef.current !== revision) throw positionUnavailable();
      if (contentVersionRef.current !== version) throw new AppError("reader/stale-location", "Mode content changed during stepping");
      if (positionErrorRef.current) throw positionErrorRef.current;
    };
    const position = (cfi: string): ReadingModePosition => ({ location: { bookId: id, contentVersion: version, cfi }, modeKey: key, unitId: unit });
    const index = (signal: AbortSignal): Promise<TextUnitStepIndex> => positionWaiter.wait(() => {
      check();
      const section = sectionRef.current;
      const units = unitsRef.current;
      if (!section || !units || !layoutReadyRef.current) return;
      const resting = restingRef.current;
      return { sectionIndex: section.index, count: units.length,
        currentIndex: resting?.sectionIndex === section.index && resting.cfiRange
          ? resolveTextUnitPosition(view, resting.cfiRange, section.doc, section.index, units) : currentIndexRef.current,
        visibleIndex: anchorTextUnitIndex(units, visibleRangeRef.current),
        position: ordinal => {
          check();
          if (sectionRef.current !== section || unitsRef.current !== units) throw positionUnavailable();
          const range = units[ordinal];
          if (!range) throw new AppError("reader/target-not-found", "Requested unit does not exist");
          return position(view.getCFI(section.index, range));
        } };
    }, signal);
    const outcome = await stepTextUnit({
      resting: () => restingRef.current?.cfiRange ? position(restingRef.current.cfiRange) : null,
      index,
      adjacent: (section, direction) => {
        check();
        const sections = view.book?.sections;
        if (!sections || section < 0 || section >= sections.length) throw positionUnavailable();
        for (let next = section + direction; next >= 0 && next < sections.length; next += direction) {
          if (sections[next]?.linear !== "no") return next;
        }
        return null;
      },
      navigate: async target => {
        check();
        const resolved = await view.goTo(typeof target === "number" ? target : target.location.cfi);
        check();
        if (!resolved) throw new AppError("reader/target-not-found", "Reader could not resolve the unit target");
        await waitForReadingPaint(view);
        check();
      },
      land: async target => {
        await index(signal);
        check();
        const section = sectionRef.current!;
        const ordinal = resolveTextUnitPosition(view, target.location.cfi, section.doc, section.index, unitsRef.current!);
        applyIndex(ordinal, { scroll: false });
        await waitForPosition(target, signal);
      },
    }, direction, signal);
    const settled = await index(signal);
    check();
    return { outcome, feedback: { status: settled.count ? "ready" : "empty", cfiRange: appliedCfiRef.current,
      progress: currentIndexRef.current < 0 ? null : { ordinal: currentIndexRef.current, total: settled.count },
      position: restingRef.current?.cfiRange ? position(restingRef.current.cfiRange) : null } };
  }, [viewRef, positionWaiter, applyIndex, waitForPosition]);

  const unmanagedStepRef = useRef<AbortController | null>(null);
  useEffect(() => () => unmanagedStepRef.current?.abort(positionUnavailable()), []);
  const step = useCallback((direction: -1 | 1) => {
    const session = readingRuntime.snapshot();
    const id = bookIdRef.current;
    let work: Promise<unknown>;
    if (id && session.bookId === id && session.status === "ready") {
      work = readingRuntime.stepMode(direction === 1 ? "next" : "previous", undefined, { bookId: id, sessionId: session.sessionId! });
    } else {
      // Component stories have no application session, but retain the same native traversal.
      unmanagedStepRef.current?.abort(positionUnavailable());
      const abort = new AbortController(); unmanagedStepRef.current = abort;
      const timer = setTimeout(() => abort.abort(new AppError("reader/timeout", "Unit stepping timed out")), 30_000);
      work = stepNative(direction, abort.signal).finally(() => clearTimeout(timer));
    }
    void work.catch(error => {
      log.warn("reading mode step failed", error);
      if (errorCode(error) !== "reader/superseded") toastRef.current({ description: describeError(error).body, variant: "destructive" });
    });
  }, [stepNative]);

  const handleSectionLoad = useCallback(
    async (doc: Document, index: number) => {
      // The previous section's overlay died with it — nothing to remove.
      appliedCfiRef.current = null;
      sectionRef.current = { doc, index };
      const section = sectionRef.current;
      unitsRef.current = null;
      currentIndexRef.current = -1;
      visibleRangeRef.current = null;
      layoutReadyRef.current = false;
      pendingAnchorRef.current = null;
      clearUnit();
      if (!activeRef.current) {
        buildSession.invalidate();
        return;
      }
      const result = await buildUnits();
      if (!result?.isCurrent() || sectionRef.current !== section) return;
      const { units } = result;
      if (!units.length) {
        clearUnit();
        return;
      }
      // Landing position is only settled at the relocate that follows the
      // load, so record the intent and apply it there. Returning to the
      // section the navigator rests in re-draws the wash on
      // its remembered unit, in place. Any other section leaves the
      // navigator where it was — the wash simply isn't here.
      const resting = restingRef.current;
      pendingAnchorRef.current =
        resting?.sectionIndex === index
              ? { index: restoredIndex(units, doc, index), scroll: false }
              : !resting
                ? { index: anchorTextUnitIndex(units, visibleRangeRef.current), scroll: false }
                : null;
      if (pendingAnchorRef.current == null) clearUnit();
      // Worker segmentation can finish after relocate, not only before it.
      const pending = pendingAnchorRef.current;
      if (layoutReadyRef.current && pending) {
        pendingAnchorRef.current = null;
        applyIndex(pending.index, { scroll: pending.scroll });
      }
    },
    [applyIndex, buildSession, buildUnits, clearUnit, restoredIndex],
  );

  // Manual moves never displace the navigator; relocates only feed the visible
  // range (for first-anchor and re-entry) and land a deferred section anchor.
  const handleRelocate = useCallback(
    (detail: FoliateRelocateDetail) => {
      if (detail.range) {
        if (detail.range.startContainer.ownerDocument !== sectionRef.current?.doc) return;
        visibleRangeRef.current = detail.range;
        layoutReadyRef.current = true;
      }
      if (!activeRef.current || !unitsRef.current) return;

      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor != null) {
        pendingAnchorRef.current = null;
        applyIndex(pendingAnchor.index, { scroll: pendingAnchor.scroll });
      }
      positionWaiter.notify();
    },
    [applyIndex, positionWaiter],
  );

  // Activation: index the loaded section and rest on the persisted unit if
  // it lives here (a restored session), else on the first visible unit in
  // place (no scroll — the reader is already where the user left it).
  // Deactivation: clear the wash, forget the index, and drop the persisted
  // state — an explicit exit means "start fresh next time". A book switch or
  // unmount never runs this with the old book's id: the seed effect above has
  // already moved `bookIdRef` on by the time this one fires.
  useEffect(() => {
    buildSession.invalidate();
    setBuildErrorCode(undefined);
    const wasPersistedActive = persistedActiveRef.current;
    activeRef.current = active;
    persistedActiveRef.current = active || suspended;
    if (active) {
      // A plugin may have been re-enabled with a unit id unavailable while it
      // was suspended. Adopt it before rebuilding, then restore the retained
      // position before writing anything back.
      const requestedModeKey = requestedModeKeyRef.current;
      const requestedUnitId = requestedUnitIdRef.current;
      if (!requestedModeKey) return;
      const changedPolicy = modeKeyRef.current !== requestedModeKey || unitIdRef.current !== requestedUnitId;
      const reanchor = changedPolicy ? unitsRef.current?.[currentIndexRef.current] ?? null : null;
      if (changedPolicy) setResting(null);
      modeKeyRef.current = requestedModeKey;
      unitIdRef.current = requestedUnitId;
      if (!restingRef.current && wasPersistedActive) {
        const id = bookIdRef.current;
        const persisted = id ? readTextUnitModeState(id) : null;
        if (
          persisted &&
          isTextUnitModeStateCompatible(persisted, requestedModeKey, requestedUnitId, contentVersionRef.current)
        ) {
          setResting(persisted.resting);
        }
      }
      persistState();
      if (!sectionRef.current) { setStatus("building"); return; }
      void (async () => {
        const result = await buildUnits();
        if (!result?.isCurrent()) return;
        const { units } = result;
        const section = sectionRef.current;
        if (!activeRef.current || !section) return;
        const resting = restingRef.current;
        const index =
          resting?.sectionIndex === section.index
            ? restoredIndex(units, section.doc, section.index)
            : anchorTextUnitIndex(units, reanchor ?? visibleRangeRef.current);
        if (index >= 0) applyIndex(index, { scroll: false });
        else clearUnit();
      })();
      return;
    }
    clearWash();
    setStatus("inactive");
    setPreparedRevision(configurationRevision);
    unitsRef.current = null;
    currentIndexRef.current = -1;
    if (!suspended) setResting(null);
    persistState();
    pendingAnchorRef.current = null;
    clearUnit();
  }, [active, suspended, configurationRevision, applyIndex, buildSession, buildUnits, clearWash, persistState, setResting, restoredIndex]);

  // Mode or unit switch: re-segment the loaded section under the new plugin
  // policy. Contribution identity matters even when two plugins reuse the same
  // unit id; their offsets need not have the same meaning.
  // A wash resting here re-anchors to the unit containing its old start.
  // A wash resting in another section is dropped instead — its ordinal was
  // computed under the old segmentation and no longer addresses anything.
  const indexedSegmenterRef = useRef(segmentText);
  const indexedActiveRef = useRef(active);
  useEffect(() => {
    const segmenterChanged = indexedSegmenterRef.current !== segmentText;
    indexedSegmenterRef.current = segmentText;
    const wasActive = indexedActiveRef.current;
    indexedActiveRef.current = active;
    // Activation above already rebuilds and restores a compatible retained
    // position. A resumed provider's new callback identity must not erase it.
    if (!wasActive && active) return;
    if (modeKeyRef.current === modeKey && unitIdRef.current === unitId && !segmenterChanged) return;
    // Plugin unavailability must not reinterpret or overwrite retained state.
    // Activation above adopts the new unit before rebuilding the index.
    if (suspended && !active) return;
    buildSession.invalidate();
    modeKeyRef.current = modeKey;
    unitIdRef.current = unitId;
    const previousRange =
      currentIndexRef.current >= 0
        ? unitsRef.current?.[currentIndexRef.current] ?? null
        : null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    setResting(null);
    persistState();
    if (!activeRef.current || !sectionRef.current) {
      if (activeRef.current) clearUnit();
      return;
    }
    void (async () => {
      const result = await buildUnits();
      if (!result?.isCurrent()) return;
      const index = anchorTextUnitIndex(result.units, previousRange ?? visibleRangeRef.current);
      if (index >= 0) applyIndex(index, { scroll: false });
      else clearUnit();
    })();
  }, [active, suspended, modeKey, unitId, segmentText, applyIndex, buildSession, buildUnits, persistState, setResting]);

  // Android: while the mode is on, the volume keys step units (volume
  // down = forward). The shell captures them only for the mode's duration and
  // relays presses as VOLUME_STEP_EVENT; off Android both calls no-op.
  useEffect(() => {
    if (!active) return;
    const onVolumeStep = (event: Event) => {
      const focused = document.activeElement;
      // Don't steal the keys mid-typing (note editor, chat composer).
      if (
        focused instanceof HTMLElement &&
        (focused.isContentEditable ||
          focused.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      const direction = (event as CustomEvent<VolumeStepDirection>).detail;
      step(direction === "prev" ? -1 : 1);
    };
    setVolumeKeyCapture(true);
    window.addEventListener(VOLUME_STEP_EVENT, onVolumeStep);
    return () => {
      window.removeEventListener(VOLUME_STEP_EVENT, onVolumeStep);
      setVolumeKeyCapture(false);
    };
  }, [active, step]);

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  // A fresh overlayer starts empty — re-draw the wash the navigator believes
  // is applied (the reader re-applies the user's marks in the same event).
  const handleOverlayReady = useCallback(() => {
    if (!activeRef.current) return;
    const view = viewRef.current;
    const cfi = appliedCfiRef.current;
    if (!view || !cfi) return;
    applyNavigatorHighlight(view, cfi, veilColorRef.current);
  }, [viewRef]);

  // Bring the reader back to the resting unit. Same section: re-apply the
  // wash and scroll it into view. Another section: navigate to the unit's
  // CFI — the section-load handler then restores the wash in place.
  const returnToCurrent = useCallback(() => {
    if (!activeRef.current) return;
    const view = viewRef.current;
    const resting = restingRef.current;
    const id = bookIdRef.current;
    const version = contentVersionRef.current;
    if (!view || !resting || !id || !version) return;
    const session = readingRuntime.snapshot();
    if (session.bookId === id && session.status === "ready" && resting.cfiRange) {
      void readingRuntime.returnToMode(undefined, { bookId: id, sessionId: session.sessionId! }).catch(error => {
        log.warn("return to reading mode position failed", error);
        toastRef.current({ description: describeError(error).body, variant: "destructive" });
      });
      return;
    }
    const section = sectionRef.current;
    const units = unitsRef.current;
    if (section && units?.length && resting.sectionIndex === section.index) {
      applyIndex(restoredIndex(units, section.doc, section.index));
      return;
    }
    if (resting.cfiRange) {
      void view.goTo(resting.cfiRange).catch(error => {
        log.warn("unmanaged reader mode return failed", error);
      });
    }
  }, [applyIndex, viewRef, restoredIndex]);

  /** The unit after the resting one — read-aloud prefetches its audio while
   *  the current one plays. Stays inside the loaded section: peeking across
   *  a section boundary would need the next document. */
  const peekNext = useCallback(() => {
    if (!activeRef.current) return null;
    const units = unitsRef.current;
    const index = currentIndexRef.current;
    if (!units || index < 0 || index + 1 >= units.length) return null;
    return normalizeText(units[index + 1].toString()) || null;
  }, []);

  return {
    status,
    errorCode: buildErrorCode,
    configurationRevision: preparedRevision,
    waitForPosition,
    stepNative,
    current,
    position: bookIdRef.current && contentVersionRef.current && modeKeyRef.current && restingRef.current?.cfiRange ? {
      location: { bookId: bookIdRef.current, contentVersion: contentVersionRef.current, cfi: restingRef.current.cfiRange },
      modeKey: modeKeyRef.current, unitId: unitIdRef.current,
    } : null,
    progress,
    next,
    prev,
    peekNext,
    returnToCurrent,
    canReturn,
    handleSectionLoad,
    handleContentVersion,
    handleRelocate,
    handleOverlayReady,
  };
}
