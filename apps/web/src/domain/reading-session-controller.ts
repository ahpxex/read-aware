import { AppError, errorCode, type EventOrigin, type ReadingModeConfiguration, type ReadingModeSnapshot, type ReadingModeReceipt, type ReadingPlaybackSnapshot, type ReadingPlaybackReceipt, type ReadingLocation, type ReadingNavigationReceipt, type ReadingSessionSnapshot, type ReadingSessionGuard, type ReadingTarget } from "@read-aware/core";

export type ReadingModeAdapter = {
  generation(): number;
  snapshot(): ReadingModeSnapshot;
  observe(listener: () => void): () => void;
  configure(input: ReadingModeConfiguration, signal?: AbortSignal): Promise<ReadingModeSnapshot>;
  waitForPosition(position: NonNullable<ReadingModeSnapshot["position"]>, signal: AbortSignal): Promise<void>;
  retire(): void;
};
export const unavailableMode = (): ReadingModeSnapshot => ({ status: "unavailable", unavailableReason: "no-session",
  requestedActive: false, modeKey: null, label: null, unitId: null, units: [], progress: null, cfiRange: null, position: null });

export type ReadingPlaybackAdapter = {
  snapshot(): ReadingPlaybackSnapshot;
  observe(listener: () => void): () => void;
  start(owner: EventOrigin, signal?: AbortSignal): Promise<void>;
  stop(): void;
};
export const unavailablePlayback = (): ReadingPlaybackSnapshot => ({
  status: "unavailable", unavailableReason: "no-session", backend: null, fallback: false, owner: null, cfiRange: null,
});

export type ReadingEngineAdapter = {
  navigate(target: ReadingTarget): Promise<ReadingLocation>;
  step(direction: "next" | "previous"): Promise<ReadingLocation>;
};
type Session = { id: string; bookId: string; engine?: ReadingEngineAdapter; error?: unknown };
type Shell = { open(bookId: string, intent: number): void | Promise<void>; close(): void };

/** Owns session identity and completion, never DOM, rendering or persistence. */
export class ReadingSessionController {
  private session: Session | undefined;
  private shell: Shell | undefined;
  private playbackAdapter: { id: string; adapter: ReadingPlaybackAdapter; dispose(): void } | undefined;
  private modeAdapter: { id: string; adapter: ReadingModeAdapter; dispose(): void } | undefined;
  private readonly listeners = new Set<(snapshot: ReadingSessionSnapshot) => unknown>();
  private readonly changes = new Set<() => void>();
  private history: ReadingLocation[] = [];
  private cursor = -1;
  private userOpening: { id: string; before: ReadingLocation | null } | undefined;
  private intent = 0;
  private readonly engineTails = new WeakMap<ReadingEngineAdapter, Promise<unknown>>();
  private state: ReadingSessionSnapshot = {
    revision: 0, sessionId: null, bookId: null, status: "idle", location: null, visibleText: "",
    history: { canGoBack: false, canGoForward: false },
    playback: unavailablePlayback(),
    mode: unavailableMode(),
  };

  constructor(private readonly report: (error: unknown) => void = () => {}, private readonly deadlineMs = 30_000) {}

  snapshot(): ReadingSessionSnapshot { return structuredClone(this.state); }

  observe(handler: (snapshot: ReadingSessionSnapshot) => unknown): () => void {
    this.listeners.add(handler);
    this.deliver(handler);
    return () => this.listeners.delete(handler);
  }

  bindShell(shell: Shell): () => void {
    this.shell = shell;
    return () => { if (this.shell === shell) this.shell = undefined; };
  }

  begin(bookId: string, intent?: number): string {
    if (intent !== undefined && intent !== this.intent) throw new AppError("reader/superseded", "Book opening was replaced");
    if (intent === undefined) this.intent++;
    this.detachPlayback();
    this.detachMode();
    const id = crypto.randomUUID();
    this.userOpening = intent === undefined ? { id, before: this.state.location } : undefined;
    this.session = { id, bookId };
    this.publish({ sessionId: id, bookId, status: "loading", location: null, visibleText: "", errorCode: undefined, playback: unavailablePlayback(), mode: unavailableMode() });
    return id;
  }

  attach(id: string, engine: ReadingEngineAdapter, location: ReadingLocation): () => void {
    if (this.session?.id !== id) return () => {};
    this.session.engine = engine;
    this.session.error = undefined;
    if (this.userOpening?.id === id) {
      this.recordJump(this.userOpening.before, location);
      this.userOpening = undefined;
    }
    this.publish({ status: "ready", location, errorCode: undefined });
    return () => {
      if (this.session?.id !== id || this.session.engine !== engine) return;
      this.session.engine = undefined;
      this.publish({ status: "loading" });
    };
  }

