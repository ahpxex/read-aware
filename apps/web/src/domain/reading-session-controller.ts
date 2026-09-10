import { AppError, errorCode, type EventOrigin, type ReadingModeConfiguration, type ReadingModeSnapshot, type ReadingModeReceipt, type ReadingPlaybackSnapshot, type ReadingPlaybackReceipt, type ReadingLocation, type ReadingNavigationReceipt, type ReadingSessionSnapshot, type ReadingSessionGuard, type ReadingTarget } from "@read-aware/core";
import type { ReadingModeStepOutcome, ReadingModeStepReceipt, ReadingStep, ReadingPaginationSnapshot } from "@read-aware/core";
import type { ReadingControlsSnapshot, ReadingControlsReceipt } from "@read-aware/core";
import { normalizeBookRangeQuery, type BookTextRange, type ReadingSelectionSnapshot, type ReadingSelectionReceipt } from "@read-aware/core";

export type ReadingSelectionAdapter = {
  validate(range: BookTextRange, signal: AbortSignal): Promise<void>;
  select(range: BookTextRange, expectedId: string | null, signal: AbortSignal): Promise<ReadingSelectionSnapshot>;
  clear(expectedId: string, signal?: AbortSignal): Promise<void>;
  retire(): void;
};

export type ReadingControlsAdapter = {
  snapshot(): ReadingControlsSnapshot;
  observe(listener: () => void): () => void;
  setVisible(visible: boolean, signal?: AbortSignal): Promise<ReadingControlsSnapshot>;
  retire(): void;
};

export type ReadingModeAdapter = {
  generation(): number;
  snapshot(): ReadingModeSnapshot;
  observe(listener: () => void): () => void;
  configure(input: ReadingModeConfiguration, signal?: AbortSignal): Promise<ReadingModeSnapshot>;
  waitForPosition(position: NonNullable<ReadingModeSnapshot["position"]>, signal: AbortSignal): Promise<void>;
  step(direction: -1 | 1, signal: AbortSignal): Promise<ReadingModeStepOutcome>;
  retire(): void;
};
export const unavailableMode = (): ReadingModeSnapshot => ({ status: "unavailable", unavailableReason: "no-session",
  requestedActive: false, availableModes: [], modeKey: null, label: null, unitId: null, units: [], progress: null, cfiRange: null, position: null });

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
  step(direction: ReadingStep): Promise<ReadingLocation>;
  pagination?(): ReadingPaginationSnapshot | null;
};
const paginationOf = (engine?: ReadingEngineAdapter): ReadingPaginationSnapshot | null => structuredClone(engine?.pagination?.() ?? null);
type Session = { id: string; bookId: string; engine?: ReadingEngineAdapter; error?: unknown };
type Shell = { open(bookId: string, intent: number, options?: { resetPosition: true }): void | Promise<void>; close(): void | Promise<void> };

/** Owns session identity and completion, never DOM, rendering or persistence. */
export class ReadingSessionController {
  private session: Session | undefined;
  private shell: Shell | undefined;
  private playbackAdapter: { id: string; adapter: ReadingPlaybackAdapter; dispose(): void } | undefined;
  private modeAdapter: { id: string; adapter: ReadingModeAdapter; dispose(): void } | undefined;
  private controlsAdapter: { id: string; adapter: ReadingControlsAdapter; dispose(): void } | undefined;
  private selectionAdapter: { id: string; adapter: ReadingSelectionAdapter } | undefined;
  private readonly listeners = new Set<(snapshot: ReadingSessionSnapshot) => unknown>();
  private readonly changes = new Set<() => void>();
  private history: ReadingLocation[] = [];
  private cursor = -1;
  private userOpening: { id: string; before: ReadingLocation | null } | undefined;
  private intent = 0;
  private openingIntent: number | null = null;

  get hasPendingOpening(): boolean { return this.openingIntent === this.intent; }
  private readonly engineTails = new WeakMap<ReadingEngineAdapter, Promise<unknown>>();
  private state: ReadingSessionSnapshot = {
    revision: 0, sessionId: null, bookId: null, status: "idle", location: null, visibleText: "",
    history: { canGoBack: false, canGoForward: false },
    playback: unavailablePlayback(),
    mode: unavailableMode(),
    controls: null, selection: null, pagination: null,
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
    this.detachControls();
    this.detachSelection();
    const id = crypto.randomUUID();
    this.userOpening = intent === undefined ? { id, before: this.state.location } : undefined;
    this.session = { id, bookId };
    this.publish({ sessionId: id, bookId, status: "loading", location: null, visibleText: "", selection: null, errorCode: undefined, playback: unavailablePlayback(), mode: unavailableMode(), controls: null, pagination: null });
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
    this.publish({ status: "ready", location, errorCode: undefined, pagination: paginationOf(engine) });
    return () => {
      if (this.session?.id !== id || this.session.engine !== engine) return;
      this.session.engine = undefined;
      this.publish({ status: "loading", selection: null, pagination: null });
    };
  }

