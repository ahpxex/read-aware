import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { voiceProvidersAtom } from "../../plugins/state/plugin-store";
import { playAudioBytes } from "../lib/read-aloud-audio";
import { activePluginVoice } from "../lib/read-aloud-voice";
import { speakText, speechAvailable } from "../lib/read-aloud-speech";
import { ReadAloudController } from "../lib/read-aloud-controller";
import { readingRuntime } from "../../../domain/reading-runtime";
import { createLogger } from "../../../platform/logger";
import type { TextUnitTarget } from "./useTextUnitNavigator";

const log = createLogger("read-aloud");

/** Bind the real voice backend and current navigator to the shared reading domain. */
export function useReadAloud({ bookId, enabled, current, peekNext }: {
  bookId: string | null;
  enabled: boolean;
  current: TextUnitTarget | null;
  peekNext: () => string | null;
}) {
  const { toast } = useToast();
  const [systemVoiceRevision, setSystemVoiceRevision] = useState(0);
  useEffect(() => {
    const changed = () => setSystemVoiceRevision(value => value + 1);
    window.speechSynthesis?.addEventListener("voiceschanged", changed);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", changed);
  }, []);
  const providers = useAtomValue(voiceProvidersAtom);
  const resolved = activePluginVoice(providers);
  const provider = resolved?.provider;
  const voiceId = resolved?.voiceId;
  const voice = useMemo(() => provider && voiceId ? {
    synthesize: async (text: string) => {
      const bytes = await provider.synthesize({ text, voiceId });
      // Web Audio detaches its input. A provider may reuse its own buffer.
      return bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    },
  } : null, [provider, voiceId]);
  const [controller] = useState(() => new ReadAloudController({
    speak: speakText, play: playAudioBytes, systemAvailable: speechAvailable,
    report: error => log.warn("read aloud degraded or failed", error),
  }));
  const snapshot = useSyncExternalStore(controller.observe, controller.snapshot);
  const next = useCallback(async (signal: AbortSignal) => {
    const session = readingRuntime.snapshot();
    const result = await readingRuntime.stepMode("next", signal, { bookId: bookId ?? undefined, sessionId: session.sessionId ?? undefined });
    return result.outcome;
  }, [bookId]);

  useEffect(() => {
    controller.update({ enabled, unit: current, voice, next, peekNext });
  }, [controller, enabled, current, voice, next, peekNext, systemVoiceRevision]);

  useEffect(() => {
    let sessionId: string | null = null;
    let release: (() => void) | undefined;
    const unobserve = readingRuntime.observe(state => {
      const id = state.bookId === bookId && state.status === "ready" ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      release?.(); release = undefined;
      if (id) release = readingRuntime.bindPlayback(id, controller);
    });
    return () => { unobserve(); release?.(); controller.stop(); };
  }, [bookId, controller]);

  useEffect(() => {
    if (snapshot.status === "error") toast({ description: describeError({ code: snapshot.errorCode }).body, variant: "destructive" });
  }, [snapshot.status, snapshot.errorCode, toast]);

  const playing = ["preparing", "playing", "advancing"].includes(snapshot.status);
  const toggle = useCallback(() => {
    if (playing) controller.stop();
    else void controller.start("user").catch(error => log.warn("read aloud did not start", error));
  }, [playing, controller]);

  return { available: speechAvailable() || voice !== null, playing, toggle, snapshot };
}