  relocate(id: string, location: ReadingLocation, visibleText: string): void {
    if (this.session?.id === id) this.publish({ location, visibleText: visibleText.slice(0, 12_000) });
  }

  fail(id: string, error: unknown): void {
    if (this.session?.id !== id) return;
    this.session.error = error;
    this.detachPlayback();
    this.detachMode();
    this.publish({ status: "error", errorCode: errorCode(error) ?? "reader/load-failed", playback: unavailablePlayback(), mode: unavailableMode() });
  }

  closed(): void {
    if (this.state.location && this.cursor >= 0) this.history[this.cursor] = this.state.location;
    this.intent++;
    this.detachPlayback();
    this.detachMode();
    this.session = undefined;
    this.publish({ status: "idle", sessionId: null, bookId: null, location: null, visibleText: "", errorCode: undefined, playback: unavailablePlayback(), mode: unavailableMode() });
  }

  bindMode(id: string, adapter: ReadingModeAdapter): () => void {
    if (this.session?.id !== id) return () => {};
    this.detachMode();
    const binding = { id, adapter, dispose: () => {} };
    this.modeAdapter = binding;
    binding.dispose = adapter.observe(() => {
      if (this.modeAdapter === binding && this.session?.id === id) this.publish({ mode: adapter.snapshot() });
    });
    this.publish({ mode: adapter.snapshot() });
    return () => {
      if (this.modeAdapter !== binding) return;
      this.detachMode();
      this.publish({ mode: unavailableMode() });
    };
  }