  relocate(id: string, location: ReadingLocation, visibleText: string, source?: ReadingEngineAdapter): void {
    if (this.session?.id !== id || source && (this.session.engine !== source || this.state.status !== "ready")) return;
    this.publish({ location, visibleText: visibleText.slice(0, 12_000), selection: null,
      pagination: this.state.status === "ready" ? paginationOf(this.session.engine) : null });
  }

  /** Host-only feedback from the attached reader. Stale renderers cannot publish. */
  selectionChanged(id: string, selection: ReadingSelectionSnapshot | null): void {
    if (this.session?.id !== id || this.state.status !== "ready") return;
    if (selection?.range && (selection.range.bookId !== this.session.bookId
      || selection.range.contentVersion !== this.state.location?.contentVersion)) return;
    if (!selection && !this.state.selection) return;
    this.publish({ selection: selection ? structuredClone(selection) : null });
  }

  bindSelection(id: string, adapter: ReadingSelectionAdapter): () => void {
    if (this.session?.id !== id) return () => {};
    this.detachSelection();
    const binding = { id, adapter }; this.selectionAdapter = binding;
    this.publish({ selection: null });
    return () => {
      if (this.selectionAdapter !== binding) return;
      this.detachSelection(); this.publish({ selection: null });
    };
  }

  private detachSelection(): void {
    const binding = this.selectionAdapter; this.selectionAdapter = undefined;
    binding?.adapter.retire();
  }

