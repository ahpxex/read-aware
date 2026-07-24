import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PluginReaderMode } from "../../plugins/lib/plugin-types";
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

export type TextUnitNavigator = {
  current: TextUnitTarget | null;
  next: () => void;
  prev: () => void;
  /** Bring the reader back to the unit the navigator rests on — even when
   *  page turns or chapter jumps have carried the view somewhere else. */
  returnToCurrent: () => void;
  /** Whether the navigator has a resting unit to return to. */
  canReturn: boolean;
  /** Engine bridges — invoke from the reader's `load` / `relocate` handlers. */
  handleSectionLoad: (doc: Document, index: number) => void;
  handleRelocate: (detail: FoliateRelocateDetail) => void;
  /** Invoke from the reader's `create-overlay` handler: the engine rebuilds a
   *  section's overlayer from scratch on re-layout (style injection, resize,
   *  reopen), and the wash must be re-drawn alongside the user's marks or it
   *  silently vanishes. */
  handleOverlayReady: () => void;
};

type UseTextUnitNavigatorOptions = {
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
  segmentText: PluginReaderMode["segmentText"];
  viewRef: RefObject<FoliateView | null>;
  readerRootRef: RefObject<HTMLElement | null>;
  /** Cross into the adjacent spine section, with the mode's transition. */
  crossSection: (direction: -1 | 1, fromSectionIndex: number | null) => Promise<void> | void;
  /** Re-draw any user mark whose overlay shares a CFI the navigator vacated
   *  (the overlayer keys drawings by CFI, so leaving a unit the user
   *  highlighted verbatim would otherwise erase their mark's visual). */
  restoreAnnotationAt: (cfiRange: string) => void;
  /** The reader's page color — the fill of the dimming veil drawn around the
   *  resting unit so the rest of the page recedes while navigating. */
  veilColor: string;
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

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
 * restored when its section is flipped back into view. Only stepping — or
 * stepping for the first time inside a section the wash isn't in, which
 * re-enters at the first visible unit — moves it.
 */
export function useTextUnitNavigator({
  active,
  suspended = false,
  bookId,
  modeKey,
  unitId,
  segmentText,
  viewRef,
  readerRootRef,
  crossSection,
  restoreAnnotationAt,
  veilColor,
}: UseTextUnitNavigatorOptions): TextUnitNavigator {
  const [current, setCurrent] = useState<TextUnitTarget | null>(null);
  const [canReturn, setCanReturn] = useState(false);

  const activeRef = useRef(active);
  const persistedActiveRef = useRef(active || suspended);
  const segmentTextRef = useRef(segmentText);
  segmentTextRef.current = segmentText;
  const sectionRef = useRef<{ doc: Document; index: number } | null>(null);
  const unitsRef = useRef<Range[] | null>(null);
  const currentIndexRef = useRef(-1);
  const appliedCfiRef = useRef<string | null>(null);
  const visibleRangeRef = useRef<Range | null>(null);
  // Unit to land on once the relocate that follows a section load fires
  // (layout is settled there; at `load` time the overlayer doesn't exist yet).
  const pendingAnchorRef = useRef<{ index: number; scroll: boolean } | null>(null);
  // Direction of an in-flight section cross initiated by stepping off the end.
  const pendingCrossRef = useRef<-1 | 1 | null>(null);
  // Where the navigator rests, by section + ordinal — remembered across
  // section unloads so flipping away and back restores the wash in place.
  // Persisted per book, so it also survives closing and reopening the book.
  const restingRef = useRef<TextUnitResting | null>(null);
  const bookIdRef = useRef(bookId);
  const modeKeyRef = useRef(modeKey);
  const unitIdRef = useRef(unitId);
  const requestedModeKeyRef = useRef(modeKey);
  requestedModeKeyRef.current = modeKey;
  const requestedUnitIdRef = useRef(unitId);
  requestedUnitIdRef.current = unitId;

  const crossSectionRef = useRef(crossSection);
  useEffect(() => { crossSectionRef.current = crossSection; }, [crossSection]);
  const restoreAnnotationAtRef = useRef(restoreAnnotationAt);
  useEffect(() => { restoreAnnotationAtRef.current = restoreAnnotationAt; }, [restoreAnnotationAt]);
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

  // Book switch: seed the resting unit from the book's persisted state
  // BEFORE its sections load, so the load handler can restore the wash in
  // place — and drop every reference into the outgoing book, so an activation
  // that fires before the new book's first section load can't index a dead
  // document. (Runs ahead of the activation effect below — order matters when
  // a restored book comes up with the mode already on.)
  useEffect(() => {
    bookIdRef.current = bookId;
    sectionRef.current = null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    visibleRangeRef.current = null;
    appliedCfiRef.current = null;
    pendingAnchorRef.current = null;
    pendingCrossRef.current = null;
    setCurrent(null);
    // A resting ordinal only means something under the unitId it was
    // written with — under another one, restore from scratch (the reader's own
    // progress still opens the book in place).
    const persisted = bookId ? readTextUnitModeState(bookId) : null;
    const currentModeKey = modeKeyRef.current;
    setResting(
      persisted &&
        (currentModeKey === null ||
          isTextUnitModeStateCompatible(persisted, currentModeKey, unitIdRef.current))
        ? persisted.resting
        : null,
    );
  }, [bookId, setResting]);

  const persistState = useCallback(() => {
    const id = bookIdRef.current;
    const currentModeKey = modeKeyRef.current;
    // A disabled/unavailable plugin must not overwrite its retained state with
    // an anonymous placeholder before it can register again.
    if (!id || !currentModeKey) return;
    writeTextUnitModeState(id, {
      active: persistedActiveRef.current,
      resting: restingRef.current,
      modeKey: currentModeKey,
      unitId: unitIdRef.current,
    });
  }, []);

  /** Remove the wash, re-drawing any user mark that shared its CFI. */
  const clearWash = useCallback(() => {
    const cfi = appliedCfiRef.current;
    appliedCfiRef.current = null;
    if (!cfi) return;
    const view = viewRef.current;
    if (!view) return;
    removeNavigatorHighlight(view, cfi);
    restoreAnnotationAtRef.current(cfi);
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
      if (scroll && !rangeComfortablyVisible(range)) {
        try {
          void view.renderer?.scrollToAnchor?.(range);
        } catch {
          // Geometry races during section teardown — the wash still applied.
        }
      }
    },
    [clearWash, persistState, rangeComfortablyVisible, setResting, viewRef],
  );

  const buildUnits = useCallback((): Range[] => {
    const section = sectionRef.current;
    if (!section) return (unitsRef.current = []);
    try {
      return (unitsRef.current = buildTextUnitRanges(
        section.doc,
        unitIdRef.current,
        segmentTextRef.current,
      ));
    } catch {
      return (unitsRef.current = []);
    }
  }, []);

  const step = useCallback(
    (direction: -1 | 1) => {
      if (!activeRef.current) return;
      const units = unitsRef.current;
      const crossFrom = sectionRef.current?.index ?? null;
      if (!units?.length) {
        // A unit-less section (images, an empty page) — cross straight over.
        pendingCrossRef.current = direction;
        void crossSectionRef.current(direction, crossFrom);
        return;
      }
      if (currentIndexRef.current < 0) {
        // The wash rests in another section (or nowhere yet): stepping
        // re-enters navigation here, at the first unit still in view.
        const index = anchorTextUnitIndex(units, visibleRangeRef.current);
        if (index >= 0) applyIndex(index, { scroll: false });
        return;
      }
      const nextIndex = currentIndexRef.current + direction;
      if (nextIndex < 0 || nextIndex >= units.length) {
        pendingCrossRef.current = direction;
        void crossSectionRef.current(direction, crossFrom);
        return;
      }
      applyIndex(nextIndex);
    },
    [applyIndex],
  );

  const handleSectionLoad = useCallback(
    (doc: Document, index: number) => {
      // The previous section's overlay died with it — nothing to remove.
      appliedCfiRef.current = null;
      sectionRef.current = { doc, index };
      unitsRef.current = null;
      currentIndexRef.current = -1;
      visibleRangeRef.current = null;
      if (!activeRef.current) {
        pendingCrossRef.current = null;
        return;
      }
      const units = buildUnits();
      const cross = pendingCrossRef.current;
      pendingCrossRef.current = null;
      if (!units.length) {
        setCurrent(null);
        return;
      }
      // Landing position is only settled at the relocate that follows the
      // load, so record the intent and apply it there. A cross initiated by
      // stepping enters at the near end (and may need a scroll to reach it);
      // returning to the section the navigator rests in re-draws the wash on
      // its remembered unit, in place. Any other section leaves the
      // navigator where it was — the wash simply isn't here.
      const resting = restingRef.current;
      pendingAnchorRef.current =
        cross === -1
          ? { index: units.length - 1, scroll: true }
          : cross === 1
            ? { index: 0, scroll: true }
            : resting?.sectionIndex === index
              ? { index: Math.min(resting.ordinal, units.length - 1), scroll: false }
              : null;
      if (pendingAnchorRef.current == null) setCurrent(null);
    },
    [buildUnits],
  );

  // Manual moves never displace the navigator; relocates only feed the visible
  // range (for first-anchor and re-entry) and land a deferred section anchor.
  const handleRelocate = useCallback(
    (detail: FoliateRelocateDetail) => {
      if (detail.range) visibleRangeRef.current = detail.range;
      if (!activeRef.current || !unitsRef.current) return;

      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor != null) {
        pendingAnchorRef.current = null;
        applyIndex(pendingAnchor.index, { scroll: pendingAnchor.scroll });
      }
    },
    [applyIndex],
  );

  // Activation: index the loaded section and rest on the persisted unit if
  // it lives here (a restored session), else on the first visible unit in
  // place (no scroll — the reader is already where the user left it).
  // Deactivation: clear the wash, forget the index, and drop the persisted
  // state — an explicit exit means "start fresh next time". A book switch or
  // unmount never runs this with the old book's id: the seed effect above has
  // already moved `bookIdRef` on by the time this one fires.
  useEffect(() => {
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
      modeKeyRef.current = requestedModeKey;
      unitIdRef.current = requestedUnitId;
      if (!restingRef.current && wasPersistedActive) {
        const id = bookIdRef.current;
        const persisted = id ? readTextUnitModeState(id) : null;
        if (
          persisted &&
          isTextUnitModeStateCompatible(persisted, requestedModeKey, requestedUnitId)
        ) {
          setResting(persisted.resting);
        }
      }
      persistState();
      if (!sectionRef.current) return;
      const units = unitsRef.current ?? buildUnits();
      const resting = restingRef.current;
      const index =
        resting?.sectionIndex === sectionRef.current.index
          ? Math.min(resting.ordinal, units.length - 1)
          : anchorTextUnitIndex(units, visibleRangeRef.current);
      if (index >= 0) applyIndex(index, { scroll: false });
      else setCurrent(null);
      return;
    }
    clearWash();
    unitsRef.current = null;
    currentIndexRef.current = -1;
    if (!suspended) setResting(null);
    persistState();
    pendingAnchorRef.current = null;
    pendingCrossRef.current = null;
    setCurrent(null);
  }, [active, suspended, applyIndex, buildUnits, clearWash, persistState, setResting]);

  // Mode or unit switch: re-segment the loaded section under the new plugin
  // policy. Contribution identity matters even when two plugins reuse the same
  // unit id; their offsets need not have the same meaning.
  // A wash resting here re-anchors to the unit containing its old start.
  // A wash resting in another section is dropped instead — its ordinal was
  // computed under the old segmentation and no longer addresses anything.
  useEffect(() => {
    if (modeKeyRef.current === modeKey && unitIdRef.current === unitId) return;
    // Plugin unavailability must not reinterpret or overwrite retained state.
    // Activation above adopts the new unit before rebuilding the index.
    if (suspended && !active) return;
    modeKeyRef.current = modeKey;
    unitIdRef.current = unitId;
    const previousRange =
      currentIndexRef.current >= 0
        ? unitsRef.current?.[currentIndexRef.current] ?? null
        : null;
    unitsRef.current = null;
    currentIndexRef.current = -1;
    if (!activeRef.current || !sectionRef.current || !previousRange) {
      setResting(null);
      persistState();
      if (activeRef.current) setCurrent(null);
      return;
    }
    const units = buildUnits();
    const index = anchorTextUnitIndex(units, previousRange);
    if (index >= 0) applyIndex(index, { scroll: false });
    else setCurrent(null);
  }, [active, suspended, modeKey, unitId, applyIndex, buildUnits, persistState, setResting]);

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
    if (!view || !resting) return;
    const section = sectionRef.current;
    const units = unitsRef.current;
    if (section && units?.length && resting.sectionIndex === section.index) {
      applyIndex(Math.min(resting.ordinal, units.length - 1));
      return;
    }
    if (resting.cfiRange) {
      void view.goTo(resting.cfiRange).catch(() => {
        // An unparseable stored CFI — the wash restores whenever its section
        // is next loaded; there is just nothing to jump to.
      });
    }
  }, [applyIndex, viewRef]);

  return {
    current,
    next,
    prev,
    returnToCurrent,
    canReturn,
    handleSectionLoad,
    handleRelocate,
    handleOverlayReady,
  };
}
