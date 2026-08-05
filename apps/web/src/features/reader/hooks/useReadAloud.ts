import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { voiceProvidersAtom } from "../../plugins/state/plugin-store";
import { playAudioBytes } from "../lib/read-aloud-audio";
import {
  readAloudVoiceAtom,
  resolvePluginVoice,
  type ResolvedPluginVoice,
} from "../lib/read-aloud-voice";
import { speakText, speechAvailable } from "../lib/read-aloud-speech";
import type { TextUnitTarget } from "./useTextUnitNavigator";

/** If stepping produces no new unit within this window, the book has ended. */
const ADVANCE_GUARD_MS = 6_000;

const unitKey = (unit: TextUnitTarget | null) =>
  unit ? `${unit.cfiRange ?? ""}::${unit.text}` : null;

type Handle = { cancel: () => void };

async function synthesizeBytes(
  voice: ResolvedPluginVoice,
  text: string,
): Promise<ArrayBuffer> {
  const raw = await voice.provider.synthesize({ text, voiceId: voice.voiceId });
  // decodeAudioData detaches its input; always hand over a private copy.
  return raw instanceof Uint8Array
    ? raw.slice().buffer
    : raw.slice(0);
}

/**
 * Read-aloud as autoplay for the text-unit navigator: speak the resting
 * unit, step on utterance end, and follow wherever the navigator goes — a
 * manual step or jump mid-playback simply restarts speech at the new unit.
 * The navigator keeps owning position, highlight, and persistence; this hook
 * owns nothing but the voice.
 *
 * The voice is the system speech engine, or a plugin voice provider
 * (Settings → Reading): the provider turns text into audio bytes, the host
 * plays them, and the NEXT unit's audio is prefetched while the current one
 * plays so cloud-synthesis latency hides between sentences. A failed
 * provider call falls back to the system voice for that unit — reading
 * degrades, it does not fall silent.
 */
export function useReadAloud({
  enabled,
  current,
  next,
  peekNext,
}: {
  /** The navigator mode is on and driving the engine. */
  enabled: boolean;
  current: TextUnitTarget | null;
  next: () => void;
  peekNext: () => string | null;
}): { available: boolean; playing: boolean; toggle: () => void } {
  const providers = useAtomValue(voiceProvidersAtom);
  const preference = useAtomValue(readAloudVoiceAtom);
  const pluginVoice = resolvePluginVoice(preference, providers);

  const [playing, setPlaying] = useState(false);
  const handleRef = useRef<Handle | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  const guardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef<ResolvedPluginVoice | null>(pluginVoice);
  voiceRef.current = pluginVoice;
  const prefetchRef = useRef<{ text: string; bytes: ArrayBuffer } | null>(null);
  const prefetchingRef = useRef<string | null>(null);
  const peekNextRef = useRef(peekNext);
  peekNextRef.current = peekNext;

  const stop = useCallback(() => {
    if (guardRef.current) clearTimeout(guardRef.current);
    guardRef.current = null;
    handleRef.current?.cancel();
    handleRef.current = null;
    spokenKeyRef.current = null;
    prefetchRef.current = null;
    prefetchingRef.current = null;
    setPlaying(false);
  }, []);

  /** Best-effort: synthesize the upcoming unit into the single-slot cache. */
  const prefetchUpcoming = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    const upcoming = peekNextRef.current();
    if (
      !upcoming ||
      prefetchRef.current?.text === upcoming ||
      prefetchingRef.current === upcoming
    ) {
      return;
    }
    prefetchingRef.current = upcoming;
    synthesizeBytes(voice, upcoming)
      .then((bytes) => {
        if (prefetchingRef.current === upcoming) {
          prefetchRef.current = { text: upcoming, bytes };
        }
      })
      .catch(() => {
        // The live path will retry (and fall back) when the unit arrives.
      })
      .finally(() => {
        if (prefetchingRef.current === upcoming) prefetchingRef.current = null;
      });
  }, []);

  /** Speak one unit through the provider, system fallback on failure. */
  const speakUnit = useCallback(
    (
      text: string,
      callbacks: { onEnd: () => void; onError: () => void },
    ): Handle => {
      const voice = voiceRef.current;
      if (!voice) return speakText(text, { ...callbacks, onError: callbacks.onError });

      let cancelled = false;
      let inner: Handle | null = null;
      const fallBack = (reason: unknown) => {
        // Degrading to the system voice must be AUDIBLE in the console, or a
        // misconfigured provider looks like it simply doesn't exist.
        console.warn("[read-aloud] provider voice failed, using system voice", reason);
        if (cancelled || !speechAvailable()) {
          callbacks.onError();
          return;
        }
        inner = speakText(text, { ...callbacks, onError: callbacks.onError });
      };
      void (async () => {
        try {
          const cached =
            prefetchRef.current?.text === text ? prefetchRef.current : null;
          if (cached) prefetchRef.current = null;
          const bytes = cached ? cached.bytes : await synthesizeBytes(voice, text);
          if (cancelled) return;
          inner = playAudioBytes(bytes, {
            onEnd: callbacks.onEnd,
            onError: fallBack,
          });
          prefetchUpcoming();
        } catch (error) {
          fallBack(error);
        }
      })();
      return {
        cancel: () => {
          cancelled = true;
          inner?.cancel();
        },
      };
    },
    [prefetchUpcoming],
  );

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
    handleRef.current = speakUnit(current.text, {
      onEnd: () => {
        // Step forward; if no new unit arrives (end of book, or a section
        // that will not load), the guard closes playback instead of hanging.
        guardRef.current = setTimeout(stop, ADVANCE_GUARD_MS);
        next();
      },
      onError: stop,
    });
  }, [playing, enabled, current, next, speakUnit, stop]);

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
    if (!enabled) return;
    if (!speechAvailable() && !voiceRef.current) return;
    spokenKeyRef.current = null;
    setPlaying(true);
  }, [playing, enabled, stop]);

  return {
    available: speechAvailable() || pluginVoice !== null,
    playing,
    toggle,
  };
}
