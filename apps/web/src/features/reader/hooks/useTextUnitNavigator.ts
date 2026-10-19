import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";
import { AppError, errorCode, type ReadingModePosition, type ReadingModeResume } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { TextUnitBuild } from "../lib/text-unit-build";
import { TextUnitPositionWaiter, positionUnavailable } from "../lib/text-unit-position-waiter";
import type { ModeFeedback, ModeStepResult } from "../lib/reading-mode-controller";
import { stepTextUnit, type TextUnitStepIndex } from "../lib/text-unit-stepper";
import { waitForReadingPaint } from "../lib/reading-engine-adapter";
import { resolveTextUnitPosition, textUnitContinuesBeyondPage, textUnitOnPage } from "../lib/text-unit-position";
import { readingRuntime } from "../../../domain/reading-runtime";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import { readingRenderActor, readingRenderContext } from "../lib/reading-render-context";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { useVolumeKeySteps } from "./useVolumeKeySteps";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import { applyNavigatorHighlight, removeNavigatorHighlight } from "../lib/highlight-renderer";
import { readTextUnitModeState, writeTextUnitModeState, type TextUnitResting } from "../lib/text-unit-mode-state";
import {
  anchorTextUnitIndex,
  buildTextUnitRanges,
  lastVisibleTextUnitIndex,
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
  origin: DomainActor;
  status: "inactive" | "building" | "ready" | "empty" | "error";
  errorCode?: string;
  configurationRevision: number;
  current: TextUnitTarget | null;
  position: ReadingModePosition | null;
  waitForPosition(position: ReadingModePosition, signal: AbortSignal): Promise<ModeFeedback>;
  stepNative(direction: -1 | 1, signal: AbortSignal, origin?: DomainActor): Promise<ModeStepResult>;
  /** Where the wash rests within the loaded section, or null while it rests
   *  elsewhere (another section, mode off, unit-less section). */
  progress: TextUnitProgress | null;
  next: () => void;
  prev: () => void;
  /** Text of the unit after the resting one, within the loaded section. */
  peekNext: () => string | null;
  /** Bring the reader back to the unit the navigator rests on — even when
   *  page turns or chapter jumps have carried the view somewhere else. With a
   *  return point (see `hasReturnPoint`), go back to that abandoned unit. */
  returnToCurrent: () => void;
  /** Whether the navigator has a resting unit to return to. */
  canReturn: boolean;
  /** A paginated step taken on a page the reader turned to re-anchors the
   *  wash there and keeps the abandoned unit as a return point until the
   *  reader goes back to it or leaves the mode. */
  hasReturnPoint: boolean;
  /** The resting unit as the reading position records it: what a progress
   *  observation made now carries (null when the mode has no resting unit). */
  resume: () => ReadingModeResume | null;
  /** Engine bridges — invoke from the reader's `load` / `relocate` handlers.
   *  Section loads settle once segmentation lands; failures surface as status. */
  handleSectionLoad: (doc: Document, index: number, origin?: DomainActor) => Promise<void>;
  /** Invoke once the opened book's view can resolve CFIs, before its first
   *  navigation. `resume` is the `readingMode` of the position the reader
   *  opens at — possibly observed on another device — and decides where the
   *  mode resumes; `undefined` means that position predates the field. */
  handleContentVersion: (
    bookId: string,
    contentVersion: string,
    origin?: DomainActor,
    resume?: ReadingModeResume | null,
  ) => void;
  handleRelocate: (detail: FoliateRelocateDetail) => void;
  /** Invoke from the reader's `create-overlay` handler: the engine rebuilds a
   *  section's overlayer from scratch on re-layout (style injection, resize,
   *  reopen), and the wash must be re-drawn alongside the user's marks or it
   *  silently vanishes. */
  handleOverlayReady: () => void;
};

