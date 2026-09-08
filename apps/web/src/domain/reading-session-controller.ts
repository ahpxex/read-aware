import { AppError, errorCode, type ReadingLocation, type ReadingNavigationReceipt, type ReadingSessionSnapshot, type ReadingSessionGuard, type ReadingTarget } from "@read-aware/core";

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
    const id = crypto.randomUUID();
    this.userOpening = intent === undefined ? { id, before: this.state.location } : undefined;
    this.session = { id, bookId };
    this.publish({ sessionId: id, bookId, status: "loading", location: null, visibleText: "", errorCode: undefined });
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
    this.publish({ status: "error", errorCode: errorCode(error) ?? "reader/load-failed" });
  }

  closed(): void {
    if (this.state.location && this.cursor >= 0) this.history[this.cursor] = this.state.location;
    this.intent++;
    this.session = undefined;
    this.publish({ status: "idle", sessionId: null, bookId: null, location: null, visibleText: "", errorCode: undefined });
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

  private run(target: ReadingTarget & { bookId: string }, signal?: AbortSignal, historyIndex?: number, direction?: "next" | "previous", guard?: ReadingSessionGuard): Promise<ReadingNavigationReceipt> {
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
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
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
    const work = execute();
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
