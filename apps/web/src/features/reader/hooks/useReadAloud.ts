import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, speechAvailable, type SpeakHandle } from "../lib/read-aloud-speech";
import type { TextUnitTarget } from "./useTextUnitNavigator";

/** If stepping produces no new unit within this window, the book has ended. */
const ADVANCE_GUARD_MS = 6_000;

const unitKey = (unit: TextUnitTarget | null) =>
  unit ? `${unit.cfiRange ?? ""}::${unit.text}` : null;

/**
 * Read-aloud as autoplay for the text-unit navigator: speak the resting
 * unit, step on utterance end, and follow wherever the navigator goes — a
 * manual step or jump mid-playback simply restarts speech at the new unit.
 * The navigator keeps owning position, highlight, and persistence; this hook
 * owns nothing but the voice.
 */
export function useReadAloud({
  enabled,
  current,
  next,
}: {
  /** The navigator mode is on and driving the engine. */
  enabled: boolean;
  current: TextUnitTarget | null;
  next: () => void;
}): { available: boolean; playing: boolean; toggle: () => void } {
  const [playing, setPlaying] = useState(false);
  const handleRef = useRef<SpeakHandle | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  const guardRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (guardRef.current) clearTimeout(guardRef.current);
    guardRef.current = null;
    handleRef.current?.cancel();
    handleRef.current = null;
    spokenKeyRef.current = null;
    setPlaying(false);
  }, []);

  // The playback loop: whenever we are playing and the resting unit is one
  // we have not spoken yet, speak it. Auto-advance and manual navigation
  // converge on this one path.
  useEffect(() => {
    if (!playing) return;
    if (!enabled || !current?.text) {
      stop();
      return;
    }
    const key = unitKey(current);
    if (key === spokenKeyRef.current) return;
    if (guardRef.current) clearTimeout(guardRef.current);
    guardRef.current = null;
    spokenKeyRef.current = key;
    handleRef.current?.cancel();
    handleRef.current = speakText(current.text, {
      onEnd: () => {
        // Step forward; if no new unit arrives (end of book, or a section
        // that will not load), the guard closes playback instead of hanging.
        guardRef.current = setTimeout(stop, ADVANCE_GUARD_MS);
        next();
      },
      onError: stop,
    });
  }, [playing, enabled, current, next, stop]);

  // Leaving the reader or switching books unmounts us — never leave a voice
  // speaking into an empty room.
  useEffect(() => () => {
    handleRef.current?.cancel();
    if (guardRef.current) clearTimeout(guardRef.current);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      stop();
      return;
    }
    if (!speechAvailable() || !enabled) return;
    spokenKeyRef.current = null;
    setPlaying(true);
  }, [playing, enabled, stop]);

  return { available: speechAvailable(), playing, toggle };
}