  async selectRange(input: BookTextRange, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingSelectionReceipt> {
    const range = normalizeBookRangeQuery({ range: input }).range;
    signal?.throwIfAborted(); this.checkGuard(guard);
    const binding = this.selectionAdapter;
    if (!binding || this.state.status !== "ready" || this.session?.id !== binding.id) throw new AppError("reader/unavailable", "Selection requires a ready reader");
    if (range.bookId !== this.session.bookId) throw new AppError("reader/out-of-scope", "Open the target book before selecting a passage");
    const initial = this.state.selection?.id ?? null;
    let phase: "preparing" | "navigating" | "applying" = "preparing";
    const abort = new AbortController(), cancel = () => abort.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const off = this.observe(snapshot => {
      const selected = snapshot.selection?.id ?? null;
      if (this.selectionAdapter !== binding || (phase === "preparing" && selected !== initial)
        || (phase === "navigating" && selected !== null && selected !== initial)) {
        abort.abort(new AppError("reader/superseded", "Selection intent was replaced"));
      }
    });
    let selected: ReadingSelectionSnapshot | undefined;
    try {
      await this.run(range, abort.signal, undefined, undefined, { bookId: range.bookId, sessionId: binding.id }, async signal => {
        signal.throwIfAborted();
        if (this.selectionAdapter !== binding) throw new AppError("reader/superseded", "Selection adapter changed");
        phase = "applying";
        selected = await binding.adapter.select(range, this.state.selection?.id ?? null, signal);
        if (this.state.selection?.id !== selected.id) throw new AppError("reader/superseded", "A newer selection replaced the applied range");
      }, undefined, async signal => {
        await binding.adapter.validate(range, signal);
        signal.throwIfAborted(); phase = "navigating";
      });
      if (!selected) throw new AppError("reader/unavailable", "No committed selection");
      return { status: "completed", sessionId: binding.id, selection: structuredClone(selected) };
    } finally { off(); signal?.removeEventListener("abort", cancel); }
  }

  async clearSelection(expectedId: string, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingSelectionReceipt> {
    signal?.throwIfAborted(); this.checkGuard(guard);
    if (typeof expectedId !== "string" || !expectedId.trim() || expectedId.length > 256) throw new AppError("reader/invalid-target", "An observed selection ID is required");
    const binding = this.selectionAdapter;
    if (!binding || this.state.status !== "ready" || this.session?.id !== binding.id) throw new AppError("reader/unavailable", "Selection requires a ready reader");
    if (this.state.selection?.id !== expectedId) throw new AppError("reader/superseded", "Selection changed before clearing");
    await binding.adapter.clear(expectedId, signal);
    signal?.throwIfAborted(); this.checkGuard(guard);
    if (this.selectionAdapter !== binding || this.state.selection) throw new AppError("reader/superseded", "Selection changed while clearing");
    return { status: "completed", sessionId: binding.id, selection: null };
  }

  fail(id: string, error: unknown): void {
    if (this.session?.id !== id) return;
    this.session.error = error;
    this.detachPlayback();
    this.detachMode();
    this.detachControls();
    this.detachSelection();
    this.publish({ status: "error", selection: null, errorCode: errorCode(error) ?? "reader/load-failed", playback: unavailablePlayback(), mode: unavailableMode(), controls: null, pagination: null });
  }

  closed(): void {
    if (this.state.location && this.cursor >= 0) this.history[this.cursor] = this.state.location;
    this.intent++;
    this.detachPlayback();
    this.detachMode();
    this.session = undefined;
    this.detachControls();
    this.detachSelection();
    this.publish({ status: "idle", sessionId: null, bookId: null, location: null, visibleText: "", selection: null, errorCode: undefined, playback: unavailablePlayback(), mode: unavailableMode(), controls: null, pagination: null });
  }

  bindControls(id: string, adapter: ReadingControlsAdapter): () => void {
    if (this.session?.id !== id) return () => {};
    this.detachControls();
    const binding = { id, adapter, dispose: () => {} };
    this.controlsAdapter = binding;
    binding.dispose = adapter.observe(() => {
      if (this.controlsAdapter === binding && this.session?.id === id) this.publish({ controls: adapter.snapshot() });
    });
    this.publish({ controls: adapter.snapshot() });
    return () => {
      if (this.controlsAdapter !== binding) return;
      this.detachControls(); this.publish({ controls: null });
    };
  }

  async setControls(visible: boolean, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingControlsReceipt> {
    if (signal?.aborted) throw signal.reason;
    this.checkGuard(guard);
    if (typeof visible !== "boolean") throw new AppError("reader/invalid-target", "Controls visibility must be boolean");
    const binding = this.controlsAdapter;
    if (!binding || this.session?.id !== binding.id || this.state.status !== "ready") throw new AppError("reader/unavailable", "Controls require a ready reader");
    const controls = await binding.adapter.setVisible(visible, signal);
    if (signal?.aborted) throw signal.reason;
    this.checkGuard(guard);
    if (this.controlsAdapter !== binding) throw new AppError("reader/superseded", "Reader controls session was replaced");
    return { status: "completed", sessionId: binding.id, controls };
  }

  private detachControls(): void {
    const binding = this.controlsAdapter;
    this.controlsAdapter = undefined;
    binding?.dispose(); binding?.adapter.retire();
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

  async stepMode(direction: "next" | "previous", signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingModeStepReceipt> {
    if (signal?.aborted) throw signal.reason;
    this.checkGuard(guard);
    if (direction !== "next" && direction !== "previous") throw new AppError("reader/invalid-target", "Invalid unit direction");
    const binding = this.modeAdapter;
    const bookId = this.session?.bookId;
    if (!binding || !bookId || !this.state.mode.requestedActive || this.state.status !== "ready") throw new AppError("reader/unavailable", "Reading mode is not active in a ready reader");
    const generation = binding.adapter.generation();
    const abort = new AbortController();
    const cancel = () => abort.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const unobserve = this.observe(() => {
      if (this.modeAdapter !== binding || binding.adapter.generation() !== generation) abort.abort(new AppError("reader/superseded", "Reading mode changed during stepping"));
    });
    let outcome: ReadingModeStepOutcome | undefined;
    try {
      const receipt = await this.run({ bookId }, abort.signal, undefined, undefined, guard, undefined, async signal => {
        outcome = await binding.adapter.step(direction === "next" ? 1 : -1, signal);
      });
      if (!outcome) throw new AppError("reader/unavailable", "Reading mode returned no step outcome");
      return { status: "completed", sessionId: receipt.sessionId, outcome, mode: structuredClone(binding.adapter.snapshot()) };
    } finally { unobserve(); signal?.removeEventListener("abort", cancel); }
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
    if (!this.session && !this.hasPendingOpening) return Promise.resolve();
    if (this.session && !this.shell) return Promise.reject(new AppError("reader/unavailable", "Reader shell is not mounted"));
    const session = this.session;
    this.intent++;
    for (const notify of [...this.changes]) notify();
    if (!session) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let shellCompleted = false;
      const finish = () => {
        if (signal?.aborted) { cleanup(); reject(signal.reason); }
        else if (!this.session && shellCompleted) { cleanup(); resolve(); }
        else if (this.session && this.session !== session) { cleanup(); reject(new AppError("reader/superseded", "A new book opened before close completed")); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new AppError("reader/timeout", "Reader did not close")); }, this.deadlineMs);
      const cleanup = () => { clearTimeout(timer); this.changes.delete(finish); signal?.removeEventListener("abort", finish); };
      this.changes.add(finish); signal?.addEventListener("abort", finish, { once: true });
      try {
        Promise.resolve(this.shell!.close()).then(() => {
          shellCompleted = true;
          finish();
        }, error => { cleanup(); reject(error); });
      } catch (error) { cleanup(); reject(error); }
    });
  }

  navigate(target: ReadingTarget, signal?: AbortSignal): Promise<ReadingNavigationReceipt> {
    const validString = (value: unknown, max = 8192) => value === undefined || typeof value === "string" && value.length > 0 && value.length <= max;
    if (!target || typeof target !== "object" || !validString(target.bookId) || !validString(target.cfi)
      || !validString(target.href) || !validString(target.contentVersion, 256)) {
      return Promise.reject(new AppError("reader/invalid-target", "Reading target fields are invalid"));
    }
    if (target.sectionIndex !== undefined && (!Number.isSafeInteger(target.sectionIndex) || target.sectionIndex < 0
      || !target.contentVersion || target.cfi !== undefined || target.href !== undefined || target.fraction !== undefined || target.textQuote !== undefined)) {
      return Promise.reject(new AppError("reader/invalid-target", "Source section requires a version and no competing locator"));
    }
    if (target.textQuote !== undefined && (!target.textQuote || typeof target.textQuote !== "object"
      || !target.contentVersion || !(target.cfi || target.href) || typeof target.textQuote.exact !== "string"
      || !target.textQuote.exact.trim() || target.textQuote.exact.length > 12000
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

  step(direction: ReadingStep, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    if (!["next", "previous", "next-section", "previous-section", "next-chapter", "previous-chapter", "start", "end"].includes(direction)) return Promise.reject(new AppError("reader/invalid-target", "Invalid navigation step"));
    const bookId = this.session?.bookId;
    if (!bookId) return Promise.reject(new AppError("reader/no-session", "No active reading session"));
    return this.run({ bookId }, signal, undefined, direction, guard);
  }

  reload(signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
    const bookId = this.session?.bookId;
    if (!bookId) return Promise.reject(new AppError("reader/no-session", "No active reading session"));
    return this.run({ bookId }, signal, undefined, "start", guard, undefined, undefined, undefined, true);
  }

  private checkGuard(guard?: ReadingSessionGuard): void {
    if (guard?.bookId !== undefined && guard.bookId !== this.session?.bookId
      || guard?.sessionId !== undefined && guard.sessionId !== this.session?.id) {
      throw new AppError("reader/superseded", "Reading session no longer matches the command's scope");
    }
  }

  private run(target: ReadingTarget & { bookId: string }, signal?: AbortSignal, historyIndex?: number, direction?: ReadingStep, guard?: ReadingSessionGuard,
    settle?: (signal: AbortSignal) => Promise<void>, moveMode?: (signal: AbortSignal) => Promise<void>, prepare?: (signal: AbortSignal) => Promise<void>, reload = false): Promise<ReadingNavigationReceipt> {
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
    controller.signal.addEventListener("abort", () => {
      // A shell lookup may ignore cancellation. Revoke its begin() token too,
      // otherwise a rejected request could still open a book after retirement.
      if (intent === this.intent) {
        this.intent++;
        for (const notify of [...this.changes]) notify();
      }
      cleanup();
    }, { once: true });
    const before = this.state.location;
    const previousSession = this.session;
    const check = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (intent !== this.intent) throw new AppError("reader/superseded", "A newer reading intent replaced this navigation");
    };
    const execute = async (): Promise<ReadingNavigationReceipt> => {
      check();
      this.checkGuard(guard);
      if (prepare) { await prepare(controller.signal); check(); this.checkGuard(guard); }
      if (reload || this.session?.bookId !== target.bookId) {
        if (!this.shell) throw new AppError("reader/unavailable", "Reader shell is not mounted");
        this.openingIntent = intent;
        try { await this.shell.open(target.bookId, intent, reload ? { resetPosition: true } : undefined); }
        finally { if (this.openingIntent === intent) this.openingIntent = null; }
      }
      check();
      const session = this.session;
      if (!session || session.bookId !== target.bookId) throw new AppError("reader/superseded", "Reader did not accept this book");
      if (reload && session === previousSession) throw new AppError("reader/unavailable", "Reader did not reopen its content source");
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
        if (moveMode) { await moveMode(controller.signal); return this.state.location; }
        return direction ? engine.step(direction)
          : target.cfi || target.href || target.fraction !== undefined || target.sectionIndex !== undefined ? engine.navigate(target)
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
      } else if (direction !== "next" && direction !== "previous" && !moveMode) {
        this.recordJump(before, location);
      }
      this.publish({ location, pagination: paginationOf(engine) });
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