  async configureMode(input: ReadingModeConfiguration, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingModeReceipt> {
    if (signal?.aborted) throw signal.reason;
    this.checkGuard(guard);
    const binding = this.modeAdapter;
    if (!binding || this.session?.id !== binding.id || this.state.status !== "ready") throw new AppError("reader/unavailable", "Reading mode is not attached to a ready reader");
    const mode = await binding.adapter.configure(input, signal);
    this.checkGuard(guard);
    if (this.modeAdapter !== binding) throw new AppError("reader/superseded", "Reading mode session was replaced");
    return { status: "completed", sessionId: binding.id, mode: structuredClone(mode) };
  }

  private detachMode(): void {
    const binding = this.modeAdapter;
    this.modeAdapter = undefined;
    binding?.dispose(); binding?.adapter.retire();
  }

  returnToMode(signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    try { this.checkGuard(guard); } catch (error) { return Promise.reject(error); }
    const mode = this.state.mode;
    const position = mode.position;
    const binding = this.modeAdapter;
    if (!binding || !mode.requestedActive || !position || position.location.bookId !== this.session?.bookId
      || position.modeKey !== mode.modeKey || position.unitId !== mode.unitId) {
      return Promise.reject(new AppError("reader/unavailable", "There is no current mode position to return to"));
    }
    const generation = binding.adapter.generation();
    const abort = new AbortController();
    const cancel = () => abort.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const unobserve = binding.adapter.observe(() => {
      if (binding.adapter.generation() !== generation) abort.abort(new AppError("reader/superseded", "Reading mode changed during return"));
    });
    return this.run(position.location, abort.signal, undefined, undefined, guard,
      signal => binding.adapter.waitForPosition(position, signal)).finally(() => {
      unobserve(); signal?.removeEventListener("abort", cancel);
    });
  }

  bindPlayback(id: string, adapter: ReadingPlaybackAdapter): () => void {
    if (this.session?.id !== id) return () => {};
    this.detachPlayback();
    const binding = { id, adapter, dispose: () => {} };
    this.playbackAdapter = binding;
    binding.dispose = adapter.observe(() => {
      if (this.playbackAdapter === binding && this.session?.id === id) this.publish({ playback: adapter.snapshot() });
    });
    this.publish({ playback: adapter.snapshot() });
    return () => {
      if (this.playbackAdapter !== binding) return;
      this.detachPlayback();
      this.publish({ playback: unavailablePlayback() });
    };
  }

  async controlPlayback(action: "start" | "stop", owner: EventOrigin, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingPlaybackReceipt> {
    if (signal?.aborted) throw signal.reason;
    this.checkGuard(guard);
    if (action !== "start" && action !== "stop") throw new AppError("reader/invalid-target", "Invalid playback action");
    const binding = this.playbackAdapter;
    if (!binding || this.session?.id !== binding.id || this.state.status !== "ready") throw new AppError("reader/unavailable", "Read aloud is not attached to a ready reader");
    if (action === "start") await binding.adapter.start(owner, signal);
    else binding.adapter.stop();
    this.checkGuard(guard);
    if (this.playbackAdapter !== binding) throw new AppError("reader/superseded", "Playback session was replaced");
    return { status: "completed", sessionId: binding.id, playback: structuredClone(binding.adapter.snapshot()) };
  }

  private detachPlayback(): void {
    const binding = this.playbackAdapter;
    this.playbackAdapter = undefined;
    binding?.dispose();
    binding?.adapter.stop();
  }

  close(signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    try { this.checkGuard(guard); } catch (error) { return Promise.reject(error); }
    if (!this.session) return Promise.resolve();
    if (!this.shell) return Promise.reject(new AppError("reader/unavailable", "Reader shell is not mounted"));
    const session = this.session;
    this.intent++;
    for (const notify of [...this.changes]) notify();
    return new Promise((resolve, reject) => {
      const finish = () => {
        if (signal?.aborted) { cleanup(); reject(signal.reason); }
        else if (!this.session) { cleanup(); resolve(); }
        else if (this.session !== session) { cleanup(); reject(new AppError("reader/superseded", "A new book opened before close completed")); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new AppError("reader/timeout", "Reader did not close")); }, this.deadlineMs);
      const cleanup = () => { clearTimeout(timer); this.changes.delete(finish); signal?.removeEventListener("abort", finish); };
      this.changes.add(finish); signal?.addEventListener("abort", finish, { once: true });
      try { this.shell!.close(); finish(); } catch (error) { cleanup(); reject(error); }
    });
  }

  navigate(target: ReadingTarget, signal?: AbortSignal): Promise<ReadingNavigationReceipt> {
    const validString = (value: unknown, max = 8192) => value === undefined || typeof value === "string" && value.length > 0 && value.length <= max;
    if (!target || typeof target !== "object" || !validString(target.bookId) || !validString(target.cfi)
      || !validString(target.href) || !validString(target.contentVersion, 256)) {
      return Promise.reject(new AppError("reader/invalid-target", "Reading target fields are invalid"));
    }
    if (target.textQuote !== undefined && (!target.textQuote || typeof target.textQuote !== "object"
      || !target.contentVersion || !(target.cfi || target.href) || typeof target.textQuote.exact !== "string"
      || !target.textQuote.exact.trim() || target.textQuote.exact.length > 8192
      || [target.textQuote.prefix, target.textQuote.suffix].some(value => value !== undefined && (typeof value !== "string" || value.length > 8192)))) {
      return Promise.reject(new AppError("reader/invalid-target", "Text quote requires a versioned section and bounded text"));
    }
    const bookId = target.bookId ?? this.session?.bookId;
    if (!bookId) return Promise.reject(new AppError("reader/no-session", "No active reading session"));
    if (target.fraction !== undefined && (!Number.isFinite(target.fraction) || target.fraction < 0 || target.fraction > 1)) {
      return Promise.reject(new AppError("reader/invalid-target", "Reading fraction must be between zero and one"));
    }
    return this.run({ ...target, bookId }, signal);
  }

  back(signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    if (this.cursor <= 0) return Promise.reject(new AppError("reader/no-history", "No previous reading location"));
    return this.run(this.history[this.cursor - 1], signal, this.cursor - 1, undefined, guard);
  }

  forward(signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    if (this.cursor < 0 || this.cursor >= this.history.length - 1) return Promise.reject(new AppError("reader/no-history", "No next reading location"));
    return this.run(this.history[this.cursor + 1], signal, this.cursor + 1, undefined, guard);
  }

  step(direction: "next" | "previous", signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    if (direction !== "next" && direction !== "previous") return Promise.reject(new AppError("reader/invalid-target", "Invalid page direction"));
    const bookId = this.session?.bookId;
    if (!bookId) return Promise.reject(new AppError("reader/no-session", "No active reading session"));
    return this.run({ bookId }, signal, undefined, direction, guard);
  }

  private checkGuard(guard?: ReadingSessionGuard): void {
    if (guard?.bookId !== undefined && guard.bookId !== this.session?.bookId
      || guard?.sessionId !== undefined && guard.sessionId !== this.session?.id) {
      throw new AppError("reader/superseded", "Reading session no longer matches the command's scope");
    }
  }

  private run(target: ReadingTarget & { bookId: string }, signal?: AbortSignal, historyIndex?: number, direction?: "next" | "previous", guard?: ReadingSessionGuard,
    settle?: (signal: AbortSignal) => Promise<void>): Promise<ReadingNavigationReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    try {
      this.checkGuard(guard);
      if (guard?.bookId && guard.bookId !== target.bookId) throw new AppError("reader/out-of-scope", "History target is outside this book scope");
    } catch (error) { return Promise.reject(error); }
    const intent = ++this.intent;
    for (const notify of [...this.changes]) notify();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new AppError("reader/timeout", "Reading navigation timed out")), this.deadlineMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); this.changes.delete(superseded); };
    controller.signal.addEventListener("abort", cleanup, { once: true });
    const before = this.state.location;
    const check = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (intent !== this.intent) throw new AppError("reader/superseded", "A newer reading intent replaced this navigation");
    };
    const execute = async (): Promise<ReadingNavigationReceipt> => {
      check();
      this.checkGuard(guard);
      if (this.session?.bookId !== target.bookId) {
        if (!this.shell) throw new AppError("reader/unavailable", "Reader shell is not mounted");
        await this.shell.open(target.bookId, intent);
      }
      check();
      const session = this.session;
      if (!session || session.bookId !== target.bookId) throw new AppError("reader/superseded", "Reader did not accept this book");
      await this.waitReady(session, check, controller.signal);
      check();
      if (target.contentVersion && target.contentVersion !== this.state.location?.contentVersion) {
        throw new AppError("reader/stale-location", "Reading location belongs to another content revision");
      }
      const engine = session.engine!;
      // Serialize only calls that share a renderer. A hung/disposed old engine
      // must not prevent another book from opening on a fresh engine.
      const movement = (this.engineTails.get(engine) ?? Promise.resolve()).then(async () => {
        check();
        if (this.session !== session || session.engine !== engine) throw new AppError("reader/superseded", "Reader engine was replaced");
        return direction ? engine.step(direction)
          : target.cfi || target.href || target.fraction !== undefined ? engine.navigate(target)
          : this.state.location;
      });
      this.engineTails.set(engine, movement.catch(() => {}));
      const location = await movement;
      check();
      if (this.session !== session || session.engine !== engine) throw new AppError("reader/superseded", "Reader engine was replaced");
      if (!location) throw new AppError("reader/unavailable", "Reader has not reported a location");
      if (settle) await settle(controller.signal);
      check();
      if (this.session !== session || session.engine !== engine) throw new AppError("reader/superseded", "Reader engine was replaced");
      if (historyIndex !== undefined) {
        if (before && this.cursor >= 0) this.history[this.cursor] = before;
        this.cursor = historyIndex;
        this.history[this.cursor] = location;
      } else if (!direction) {
        this.recordJump(before, location);
      }
      this.publish({ location });
      return { status: "completed", sessionId: session.id, location: structuredClone(location) };
    };
    const superseded = () => {
      if (intent !== this.intent) controller.abort(new AppError("reader/superseded", "A newer reading intent replaced this navigation"));
    };
    this.changes.add(superseded);
    const work = execute().finally(() => this.changes.delete(superseded));
    void work.then(cleanup, cleanup);
    return this.withCancellation(work, controller.signal);
  }

  private sameLocation(a: ReadingLocation, b: ReadingLocation): boolean {
    if (a.bookId !== b.bookId || a.contentVersion !== b.contentVersion) return false;
    if (a.cfi || b.cfi) return a.cfi === b.cfi;
    return a.href === b.href && a.fraction === b.fraction;
  }

  private recordJump(before: ReadingLocation | null, location: ReadingLocation): void {
    if (before && this.cursor < 0) { this.history.push(before); this.cursor = 0; }
    else if (before && this.cursor >= 0) this.history[this.cursor] = before;
    if (!before || !this.sameLocation(before, location)) {
      this.history.splice(this.cursor + 1);
      this.history.push(location);
      this.cursor = this.history.length - 1;
      if (this.history.length > 100) { this.history.shift(); this.cursor--; }
    }
  }

  private waitReady(session: Session, check: () => void, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const poll = () => {
        try {
          check();
          if (this.session !== session) throw new AppError("reader/superseded", "Reading session changed while opening");
          if (session.error) throw session.error;
          if (!session.engine) return;
          cleanup(); resolve();
        } catch (error) { cleanup(); reject(error); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new AppError("reader/timeout", "Reader did not become ready")); }, this.deadlineMs);
      const cleanup = () => { clearTimeout(timer); this.changes.delete(poll); signal?.removeEventListener("abort", poll); };
      this.changes.add(poll); signal?.addEventListener("abort", poll, { once: true }); poll();
    });
  }

  private withCancellation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private deliver(handler: (snapshot: ReadingSessionSnapshot) => unknown): void {
    try { void Promise.resolve(handler(this.snapshot())).catch(this.report); } catch (error) { this.report(error); }
  }

  private publish(patch: Partial<ReadingSessionSnapshot>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1,
      history: { canGoBack: this.cursor > 0, canGoForward: this.cursor >= 0 && this.cursor < this.history.length - 1 } };
    for (const listener of [...this.listeners]) this.deliver(listener);
    for (const notify of [...this.changes]) notify();
  }
}