type UseTextUnitNavigatorOptions = {
  configurationRevision?: number;
  configurationOrigin?: DomainActor;
  onPersistence?: (
    revision: number,
    modeKey: string | null,
    unitId: string | null,
    write: () => Promise<void>,
    position: ReadingModePosition | null,
  ) => void;
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
  /** The resting unit moved (or was let go): the reading position the reader
   *  last observed should be recorded again with the new `resume()`, so a
   *  step that stays on the page still reaches the synced position. */
  onResumeChange?: (resume: ReadingModeResume | null) => void;
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
 * navigator by themselves: the wash keeps its unit, off-screen if need be,
 * and is restored when its section is flipped back into view. Semantic
 * stepping continues from that resting unit wherever the viewport is. A
 * visual step on a paginated page the reader turned to instead re-anchors
 * there and keeps the abandoned unit as a return point (`hasReturnPoint`).
 */
export function useTextUnitNavigator({
  configurationRevision = 0,
  configurationOrigin = "system",
  onPersistence,
  active,
  suspended = false,
  bookId,
  modeKey,
  unitId,
  segmentText,
  viewRef,
  readerRootRef,
  veilColor,
  onResumeChange,
}: UseTextUnitNavigatorOptions): TextUnitNavigator {
  const onPersistenceRef = useRef(onPersistence);
  onPersistenceRef.current = onPersistence;
  const onResumeChangeRef = useRef(onResumeChange);
  onResumeChangeRef.current = onResumeChange;
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [status, setStatus] = useState<TextUnitNavigator["status"]>("inactive");
  const [feedbackOrigin, setFeedbackOrigin] = useState(() => causalActor(configurationOrigin));
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
  const [hasReturnPoint, setHasReturnPoint] = useState(false);
  const returnPointRef = useRef<TextUnitResting | null>(null);
  const setReturnPoint = useCallback((point: TextUnitResting | null) => {
    returnPointRef.current = point;
    setHasReturnPoint(point != null);
  }, []);

  // Current + progress travel together: both describe where the wash rests
  // in the loaded section, so every "nowhere" transition clears the pair.
  const clearUnit = useCallback(
    (origin: DomainActor) => {
      setFeedbackOrigin(causalActor(origin));
      setCurrent(null);
      setProgress(null);
      positionErrorRef.current = undefined;
      positionWaiter.notify();
    },
    [positionWaiter],
  );

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
  const pendingAnchorRef = useRef<{ index: number; scroll: boolean; origin: DomainActor; verify: boolean } | null>(
    null,
  );
  // Where the navigator rests, by section + ordinal — remembered across
  // section unloads so flipping away and back restores the wash in place.
  // Persisted per book, so it also survives closing and reopening the book.
  const restingRef = useRef<TextUnitResting | null>(null);
  // False while the resting unit comes from this device's own record of a
  // position that predates carrying it: another device may have read on since,
  // so it resumes only if it is on the page the reader opened at.
  const restingVerifiedRef = useRef(true);
  // The resting unit as an address, kept while the mode is on (or suspended)
  // even when no section index exists yet — an unregistered plugin resumes
  // from it on registration. Only a verified address reaches the position.
  const retainedRef = useRef<{ address: ReadingModeResume; verified: boolean } | null>(null);
  const publishedRef = useRef<ReadingModeResume | null>(null);
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

  const setResting = useCallback((resting: TextUnitResting | null, verified = true) => {
    restingRef.current = resting;
    restingVerifiedRef.current = verified;
    setCanReturn(resting != null);
  }, []);

  const retain = useCallback((retained: { address: ReadingModeResume; verified: boolean } | null) => {
    retainedRef.current = retained;
    const published = retained?.verified ? retained.address : null;
    const previous = publishedRef.current;
    if (
      previous === published ||
      (previous &&
        published &&
        previous.cfi === published.cfi &&
        previous.modeKey === published.modeKey &&
        previous.unitId === published.unitId &&
        previous.contentVersion === published.contentVersion)
    )
      return;
    publishedRef.current = published;
    onResumeChangeRef.current?.(published);
  }, []);

  const resume = useCallback(() => publishedRef.current, []);

  /** The address resolved against the open book. A CFI addresses content, so
   *  it resumes under any mode or unit; the unit containing it is found once
   *  its section is indexed. */
  const restingFromAddress = useCallback(
    (address: ReadingModeResume): TextUnitResting | null => {
      const view = viewRef.current;
      if (!view) return null;
      try {
        return { sectionIndex: view.resolveCFI(address.cfi).index, ordinal: null, cfiRange: address.cfi };
      } catch (error) {
        log.warn("discarding unresolvable reading mode address", error);
        return null;
      }
    },
    [viewRef],
  );

  // Drop outgoing document references before activation. Persisted positions
  // are restored only after the loader supplies the actual content version.
  // A new configuration actor alone is not a new book: it is read, not tracked.
  const clearForBook = useEffectEvent(() => clearUnit(configurationOrigin));
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
    clearForBook();
    // Do not restore or overwrite a saved position before the loader provides
    // the actual content identity (file hash or virtual-content version).
    setResting(null);
    setReturnPoint(null);
    retain(null);
  }, [bookId, buildSession, setResting, setReturnPoint, retain]);

  useEffect(
    () => () => {
      buildSession.invalidate();
      positionErrorRef.current = positionUnavailable();
      positionWaiter.notify();
    },
    [buildSession, positionWaiter],
  );

  const persistState = useCallback(
    (origin: DomainActor) => {
      const id = bookIdRef.current;
      const currentModeKey = modeKeyRef.current;
      // A disabled/unavailable plugin must not overwrite its retained state with
      // an anonymous placeholder before it can register again.
      if (!id || !currentModeKey || !contentVersionRef.current) return;
      const state = {
        active: persistedActiveRef.current,
        resting: restingRef.current,
        modeKey: currentModeKey,
        unitId: unitIdRef.current,
        contentVersion: contentVersionRef.current,
      };
      retain(
        state.active && state.resting?.cfiRange
          ? {
              address: {
                modeKey: state.modeKey,
                unitId: state.unitId,
                contentVersion: state.contentVersion,
                cfi: state.resting.cfiRange,
              },
              verified: restingVerifiedRef.current,
            }
          : null,
      );
      const write = () => writeTextUnitModeState(id, state, origin);
      const position = state.resting?.cfiRange
        ? {
            modeKey: state.modeKey,
            unitId: state.unitId,
            location: { bookId: id, contentVersion: state.contentVersion, cfi: state.resting.cfiRange },
          }
        : null;
      if (onPersistenceRef.current)
        onPersistenceRef.current(configurationRef.current, state.modeKey, state.unitId, write, position);
      else void write();
    },
    [retain],
  );

  const handleContentVersion = useCallback(
    (id: string, version: string, origin: DomainActor = "system", synced?: ReadingModeResume | null) => {
      if (id !== bookIdRef.current || !version) return;
      origin = causalActor(origin);
      buildSession.invalidate();
      sectionRef.current = null;
      unitsRef.current = null;
      currentIndexRef.current = -1;
      appliedCfiRef.current = null;
      visibleRangeRef.current = null;
      layoutReadyRef.current = false;
      pendingAnchorRef.current = null;
      contentVersionRef.current = version;
      clearUnit(origin);
      setStatus(activeRef.current ? "building" : "inactive");
      // The mode resumes where the reading position says it rested — the
      // position the reader opens at, wherever it was observed. Only a position
      // recorded before it carried the unit falls back to this device's own
      // record, which must then prove itself on the opened page.
      let retained: { address: ReadingModeResume; verified: boolean } | null = null;
      if (persistedActiveRef.current) {
        if (synced !== undefined) {
          retained = synced?.contentVersion === version ? { address: synced, verified: true } : null;
        } else {
          const saved = readTextUnitModeState(id);
          retained =
            saved.resting?.cfiRange && saved.modeKey && saved.unitId && saved.contentVersion === version
              ? {
                  address: {
                    modeKey: saved.modeKey,
                    unitId: saved.unitId,
                    contentVersion: version,
                    cfi: saved.resting.cfiRange,
                  },
                  verified: false,
                }
              : null;
        }
      }
      const resting = retained && modeKeyRef.current ? restingFromAddress(retained.address) : null;
      setResting(resting, retained?.verified ?? true);
      retain(resting || !modeKeyRef.current ? retained : null);
      setReturnPoint(null);
      // An exit while the file was loading could not yet persist its preference.
      persistState(origin);
    },
    [buildSession, clearUnit, setResting, setReturnPoint, persistState, restingFromAddress, retain],
  );

  const waitForPosition = useCallback(
    (position: ReadingModePosition, signal: AbortSignal): Promise<ModeFeedback> =>
      positionWaiter.wait(() => {
        if (positionErrorRef.current) throw positionErrorRef.current;
        if (
          !activeRef.current ||
          position.modeKey !== modeKeyRef.current ||
          position.unitId !== unitIdRef.current ||
          position.location.bookId !== bookIdRef.current
        )
          throw positionUnavailable();
        if (position.location.contentVersion !== contentVersionRef.current)
          throw new AppError("reader/stale-location", "Mode content changed during return");
        const section = sectionRef.current;
        const units = unitsRef.current;
        const view = viewRef.current;
        if (!section || !units || !view || !layoutReadyRef.current) return;
        const index = resolveTextUnitPosition(view, position.location.cfi, section.doc, section.index, units);
        if (index !== currentIndexRef.current || !appliedCfiRef.current) return;
        return {
          status: "ready",
          progress: { ordinal: index, total: units.length },
          cfiRange: appliedCfiRef.current,
          position: { ...position, location: { ...position.location, cfi: appliedCfiRef.current } },
        };
      }, signal),
    [positionWaiter, viewRef],
  );

  const restoredIndex = useCallback(
    (units: Range[], doc: Document, sectionIndex: number, origin: DomainActor): number => {
      const resting = restingRef.current;
      const view = viewRef.current;
      if (!view || !resting || resting.sectionIndex !== sectionIndex) return -1;
      try {
        return resolveTextUnitPosition(view, resting.cfiRange, doc, sectionIndex, units);
      } catch (error) {
        log.warn("discarding invalid reading mode position", error);
        setResting(null);
        persistState(origin);
        return anchorTextUnitIndex(units, visibleRangeRef.current);
      }
    },
    [viewRef, setResting, persistState],
  );

  /** A resting unit from this device's legacy record resumes only on the page
   *  the reader opened at; anywhere else the position moved on without it. */
  const verifiedIndex = useCallback((units: Range[], index: number): number => {
    if (restingVerifiedRef.current) return index;
    const visible = visibleRangeRef.current;
    const unit = units[index];
    return unit && textUnitOnPage(unit, visible) ? index : anchorTextUnitIndex(units, visible);
  }, []);

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
  const rangeComfortablyVisible = useCallback(
    (range: Range): boolean => {
      const root = readerRootRef.current;
      const frame = range.startContainer?.ownerDocument?.defaultView?.frameElement;
      if (!root || !(frame instanceof HTMLElement)) return true;
      const visible = visibleRangeRef.current;
      // The renderer clips content inside its margins (and across columns).
      // Host-window coordinates alone can call a clipped previous unit visible.
      if (
        visible?.startContainer.ownerDocument === range.startContainer.ownerDocument &&
        (range.compareBoundaryPoints(Range.START_TO_START, visible) < 0 ||
          range.compareBoundaryPoints(Range.END_TO_END, visible) > 0)
      )
        return false;
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
      // A hidden source/chapter has no geometry; it still needs navigation.
      if (!rects.length) return false;
      const rootRect = root.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const comfortBottom = viewRef.current?.renderer?.scrolled
        ? Math.min(
            SCROLL_COMFORT_BOTTOM_MAX_PX,
            Math.max(SCROLL_COMFORT_BOTTOM_MIN_PX, rootRect.height * SCROLL_COMFORT_BOTTOM_FRACTION),
          )
        : 0;
      return rects.every(
        (rect) =>
          frameRect.top + rect.top >= rootRect.top - 1 &&
          frameRect.top + rect.bottom <= rootRect.bottom - comfortBottom + 1 &&
          frameRect.left + rect.left >= rootRect.left - 1 &&
          frameRect.left + rect.right <= rootRect.right + 1,
      );
    },
    [readerRootRef, viewRef],
  );

  /** Rest on unit `index`: move the wash and (optionally) bring it into view. */
  const applyIndex = useCallback(
    (index: number, { scroll = true, origin = "user" }: { scroll?: boolean; origin?: DomainActor } = {}) => {
      const view = viewRef.current;
      const section = sectionRef.current;
      const range = unitsRef.current?.[index];
      if (!view || !section || !range) return;
      origin = causalActor(origin);
      setFeedbackOrigin(origin);
      clearWash();
      currentIndexRef.current = index;
      let cfi: string | null = null;
      try {
        cfi = view.getCFI(section.index, range);
      } catch {
        cfi = null;
      }
      setResting({ sectionIndex: section.index, ordinal: index, cfiRange: cfi });
      persistState(origin);
      if (cfi) {
        appliedCfiRef.current = cfi;
        applyNavigatorHighlight(view, cfi, veilColorRef.current);
      }
      setCurrent({ text: normalizeText(range.toString()), cfiRange: cfi });
      setProgress({ ordinal: index, total: unitsRef.current?.length ?? 0 });
      positionWaiter.notify();
      if (scroll && !rangeComfortablyVisible(range)) {
        try {
          void view.renderer?.scrollToAnchor?.(range, false, readingRenderContext(origin));
        } catch {
          // Geometry races during section teardown — the wash still applied.
        }
      }
    },
    [clearWash, persistState, rangeComfortablyVisible, setResting, viewRef, positionWaiter],
  );

  // The build lease covers both the Worker result and the caller's deferred
  // anchoring, including mode retirement and same-index document replacement.
  const buildUnits = useCallback(
    async (origin: DomainActor) => {
      const section = sectionRef.current;
      if (!section) return null;
      const segmenter = segmentTextRef.current;
      const unit = unitIdRef.current;
      const revision = configurationRef.current;
      unitsRef.current = null;
      currentIndexRef.current = -1;
      clearWash();
      clearUnit(origin);
      setStatus("building");
      setPreparedRevision(revision);
      setBuildErrorCode(undefined);
      const result = await buildSession.run((signal) => buildTextUnitRanges(section.doc, unit, segmenter, signal));
      const isCurrent = () =>
        Boolean(
          result?.isCurrent() &&
            activeRef.current &&
            sectionRef.current === section &&
            unitIdRef.current === unit &&
            segmentTextRef.current === segmenter &&
            configurationRef.current === revision,
        );
      if (!result || !isCurrent()) return null;
      setFeedbackOrigin(origin);
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
    },
    [buildSession, clearUnit, clearWash, positionWaiter],
  );

  const stepNative = useCallback(
    async (direction: -1 | 1, signal: AbortSignal, origin: DomainActor = "user"): Promise<ModeStepResult> => {
      origin = causalActor(origin);
      const context = readingRenderContext(origin);
      const view = viewRef.current;
      const id = bookIdRef.current;
      const version = contentVersionRef.current;
      const key = modeKeyRef.current;
      const unit = unitIdRef.current;
      const revision = configurationRef.current;
      if (!view || !id || !version || !key) throw positionUnavailable();
      const check = () => {
        if (signal.aborted) throw signal.reason;
        if (
          !activeRef.current ||
          viewRef.current !== view ||
          bookIdRef.current !== id ||
          modeKeyRef.current !== key ||
          unitIdRef.current !== unit ||
          configurationRef.current !== revision
        )
          throw positionUnavailable();
        if (contentVersionRef.current !== version)
          throw new AppError("reader/stale-location", "Mode content changed during stepping");
        if (positionErrorRef.current) throw positionErrorRef.current;
      };
      const position = (cfi: string): ReadingModePosition => ({
        location: { bookId: id, contentVersion: version, cfi },
        modeKey: key,
        unitId: unit,
      });
      const index = (signal: AbortSignal): Promise<TextUnitStepIndex> =>
        positionWaiter.wait(() => {
          check();
          const section = sectionRef.current;
          const units = unitsRef.current;
          if (!section || !units || !layoutReadyRef.current) return;
          const resting = restingRef.current;
          return {
            sectionIndex: section.index,
            count: units.length,
            currentIndex:
              resting?.sectionIndex === section.index && resting.cfiRange
                ? resolveTextUnitPosition(view, resting.cfiRange, section.doc, section.index, units)
                : currentIndexRef.current,
            visibleIndex: anchorTextUnitIndex(units, visibleRangeRef.current),
            position: (ordinal) => {
              check();
              if (sectionRef.current !== section || unitsRef.current !== units) throw positionUnavailable();
              const range = units[ordinal];
              if (!range) throw new AppError("reader/target-not-found", "Requested unit does not exist");
              return position(view.getCFI(section.index, range));
            },
          };
        }, signal);
      const outcome = await stepTextUnit(
        {
          resting: () => (restingRef.current?.cfiRange ? position(restingRef.current.cfiRange) : null),
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
          navigate: async (target) => {
            check();
            const section = sectionRef.current;
            const units = unitsRef.current;
            if (
              typeof target !== "number" &&
              section &&
              units &&
              layoutReadyRef.current &&
              view.resolveCFI(target.location.cfi).index === section.index
            ) {
              const ordinal = resolveTextUnitPosition(view, target.location.cfi, section.doc, section.index, units);
              const resting = restingRef.current;
              // Re-entering an already indexed resting unit is a logical step,
              // not a request to reposition the viewport. Reveal the destination
              // only when it leaves the same comfort band used by applyIndex.
              if (
                (resting?.sectionIndex === section.index && resting.cfiRange === target.location.cfi) ||
                rangeComfortablyVisible(units[ordinal]!)
              )
                return;
            }
            const resolved = await view.goTo(typeof target === "number" ? target : target.location.cfi, context);
            check();
            if (!resolved) throw new AppError("reader/target-not-found", "Reader could not resolve the unit target");
            await waitForReadingPaint(view);
            check();
          },
          land: async (target) => {
            await index(signal);
            check();
            const section = sectionRef.current!;
            const ordinal = resolveTextUnitPosition(
              view,
              target.location.cfi,
              section.doc,
              section.index,
              unitsRef.current!,
            );
            applyIndex(ordinal, { scroll: false, origin });
            await waitForPosition(target, signal);
          },
        },
        direction,
        signal,
      );
      const settled = await index(signal);
      check();
      return {
        outcome,
        feedback: {
          status: settled.count ? "ready" : "empty",
          cfiRange: appliedCfiRef.current,
          progress: currentIndexRef.current < 0 ? null : { ordinal: currentIndexRef.current, total: settled.count },
          position: restingRef.current?.cfiRange ? position(restingRef.current.cfiRange) : null,
        },
      };
    },
    [viewRef, positionWaiter, applyIndex, waitForPosition, rangeComfortablyVisible],
  );

  const unmanagedStepRef = useRef<AbortController | null>(null);
  useEffect(() => () => unmanagedStepRef.current?.abort(positionUnavailable()), []);
  const step = useCallback(
    (direction: -1 | 1) => {
      const session = readingRuntime.snapshot();
      const id = bookIdRef.current;
      const view = viewRef.current;
      const range = unitsRef.current?.[currentIndexRef.current];
      // Manual page turns leave the wash where it was. On a page the reader
      // turned to on purpose, a visual step reads from that page instead of
      // dragging the viewport back: the wash re-anchors here and the abandoned
      // unit becomes the return point. Scroll mode keeps its comfort-band
      // behaviour, and semantic stepping (read-aloud, plugin commands) never
      // re-anchors: a listener who flips ahead still hears the next sentence.
      const section = sectionRef.current;
      const units = unitsRef.current;
      const visible = visibleRangeRef.current;
      const resting = restingRef.current;
      if (
        view?.renderer?.scrolled === false &&
        section &&
        units?.length &&
        visible &&
        layoutReadyRef.current &&
        resting &&
        visible.startContainer.ownerDocument === section.doc &&
        !(resting.sectionIndex === section.index && range && textUnitOnPage(range, visible))
      ) {
        const index = direction === 1 ? anchorTextUnitIndex(units, visible) : lastVisibleTextUnitIndex(units, visible);
        if (index >= 0) {
          setReturnPoint(resting);
          applyIndex(index, { scroll: false, origin: "user" });
          return;
        }
      }
      // A visual Next/Previous gesture first reveals the current unit's other
      // page. Semantic stepMode calls (including read-aloud) still advance one
      // whole unit and must not replay a sentence once per displayed page.
      const continuePage =
        view?.renderer?.scrolled === false &&
        range &&
        textUnitContinuesBeyondPage(range, visibleRangeRef.current, direction);
      let work: Promise<unknown>;
      if (id && session.bookId === id && session.status === "ready") {
        const move = direction === 1 ? "next" : "previous";
        const guard = { bookId: id, sessionId: session.sessionId! };
        work = continuePage
          ? readingRuntime.step(move, undefined, guard, "user")
          : readingRuntime.stepMode(move, undefined, guard, "user");
      } else {
        // Component stories have no application session, but retain the same native traversal.
        unmanagedStepRef.current?.abort(positionUnavailable());
        const abort = new AbortController();
        unmanagedStepRef.current = abort;
        const timer = setTimeout(() => abort.abort(new AppError("reader/timeout", "Unit stepping timed out")), 30_000);
        work = (
          continuePage && view
            ? (direction === 1
                ? view.next(undefined, readingRenderContext("user"))
                : view.prev(undefined, readingRenderContext("user"))
              ).then(() => waitForReadingPaint(view))
            : stepNative(direction, abort.signal)
        ).finally(() => clearTimeout(timer));
      }
      void work.catch((error) => {
        log.warn("reading mode step failed", error);
        if (errorCode(error) !== "reader/superseded")
          toastRef.current({ description: describeError(error).body, variant: "destructive" });
      });
    },
    [stepNative, viewRef, applyIndex, setReturnPoint],
  );

  const handleSectionLoad = useCallback(
    async (doc: Document, index: number, origin: DomainActor = "system") => {
      origin = causalActor(origin);
      // The previous section's overlay died with it — nothing to remove.
      appliedCfiRef.current = null;
      sectionRef.current = { doc, index };
      const section = sectionRef.current;
      unitsRef.current = null;
      currentIndexRef.current = -1;
      visibleRangeRef.current = null;
      layoutReadyRef.current = false;
      pendingAnchorRef.current = null;
      clearUnit(origin);
      if (!activeRef.current) {
        buildSession.invalidate();
        return;
      }
      const result = await buildUnits(origin);
      if (!result?.isCurrent() || sectionRef.current !== section) return;
      const { units } = result;
      if (!units.length) {
        clearUnit(origin);
        return;
      }
      // Landing position is only settled at the relocate that follows the
      // load, so record the intent and apply it there. Returning to the
      // section the navigator rests in re-draws the wash on
      // its remembered unit, in place. Any other section leaves the
      // navigator where it was — the wash simply isn't here.
      // An unverified resting unit outside this section is not on the page
      // the reader opened at, so the mode starts from that page instead.
      const resting = restingRef.current;
      const unverified = resting != null && !restingVerifiedRef.current;
      pendingAnchorRef.current =
        resting?.sectionIndex === index
          ? { index: restoredIndex(units, doc, index, origin), scroll: false, origin, verify: unverified }
          : !resting || unverified
            ? { index: anchorTextUnitIndex(units, visibleRangeRef.current), scroll: false, origin, verify: false }
            : null;
      if (pendingAnchorRef.current == null) clearUnit(origin);
      // Worker segmentation can finish after relocate, not only before it.
      const pending = pendingAnchorRef.current;
      if (layoutReadyRef.current && pending) {
        pendingAnchorRef.current = null;
        applyIndex(pending.verify ? verifiedIndex(units, pending.index) : pending.index, {
          scroll: pending.scroll,
          origin: pending.origin,
        });
      }
    },
    [applyIndex, buildSession, buildUnits, clearUnit, restoredIndex, verifiedIndex],
  );

  // Manual moves never displace the navigator; relocates only feed the visible
  // range (for first-anchor and re-entry) and land a deferred section anchor.
  const handleRelocate = useCallback(
    (detail: FoliateRelocateDetail) => {
      if (detail.range) {
        const doc = detail.range.startContainer.ownerDocument;
        if (doc && doc !== sectionRef.current?.doc) {
          const index = detail.section?.current;
          if (index == null) return;
          // Scroll chapters can retain several source documents, and moving
          // between them need not emit another load. The relocated range owns
          // the navigator; a loaded continuation or cached page does not.
          void handleSectionLoad(doc, index, readingRenderActor(detail));
        }
        visibleRangeRef.current = detail.range;
        layoutReadyRef.current = true;
      }
      if (!activeRef.current || !unitsRef.current) return;

      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor != null) {
        pendingAnchorRef.current = null;
        applyIndex(pendingAnchor.verify ? verifiedIndex(unitsRef.current, pendingAnchor.index) : pendingAnchor.index, {
          scroll: pendingAnchor.scroll,
          origin: pendingAnchor.origin,
        });
      }
      positionWaiter.notify();
    },
    [applyIndex, handleSectionLoad, positionWaiter, verifiedIndex],
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
    const origin = causalActor(configurationOrigin);
    setFeedbackOrigin(origin);
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
      const reanchor = changedPolicy ? (unitsRef.current?.[currentIndexRef.current] ?? null) : null;
      if (changedPolicy) setResting(null);
      modeKeyRef.current = requestedModeKey;
      unitIdRef.current = requestedUnitId;
      // Resume from the retained address (the opened position's resting unit,
      // kept while the plugin was unavailable) unless a live unit re-anchors.
      const retained = retainedRef.current;
      if (
        !restingRef.current &&
        wasPersistedActive &&
        !reanchor &&
        retained &&
        retained.address.contentVersion === contentVersionRef.current
      ) {
        const restored = restingFromAddress(retained.address);
        if (restored) setResting(restored, retained.verified);
      }
      persistState(origin);
      if (!sectionRef.current) {
        setStatus("building");
        return;
      }
      void (async () => {
        const result = await buildUnits(origin);
        if (!result?.isCurrent()) return;
        const { units } = result;
        const section = sectionRef.current;
        if (!activeRef.current || !section) return;
        const resting = restingRef.current;
        const index =
          resting?.sectionIndex === section.index
            ? verifiedIndex(units, restoredIndex(units, section.doc, section.index, origin))
            : anchorTextUnitIndex(units, reanchor ?? visibleRangeRef.current);
        if (index >= 0) applyIndex(index, { scroll: false, origin });
        else clearUnit(origin);
      })();
      return;
    }
    clearWash();
    setStatus("inactive");
    setPreparedRevision(configurationRevision);
    unitsRef.current = null;
    currentIndexRef.current = -1;
    if (!suspended) setResting(null);
    setReturnPoint(null);
    persistState(origin);
    pendingAnchorRef.current = null;
    clearUnit(origin);
  }, [
    active,
    suspended,
    configurationRevision,
    configurationOrigin,
    applyIndex,
    buildSession,
    buildUnits,
    clearUnit,
    clearWash,
    persistState,
    setResting,
    setReturnPoint,
    restoredIndex,
    restingFromAddress,
    verifiedIndex,
  ]);

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
    const origin = causalActor(configurationOrigin);
    buildSession.invalidate();
    modeKeyRef.current = modeKey;
    unitIdRef.current = unitId;
    const previousRange = currentIndexRef.current >= 0 ? (unitsRef.current?.[currentIndexRef.current] ?? null) : null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    setResting(null);
    setReturnPoint(null);
    persistState(origin);
    if (!activeRef.current || !sectionRef.current) {
      if (activeRef.current) clearUnit(origin);
      return;
    }
    void (async () => {
      const result = await buildUnits(origin);
      if (!result?.isCurrent()) return;
      const index = anchorTextUnitIndex(result.units, previousRange ?? visibleRangeRef.current);
      if (index >= 0) applyIndex(index, { scroll: false, origin });
      else clearUnit(origin);
    })();
  }, [
    active,
    suspended,
    modeKey,
    unitId,
    segmentText,
    configurationOrigin,
    applyIndex,
    buildSession,
    buildUnits,
    clearUnit,
    persistState,
    setResting,
    setReturnPoint,
  ]);

  // Android: while the mode is on, the volume keys step units (volume
  // down = forward unless the reader flipped the keys in page-turn settings).
  useVolumeKeySteps(active, step);

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
    const id = bookIdRef.current;
    const version = contentVersionRef.current;
    const returnPoint = returnPointRef.current;
    if (returnPoint) {
      // Going back adopts the abandoned unit as the resting unit again; the
      // section handlers then restore the wash there once its document shows.
      setReturnPoint(null);
      setResting(returnPoint);
      const origin = causalActor("user");
      persistState(origin);
      const section = sectionRef.current;
      const units = unitsRef.current;
      if (!view || !id || !version) return;
      if (section && units?.length && returnPoint.sectionIndex === section.index) {
        applyIndex(restoredIndex(units, section.doc, section.index, origin), { origin });
        return;
      }
      if (!returnPoint.cfiRange) return;
      const session = readingRuntime.snapshot();
      const travel =
        session.bookId === id && session.status === "ready"
          ? readingRuntime.navigate(
              { bookId: id, contentVersion: version, cfi: returnPoint.cfiRange },
              undefined,
              "user",
            )
          : view.goTo(returnPoint.cfiRange, readingRenderContext(origin));
      void travel.catch((error) => {
        log.warn("return to abandoned reading unit failed", error);
        toastRef.current({ description: describeError(error).body, variant: "destructive" });
      });
      return;
    }
    const resting = restingRef.current;
    if (!view || !resting || !id || !version) return;
    const session = readingRuntime.snapshot();
    if (session.bookId === id && session.status === "ready" && resting.cfiRange) {
      void readingRuntime
        .returnToMode(undefined, { bookId: id, sessionId: session.sessionId! }, "user")
        .catch((error) => {
          log.warn("return to reading mode position failed", error);
          toastRef.current({ description: describeError(error).body, variant: "destructive" });
        });
      return;
    }
    const section = sectionRef.current;
    const units = unitsRef.current;
    if (section && units?.length && resting.sectionIndex === section.index) {
      const origin = causalActor("user");
      applyIndex(restoredIndex(units, section.doc, section.index, origin), { origin });
      return;
    }
    if (resting.cfiRange) {
      void view.goTo(resting.cfiRange).catch((error) => {
        log.warn("unmanaged reader mode return failed", error);
      });
    }
  }, [applyIndex, viewRef, restoredIndex, setResting, setReturnPoint, persistState]);

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
    origin: feedbackOrigin,
    status,
    errorCode: buildErrorCode,
    configurationRevision: preparedRevision,
    waitForPosition,
    stepNative,
    current,
    position:
      bookIdRef.current && contentVersionRef.current && modeKeyRef.current && restingRef.current?.cfiRange
        ? {
            location: {
              bookId: bookIdRef.current,
              contentVersion: contentVersionRef.current,
              cfi: restingRef.current.cfiRange,
            },
            modeKey: modeKeyRef.current,
            unitId: unitIdRef.current,
          }
        : null,
    progress,
    next,
    prev,
    peekNext,
    returnToCurrent,
    canReturn,
    hasReturnPoint,
    resume,
    handleSectionLoad,
    handleContentVersion,
    handleRelocate,
    handleOverlayReady,
  };
}
