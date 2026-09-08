import { AppError, errorCode, type EventOrigin, type ReadingPlaybackSnapshot, type ReadingModeStepOutcome } from "@read-aware/core";

export type PlaybackHandle = { cancel(): void };
export type PlaybackCallbacks = { onStart(): void; onEnd(): void; onError(error: unknown): void };
export type PlaybackVoice = { synthesize(text: string): Promise<ArrayBuffer> };
export type PlaybackInput = {
  enabled: boolean;
  unit: { text: string; cfiRange: string | null } | null;
  voice: PlaybackVoice | null;
  next(signal: AbortSignal): Promise<ReadingModeStepOutcome>;
  peekNext(): string | null;
};
type Dependencies = {
  systemAvailable(): boolean;
  speak(text: string, callbacks: PlaybackCallbacks): PlaybackHandle;
  play(bytes: ArrayBuffer, callbacks: PlaybackCallbacks): PlaybackHandle;
  report(error: unknown): void;
};

/** Owns playback, including in-flight synthesis. React and both actors use this one state machine. */
export class ReadAloudController {
  private input: PlaybackInput = { enabled: false, unit: null, voice: null, next: async () => { throw new AppError("reader/unavailable", "Unit stepper is not attached"); }, peekNext: () => null };
  private state: ReadingPlaybackSnapshot = { status: "unavailable", unavailableReason: "mode-inactive", backend: null, fallback: false, owner: null, cfiRange: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private running = false;
  private handle: PlaybackHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private releaseSignal: (() => void) | undefined;
  private pending: { resolve(): void; reject(error: unknown): void } | undefined;
  private cache: { text: string; bytes: ArrayBuffer; voice: PlaybackVoice } | undefined;
  private advance: AbortController | undefined;

  constructor(private readonly deps: Dependencies, private readonly startDeadlineMs = 30_000, private readonly advanceDeadlineMs = 35_000) {}

  snapshot = (): ReadingPlaybackSnapshot => this.state;
  observe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(input: PlaybackInput): void {
    const old = this.input;
    this.input = input;
    if (!input.enabled || (!input.voice && !this.deps.systemAvailable())) {
      this.stop();
      return;
    }
    const changed = old.unit?.text !== input.unit?.text || old.unit?.cfiRange !== input.unit?.cfiRange || old.voice !== input.voice;
    if (this.running && changed) {
      // Unit feedback commits before the navigation receipt. Its own update
      // must not cancel the step or start speech from an intermediate section.
      if (this.advance && old.voice === input.voice) return;
      if (old.voice !== input.voice) this.cache = undefined;
      this.speakCurrent();
    } else if (!this.running) this.publish({
      status: this.reason() ? "unavailable" : this.state.status === "error" ? "error" : "stopped",
      unavailableReason: this.reason(), cfiRange: input.unit?.cfiRange ?? null,
    });
  }

  start(owner: EventOrigin, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.reason()) return Promise.reject(new AppError("reader/unavailable", `Read aloud unavailable: ${this.reason()}`));
    this.stop();
    this.running = true;
    this.publish({ owner, errorCode: undefined });
    const result = new Promise<void>((resolve, reject) => { this.pending = { resolve, reject }; });
    const abort = () => this.stop(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    this.releaseSignal = () => signal?.removeEventListener("abort", abort);
    this.speakCurrent();
    return result;
  }

  stop(reason: unknown = new AppError("reader/superseded", "Playback was stopped or replaced")): void {
    this.running = false;
    this.cancelUnit();
    this.releaseSignal?.(); this.releaseSignal = undefined;
    this.pending?.reject(reason); this.pending = undefined;
    this.cache = undefined;
    this.publish({ status: this.reason() ? "unavailable" : "stopped", unavailableReason: this.reason(), backend: null, fallback: false, owner: null, errorCode: undefined, cfiRange: this.input.unit?.cfiRange ?? null });
  }

  private reason(): ReadingPlaybackSnapshot["unavailableReason"] {
    return !this.input.enabled ? "mode-inactive" : !this.input.voice && !this.deps.systemAvailable() ? "no-voice" : !this.input.unit?.text ? "no-unit" : null;
  }

  private cancelUnit(): void {
    ++this.generation;
    this.advance?.abort(new AppError("reader/superseded", "Playback advance was replaced")); this.advance = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    this.handle?.cancel(); this.handle = null;
  }

  private fail(error: unknown): void {
    this.deps.report(error);
    this.stop(error);
    this.publish({ status: "error", errorCode: errorCode(error) ?? "reader/playback-failed" });
  }

  private speakCurrent(): void {
    this.cancelUnit();
    const token = this.generation;
    const active = () => this.running && token === this.generation;
    const { unit, voice } = this.input;
    if (!unit?.text) {
      this.publish({ status: "advancing", cfiRange: null, unavailableReason: "no-unit" });
      this.timer = setTimeout(() => { if (active()) this.fail(new AppError("reader/timeout", "No next reading unit arrived")); }, this.advanceDeadlineMs);
      return;
    }
    this.publish({ status: "preparing", unavailableReason: null, cfiRange: unit.cfiRange, backend: voice ? "plugin" : "system", fallback: false, errorCode: undefined });
    this.timer = setTimeout(() => { if (active()) this.fail(new AppError("reader/timeout", "Audio did not start")); }, this.startDeadlineMs);
    let started = false;
    let ended = false;
    const callbacks: PlaybackCallbacks = {
      onStart: () => {
        if (!active() || started || ended) return;
        started = true;
        clearTimeout(this.timer); this.timer = undefined;
        this.publish({ status: "playing" });
        this.pending?.resolve(); this.pending = undefined;
        this.prefetch(token, voice);
      },
      onEnd: () => {
        if (!active() || ended) return;
        ended = true;
        // Some speech engines omit start for empty/unsupported utterances.
        if (!started) { this.fail(new AppError("reader/playback-failed", "Audio ended without starting")); return; }
        this.publish({ status: "advancing" });
        const advance = new AbortController(); this.advance = advance;
        this.timer = setTimeout(() => { if (active()) this.fail(new AppError("reader/timeout", "No next reading unit arrived")); }, this.advanceDeadlineMs);
        void (async () => {
          try {
            const outcome = await this.input.next(advance.signal);
            if (!active() || advance.signal.aborted) return;
            this.advance = undefined;
            if (outcome === "end-of-book") { this.stop(); return; }
            if (outcome !== "moved" || !this.input.unit?.text || this.input.unit.cfiRange === unit.cfiRange) {
              throw new AppError("reader/target-not-found", "Unit advance did not produce a new passage");
            }
            this.speakCurrent();
          } catch (error) { if (active()) this.fail(error); }
        })();
      },
      onError: error => { if (active()) this.fail(new AppError("reader/playback-failed", "Audio playback failed", { cause: error })); },
    };
    const system = (fallback: boolean) => {
      if (!active()) return;
      this.publish({ backend: "system", fallback });
      try { this.handle = this.deps.speak(unit.text, callbacks); }
      catch (error) { callbacks.onError(error); }
    };
    if (!voice) { system(false); return; }
    const fallback = (error: unknown) => {
      if (!active()) return;
      this.deps.report(error);
      this.handle?.cancel(); this.handle = null;
      if (this.deps.systemAvailable()) system(true);
      else callbacks.onError(error);
    };
    void (async () => {
      try {
        const cached = this.cache;
        this.cache = undefined;
        const bytes = cached?.voice === voice && cached.text === unit.text ? cached.bytes : await voice.synthesize(unit.text);
        if (!active()) return;
        this.handle = this.deps.play(bytes, { ...callbacks, onError: fallback });
      } catch (error) { fallback(error); }
    })();
  }

  private prefetch(token: number, voice: PlaybackVoice | null): void {
    if (!voice) return;
    const text = this.input.peekNext();
    if (!text) return;
    void voice.synthesize(text).then(bytes => {
      if (this.running && token === this.generation && this.input.voice === voice) this.cache = { text, bytes, voice };
    }).catch(error => {
      // Best effort only; the live path retries. Stale work has no state authority.
      if (this.running && token === this.generation) this.deps.report(error);
    });
  }

  private publish(patch: Partial<ReadingPlaybackSnapshot>): void {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch (error) { this.deps.report(error); }
    }
  }
}
