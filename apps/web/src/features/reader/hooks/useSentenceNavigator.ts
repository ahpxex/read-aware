import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FoliateRelocateDetail, FoliateView } from "../lib/foliate-engine";
import {
  applyNavigatorHighlight,
  removeNavigatorHighlight,
} from "../lib/highlight-renderer";
import {
  anchorSentenceIndex,
  buildSentenceRanges,
  rangesIntersect,
} from "../lib/sentence-index";

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

// Manual moves re-anchor the wash to the first visible sentence, but only once
// the relocation stream settles — scroll mode emits relocate per tick.
const REANCHOR_DEBOUNCE_MS = 200;
// Relocations caused by the navigator's own scroll-into-view are not manual
// moves; ignore them for this long after each self-initiated scroll.
const SELF_SCROLL_SUPPRESS_MS = 600;

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Sentence-by-sentence reading position over the foliate view. Owns the
 * sentence index for the loaded section, the current-sentence wash (drawn via
 * the engine's overlayer so it survives page turns and re-layout), stepping —
 * including crossing into adjacent sections at either end — and re-anchoring
 * after the reader is moved by other means (page turn, chapter jump, scroll).
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
  // (layout is settled there; at `load` time geometry is not yet trustworthy).
  const pendingAnchorRef = useRef<number | null>(null);
  // Direction of an in-flight section cross initiated by stepping off the end.
  const pendingCrossRef = useRef<-1 | 1 | null>(null);
  const selfScrollUntilRef = useRef(0);
  const reanchorTimerRef = useRef<number | null>(null);

  const crossSectionRef = useRef(crossSection);
  useEffect(() => { crossSectionRef.current = crossSection; }, [crossSection]);
  const restoreAnnotationAtRef = useRef(restoreAnnotationAt);
  useEffect(() => { restoreAnnotationAtRef.current = restoreAnnotationAt; }, [restoreAnnotationAt]);

  const cancelReanchor = useCallback(() => {
    if (reanchorTimerRef.current != null) {
      window.clearTimeout(reanchorTimerRef.current);
      reanchorTimerRef.current = null;
    }
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
      cancelReanchor();
      clearWash();
      currentIndexRef.current = index;
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
        selfScrollUntilRef.current = performance.now() + SELF_SCROLL_SUPPRESS_MS;
        try {
          void view.renderer?.scrollToAnchor?.(range);
        } catch {
          // Geometry races during section teardown — the wash still applied.
        }
      }
    },
    [cancelReanchor, clearWash, rangeFullyVisible, viewRef],
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
        applyIndex(direction === 1 ? 0 : sentences.length - 1);
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
      cancelReanchor();
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
      // stepping enters at the near end; other loads (chapter jump, reopen)
      // anchor to whatever ends up visible.
      pendingAnchorRef.current = cross === -1 ? sentences.length - 1 : cross === 1 ? 0 : null;
    },
    [buildSentences, cancelReanchor],
  );

  const handleRelocate = useCallback(
    (detail: FoliateRelocateDetail) => {
      if (detail.range) visibleRangeRef.current = detail.range;
      if (!activeRef.current || !sentencesRef.current) return;

      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor != null) {
        pendingAnchorRef.current = null;
        applyIndex(pendingAnchor);
        return;
      }

      if (performance.now() < selfScrollUntilRef.current) return;

      // A move the navigator didn't make (page turn, scroll, chapter jump):
      // once it settles, re-anchor the wash to the first sentence in view —
      // unless the current sentence is still showing.
      cancelReanchor();
      reanchorTimerRef.current = window.setTimeout(() => {
        reanchorTimerRef.current = null;
        if (!activeRef.current) return;
        const sentences = sentencesRef.current;
        const visible = visibleRangeRef.current;
        if (!sentences?.length || !visible) return;
        const currentRange = sentences[currentIndexRef.current];
        if (currentRange && rangesIntersect(currentRange, visible)) return;
        const index = anchorSentenceIndex(sentences, visible);
        if (index >= 0) applyIndex(index, { scroll: false });
      }, REANCHOR_DEBOUNCE_MS);
    },
    [applyIndex, cancelReanchor],
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
    cancelReanchor();
    clearWash();
    sentencesRef.current = null;
    currentIndexRef.current = -1;
    pendingAnchorRef.current = null;
    pendingCrossRef.current = null;
    setCurrent(null);
  }, [active, applyIndex, buildSentences, cancelReanchor, clearWash]);

  useEffect(() => cancelReanchor, [cancelReanchor]);

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  return { current, next, prev, handleSectionLoad, handleRelocate };
}
