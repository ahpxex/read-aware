import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import {
  applyNavigatorHighlight,
  removeNavigatorHighlight,
} from "../lib/highlight-renderer";
import { anchorSentenceIndex, buildSentenceRanges } from "../lib/sentence-index";

/** The sentence the navigator rests on — the target for the bar's actions. */
export type NavigatorSentence = {
  text: string;
  cfiRange: string | null;
};

export type SentenceNavigator = {
  current: NavigatorSentence | null;
  next: () => void;
  prev: () => void;
  /** Engine bridges — invoke from the reader's `load` / `relocate` handlers. */
  handleSectionLoad: (doc: Document, index: number) => void;
  handleRelocate: (detail: FoliateRelocateDetail) => void;
};

type UseSentenceNavigatorOptions = {
  active: boolean;
  viewRef: RefObject<FoliateView | null>;
  readerRootRef: RefObject<HTMLElement | null>;
  /** Cross into the adjacent spine section, with the mode's transition. */
  crossSection: (direction: -1 | 1, fromSectionIndex: number | null) => Promise<void> | void;
  /** Re-draw any user mark whose overlay shares a CFI the navigator vacated
   *  (the overlayer keys drawings by CFI, so leaving a sentence the user
   *  highlighted verbatim would otherwise erase their mark's visual). */
  restoreAnnotationAt: (cfiRange: string) => void;
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Sentence-by-sentence reading position over the foliate view. Owns the
 * sentence index for the loaded section, the current-sentence wash (drawn via
 * the engine's overlayer so it survives page turns and re-layout), and
 * stepping — including crossing into adjacent sections at either end.
 *
 * Manual moves (page turns, scrolling, chapter jumps) never displace the
 * navigator: the wash keeps its sentence, off-screen if need be, and is
 * restored when its section is flipped back into view. Only stepping — or
 * stepping for the first time inside a section the wash isn't in, which
 * re-enters at the first visible sentence — moves it.
 */
export function useSentenceNavigator({
  active,
  viewRef,
  readerRootRef,
  crossSection,
  restoreAnnotationAt,
}: UseSentenceNavigatorOptions): SentenceNavigator {
  const [current, setCurrent] = useState<NavigatorSentence | null>(null);

  const activeRef = useRef(active);
  const sectionRef = useRef<{ doc: Document; index: number } | null>(null);
  const sentencesRef = useRef<Range[] | null>(null);
  const currentIndexRef = useRef(-1);
  const appliedCfiRef = useRef<string | null>(null);
  const visibleRangeRef = useRef<Range | null>(null);
  // Sentence to land on once the relocate that follows a section load fires
  // (layout is settled there; at `load` time the overlayer doesn't exist yet).
  const pendingAnchorRef = useRef<{ index: number; scroll: boolean } | null>(null);
  // Direction of an in-flight section cross initiated by stepping off the end.
  const pendingCrossRef = useRef<-1 | 1 | null>(null);
  // Where the navigator rests, by section + ordinal — remembered across
  // section unloads so flipping away and back restores the wash in place.
  const restingRef = useRef<{ sectionIndex: number; ordinal: number } | null>(null);

  const crossSectionRef = useRef(crossSection);
  useEffect(() => { crossSectionRef.current = crossSection; }, [crossSection]);
  const restoreAnnotationAtRef = useRef(restoreAnnotationAt);
  useEffect(() => { restoreAnnotationAtRef.current = restoreAnnotationAt; }, [restoreAnnotationAt]);

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

  /** Whether every rect of the range sits inside the reader viewport. */
  const rangeFullyVisible = useCallback((range: Range): boolean => {
    const root = readerRootRef.current;
    const frame = range.startContainer?.ownerDocument?.defaultView?.frameElement;
    if (!root || !(frame instanceof HTMLElement)) return true;
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1,
    );
    if (!rects.length) return true;
    const rootRect = root.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return rects.every(
      (rect) =>
        frameRect.top + rect.top >= rootRect.top - 1 &&
        frameRect.top + rect.bottom <= rootRect.bottom + 1 &&
        frameRect.left + rect.left >= rootRect.left - 1 &&
        frameRect.left + rect.right <= rootRect.right + 1,
    );
  }, [readerRootRef]);

  /** Rest on sentence `index`: move the wash and (optionally) bring it into view. */
  const applyIndex = useCallback(
    (index: number, { scroll = true }: { scroll?: boolean } = {}) => {
      const view = viewRef.current;
      const section = sectionRef.current;
      const range = sentencesRef.current?.[index];
      if (!view || !section || !range) return;
      clearWash();
      currentIndexRef.current = index;
      restingRef.current = { sectionIndex: section.index, ordinal: index };
      let cfi: string | null = null;
      try {
        cfi = view.getCFI(section.index, range);
      } catch {
        cfi = null;
      }
      if (cfi) {
        appliedCfiRef.current = cfi;
        applyNavigatorHighlight(view, cfi);
      }
      setCurrent({ text: normalizeText(range.toString()), cfiRange: cfi });
      if (scroll && !rangeFullyVisible(range)) {
        try {
          void view.renderer?.scrollToAnchor?.(range);
        } catch {
          // Geometry races during section teardown — the wash still applied.
        }
      }
    },
    [clearWash, rangeFullyVisible, viewRef],
  );

  const buildSentences = useCallback((): Range[] => {
    const section = sectionRef.current;
    if (!section) return (sentencesRef.current = []);
    try {
      return (sentencesRef.current = buildSentenceRanges(section.doc));
    } catch {
      return (sentencesRef.current = []);
    }
  }, []);

  const step = useCallback(
    (direction: -1 | 1) => {
      if (!activeRef.current) return;
      const sentences = sentencesRef.current;
      const crossFrom = sectionRef.current?.index ?? null;
      if (!sentences?.length) {
        // A sentence-less section (images, an empty page) — cross straight over.
        pendingCrossRef.current = direction;
        void crossSectionRef.current(direction, crossFrom);
        return;
      }
      if (currentIndexRef.current < 0) {
        // The wash rests in another section (or nowhere yet): stepping
        // re-enters navigation here, at the first sentence still in view.
        const index = anchorSentenceIndex(sentences, visibleRangeRef.current);
        if (index >= 0) applyIndex(index, { scroll: false });
        return;
      }
      const nextIndex = currentIndexRef.current + direction;
      if (nextIndex < 0 || nextIndex >= sentences.length) {
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
      sentencesRef.current = null;
      currentIndexRef.current = -1;
      visibleRangeRef.current = null;
      if (!activeRef.current) {
        pendingCrossRef.current = null;
        return;
      }
      const sentences = buildSentences();
      const cross = pendingCrossRef.current;
      pendingCrossRef.current = null;
      if (!sentences.length) {
        setCurrent(null);
        return;
      }
      // Landing position is only settled at the relocate that follows the
      // load, so record the intent and apply it there. A cross initiated by
      // stepping enters at the near end (and may need a scroll to reach it);
      // returning to the section the navigator rests in re-draws the wash on
      // its remembered sentence, in place. Any other section leaves the
      // navigator where it was — the wash simply isn't here.
      const resting = restingRef.current;
      pendingAnchorRef.current =
        cross === -1
          ? { index: sentences.length - 1, scroll: true }
          : cross === 1
            ? { index: 0, scroll: true }
            : resting?.sectionIndex === index
              ? { index: Math.min(resting.ordinal, sentences.length - 1), scroll: false }
              : null;
      if (pendingAnchorRef.current == null) setCurrent(null);
    },
    [buildSentences],
  );

  // Manual moves never displace the navigator; relocates only feed the visible
  // range (for first-anchor and re-entry) and land a deferred section anchor.
  const handleRelocate = useCallback(
    (detail: FoliateRelocateDetail) => {
      if (detail.range) visibleRangeRef.current = detail.range;
      if (!activeRef.current || !sentencesRef.current) return;

      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor != null) {
        pendingAnchorRef.current = null;
        applyIndex(pendingAnchor.index, { scroll: pendingAnchor.scroll });
      }
    },
    [applyIndex],
  );

  // Activation: index the loaded section and rest on the first visible
  // sentence in place (no scroll — the reader is already where the user left
  // it). Deactivation: clear the wash and forget the index.
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      if (!sectionRef.current) return;
      const sentences = sentencesRef.current ?? buildSentences();
      const index = anchorSentenceIndex(sentences, visibleRangeRef.current);
      if (index >= 0) applyIndex(index, { scroll: false });
      else setCurrent(null);
      return;
    }
    clearWash();
    sentencesRef.current = null;
    currentIndexRef.current = -1;
    restingRef.current = null;
    pendingAnchorRef.current = null;
    pendingCrossRef.current = null;
    setCurrent(null);
  }, [active, applyIndex, buildSentences, clearWash]);

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  return { current, next, prev, handleSectionLoad, handleRelocate };
}
