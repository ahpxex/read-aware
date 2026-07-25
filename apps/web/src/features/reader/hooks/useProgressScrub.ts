/**
 * Pointer and keyboard scrubbing for the reader's progress bar.
 *
 * Owns only the interaction: where the pointer is over the track, whether a
 * drag is in flight, and which fraction the bar should paint while one is. The
 * jump itself is the caller's (`onSeek`), and it is committed on release — a
 * live seek would reload a section per pointer move, so the drag shows a
 * readout of where it will land instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { clampFraction } from "../lib/reader-progress";

type UseProgressScrubOptions = {
  /** The reading position the bar paints when no drag is in flight; null while
   *  the position is unknown. */
  fraction: number | null;
  /** False while there is nothing to seek in (no position, no handler). */
  enabled: boolean;
  /** One arrow-key step, as a fraction of the whole book. */
  stepFraction: number;
  /** One page-key step, as a fraction of the whole book. */
  pageStepFraction: number;
  onSeek: (fraction: number) => void;
};

export type ProgressScrub = {
  /** Fraction under the pointer while hovering or dragging, else null. */
  pointerFraction: number | null;
  dragging: boolean;
  /** Whether the pointer is over the track or dragging it — the cue to grow
   *  the hairline and reveal the knob, ticks, and readout. */
  active: boolean;
  /** What the filled portion should paint: the drag preview while dragging, a
   *  committed seek until the engine arrives, else the reading position. */
  displayFraction: number | null;
  handleProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
};

export function useProgressScrub({
  fraction,
  enabled,
  stepFraction,
  pageStepFraction,
  onSeek,
}: UseProgressScrubOptions): ProgressScrub {
  const [pointerFraction, setPointerFraction] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  // Read back inside the same gesture's later events, where a state read would
  // still see the value from the render the gesture started in.
  const draggingRef = useRef(false);
  // Where a committed seek is headed, held until the engine reports arriving.
  // Without it, letting go drops the bar back to the position the reader is
  // still on — a visible snap backwards, then a jump forwards once the jump
  // lands a few hundred milliseconds later.
  const [pending, setPending] = useState<number | null>(null);

  // The engine moved: its own position is the truth again.
  useEffect(() => {
    setPending(null);
  }, [fraction]);

  const commit = useCallback(
    (next: number) => {
      setPending(next);
      onSeek(next);
    },
    [onSeek],
  );

  const fractionAt = useCallback(
    (event: PointerEvent<HTMLElement>): number | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return null;
      return clampFraction((event.clientX - rect.left) / rect.width);
    },
    [],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const next = fractionAt(event);
      if (next == null) return;
      // Deliberately NOT focused here: WebKit treats a programmatic focus as
      // focus-visible, which would leave the bar looking grabbed long after the
      // pointer let go. Keyboard users reach it by tab.
      draggingRef.current = true;
      setDragging(true);
      setPointerFraction(next);
      // Capture routes the rest of the gesture here even once the pointer
      // leaves the 10px strip — a drag along a hairline never stays inside it.
      // Claimed after the drag is armed, so a refused capture costs reach, not
      // the gesture: a release back over the bar still commits.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer was released between the browser's event and this handler.
      }
    },
    [enabled, fractionAt],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Hovering feeds the same readout as dragging: the bar previews the
      // position under the pointer before the user commits to a drag.
      const next = fractionAt(event);
      if (next != null) setPointerFraction(next);
    },
    [enabled, fractionAt],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      const next = fractionAt(event) ?? pointerFraction;
      endDrag(event);
      // A touch gesture leaves no hover behind it; drop the readout with it.
      if (event.pointerType !== "mouse") setPointerFraction(null);
      if (next != null) commit(next);
    },
    [commit, endDrag, fractionAt, pointerFraction],
  );

  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      // Aborted gesture (system interruption): abandon it without seeking.
      endDrag(event);
      setPointerFraction(null);
    },
    [endDrag],
  );

  const onPointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Touch: entering IS the tap, and pointerdown already read the position.
      if (event.pointerType !== "mouse") return;
      const next = fractionAt(event);
      if (next != null) setPointerFraction(next);
    },
    [enabled, fractionAt],
  );

  const onPointerLeave = useCallback(() => {
    if (draggingRef.current) return;
    setPointerFraction(null);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled || fraction == null) return;
      const step = event.shiftKey ? pageStepFraction : stepFraction;
      // Step from where the last press is headed, not from where the engine
      // still is — held keys would otherwise all land on the same page.
      const from = pending ?? fraction;
      let next: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = from - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = from + step;
          break;
        case "PageDown":
          next = from + pageStepFraction;
          break;
        case "PageUp":
          next = from - pageStepFraction;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      // The reader's own arrow-key page turns listen on the document; a scrub
      // from the focused bar must not also turn a page.
      event.stopPropagation();
      commit(clampFraction(next));
    },
    [commit, enabled, fraction, pageStepFraction, pending, stepFraction],
  );

  const onBlur = useCallback(() => setPointerFraction(null), []);

  return {
    pointerFraction,
    dragging,
    active: pointerFraction != null || dragging,
    displayFraction: dragging ? pointerFraction ?? fraction : pending ?? fraction,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerEnter,
      onPointerLeave,
      onKeyDown,
      onBlur,
    },
  };
}
