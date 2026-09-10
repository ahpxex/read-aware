import { AppError, normalizeReadingEmphasisRef, normalizeReadingEmphasisWrite, type BookTextRange,
  type ReadingEmphasisWrite, type ReadingEmphasisRef, type ReadingEmphasisSnapshot, type ReadingEmphasisStyle,
  type ReadingEmphasisReceipt, type ReadingEmphasisRemoval, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "./reading-session-controller";

export type EmphasisPresentation = Pick<ReadingEmphasisSnapshot, "attached" | "status" | "errorCode">;
export type ReadingEmphasisAdapter = {
  validate(ranges: BookTextRange[], signal: AbortSignal): Promise<void>;
  put(id: string, ranges: BookTextRange[], style: ReadingEmphasisStyle): EmphasisPresentation;
  remove(id: string): void;
  observe(handler: (id: string, state: EmphasisPresentation) => void): () => void;
  retire(): void;
};
type Binding = { sessionId: string; bookId: string; contentVersion: string; adapter: ReadingEmphasisAdapter; dispose(): void };
type Entry = { owner: object; ranges: BookTextRange[]; snapshot: ReadingEmphasisSnapshot };
type Pending = { owner: object; id: string; controller: AbortController };

/** Owns session-limited visual resources, never annotations or reading navigation. */
export class ReadingEmphasisController {
  private binding?: Binding;
  private entries = new Map<string, Entry>();
  private pending = new Set<Pending>();
  private observers = new Map<object, Set<(value: ReadingEmphasisSnapshot[]) => unknown>>();
  private revision = 0;
  constructor(private readonly reading: Pick<ReadingSessionController, "snapshot" | "observe">,
    private readonly report: (error: unknown) => void, private readonly deadlineMs = 30000) {}

  bind(sessionId: string, bookId: string, contentVersion: string, adapter: ReadingEmphasisAdapter): () => void {
    this.binding?.dispose();
    this.checkGuard({ sessionId, bookId });
    const binding: Binding = { sessionId, bookId, contentVersion, adapter, dispose: () => {} };
    this.binding = binding;
    let unobserve = () => {}, unpaint = () => {};
    const dispose = () => {
      if (this.binding !== binding) return;
      this.binding = undefined; unobserve(); unpaint();
      for (const work of this.pending) work.controller.abort(new AppError("reader/superseded", "Emphasis renderer retired"));
      const owners = new Set([...this.entries.values()].map(entry => entry.owner));
      this.entries.clear(); adapter.retire();
      for (const owner of owners) this.changed(owner);
    };
    binding.dispose = dispose;
    unobserve = this.reading.observe(state => {
      if (state.sessionId !== sessionId || state.status !== "ready" || state.location?.contentVersion !== contentVersion) dispose();
    });
    if (this.binding !== binding) { unobserve(); return dispose; }
    unpaint = adapter.observe((id, presentation) => {
      const entry = this.entries.get(id);
      if (this.binding !== binding || !entry) return;
      entry.snapshot = { ...entry.snapshot, errorCode: undefined, ...presentation };
      this.changed(entry.owner);
    });
    return dispose;
  }

  forOwner(owner: object, lifetime?: AbortSignal, trackCleanup?: (work: Promise<void>) => void) {
    const assertLive = () => lifetime?.throwIfAborted();
    const dispose = () => {
      for (const work of this.pending) if (work.owner === owner) work.controller.abort(lifetime?.reason);
      for (const [id, entry] of this.entries) if (entry.owner === owner) { this.binding?.adapter.remove(id); this.entries.delete(id); }
      this.changed(owner); this.observers.delete(owner);
    };
    lifetime?.addEventListener("abort", dispose, { once: true });
    return {
      list: (): ReadingEmphasisSnapshot[] => { assertLive(); return this.list(owner); },
      observe: (handler: (value: ReadingEmphasisSnapshot[]) => unknown) => {
        assertLive(); const set = this.observers.get(owner) ?? new Set(); set.add(handler); this.observers.set(owner, set);
        this.deliver(owner, handler);
        return () => { set.delete(handler); if (!set.size) this.observers.delete(owner); };
      },
      put: (input: ReadingEmphasisWrite, signal?: AbortSignal, guard?: ReadingSessionGuard) => {
        assertLive(); return this.put(owner, input, signal, guard, trackCleanup);
      },
      remove: async (input: ReadingEmphasisRef, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReadingEmphasisRemoval> => {
        assertLive(); signal?.throwIfAborted(); const ref = normalizeReadingEmphasisRef(input);
        const entry = this.owned(owner, ref.id);
        if (!entry) return { status: "completed", id: ref.id, removed: false };
        this.checkGuard(guard);
        if (entry.snapshot.revision !== ref.expectedRevision) throw new AppError("reader/superseded", "Emphasis was replaced");
        for (const work of this.pending) if (work.owner === owner && work.id === ref.id) work.controller.abort(new AppError("reader/superseded", "Emphasis was removed"));
        this.binding!.adapter.remove(ref.id); this.entries.delete(ref.id); this.changed(owner);
        return { status: "completed", id: ref.id, removed: true };
      },
    };
  }

  private async put(owner: object, value: ReadingEmphasisWrite, signal?: AbortSignal, guard?: ReadingSessionGuard,
    trackCleanup?: (work: Promise<void>) => void): Promise<ReadingEmphasisReceipt> {
    signal?.throwIfAborted(); const input = normalizeReadingEmphasisWrite(value); this.checkGuard(guard);
    const binding = this.binding;
    if (!binding) throw new AppError("reader/unavailable", "No emphasis renderer is attached");
    if (input.ranges[0].bookId !== binding.bookId) throw new AppError("reader/out-of-scope", "Open this book before emphasizing it");
    if (input.ranges[0].contentVersion !== binding.contentVersion) throw new AppError("reader/stale-location", "Emphasis belongs to a different source version");
    const previous = input.id ? this.owned(owner, input.id) : undefined;
    if (input.id && (!previous || previous.snapshot.revision !== input.expectedRevision)) throw new AppError("reader/superseded", "Emphasis identity or revision changed");
    const id = input.id ?? crypto.randomUUID();
    if (this.pending.size >= 32) throw new AppError("reader/unavailable", "Too many emphasis validations are still draining");
    const checkLimits = () => {
      const ownCount = [...this.entries.values()].filter(entry => entry.owner === owner).length;
      const count = [...this.entries.values()].reduce((total, entry) => total + entry.ranges.length, 0);
      if ((!previous && ownCount >= 16) || count - (previous?.ranges.length ?? 0) + input.ranges.length > 512) {
        throw new AppError("reader/unavailable", "Release temporary emphasis before adding more ranges");
      }
    };
    checkLimits();
    for (const old of this.pending) if (old.owner === owner && old.id === id) old.controller.abort(new AppError("reader/superseded", "A newer emphasis update replaced this request"));
    const pending: Pending = { owner, id, controller: new AbortController() };
    this.pending.add(pending);
    const abort = () => pending.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => pending.controller.abort(new AppError("reader/timeout", "Emphasis validation timed out")), this.deadlineMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const work = (async (): Promise<ReadingEmphasisReceipt> => {
      await binding.adapter.validate(input.ranges, pending.controller.signal);
      pending.controller.signal.throwIfAborted(); this.checkGuard(guard);
      if (this.binding !== binding || this.owned(owner, id) !== previous) throw new AppError("reader/superseded", "Emphasis target was replaced");
      checkLimits();
      const presentation = binding.adapter.put(id, input.ranges, input.style);
      const snapshot: ReadingEmphasisSnapshot = { id, revision: ++this.revision, sessionId: binding.sessionId,
        bookId: binding.bookId, style: input.style, count: input.ranges.length, ...presentation };
      this.entries.set(id, { owner, ranges: input.ranges, snapshot });
      const receipt: ReadingEmphasisReceipt = { status: "completed", emphasis: structuredClone(snapshot) };
      this.changed(owner); return receipt;
    })();
    // A cancelled RPC may finish before native reads. Keep their physical lifetime
    // tracked so plugin retirement cannot declare drained while a source is leased.
    const draining = work.then(() => {}, error => {
      if (!pending.controller.signal.aborted) return;
      if (error !== pending.controller.signal.reason && !(error instanceof Error && error.name === "AbortError")) throw error;
    }).finally(() => { this.pending.delete(pending); cleanup(); });
    void draining.catch(this.report);
    trackCleanup?.(draining);
    return new Promise((resolve, reject) => {
      const cancel = () => { cleanup(); reject(pending.controller.signal.reason); };
      pending.controller.signal.addEventListener("abort", cancel, { once: true });
      if (pending.controller.signal.aborted) cancel();
      void work.then(resolve, reject).finally(() => pending.controller.signal.removeEventListener("abort", cancel));
    });
  }
  private owned(owner: object, id: string): Entry | undefined { const entry = this.entries.get(id); return entry?.owner === owner ? entry : undefined; }
  private list(owner: object): ReadingEmphasisSnapshot[] {
    return [...this.entries.values()].filter(entry => entry.owner === owner).map(entry => structuredClone(entry.snapshot));
  }
  private checkGuard(guard?: ReadingSessionGuard): void {
    const state = this.reading.snapshot();
    if (guard !== undefined && (!guard || typeof guard !== "object" || Array.isArray(guard)
      || Object.keys(guard).some(key => key !== "bookId" && key !== "sessionId")
      || guard.bookId !== undefined && typeof guard.bookId !== "string" || guard.sessionId !== undefined && typeof guard.sessionId !== "string")) {
      throw new AppError("reader/invalid-target", "Invalid emphasis session guard");
    }
    if (guard?.bookId !== undefined && guard.bookId !== state.bookId || guard?.sessionId !== undefined && guard.sessionId !== state.sessionId) throw new AppError("reader/superseded", "Emphasis session changed");
    if (state.status !== "ready") throw new AppError("reader/unavailable", "A ready reader is required");
  }
  private changed(owner: object): void { for (const handler of [...this.observers.get(owner) ?? []]) this.deliver(owner, handler); }
  private deliver(owner: object, handler: (value: ReadingEmphasisSnapshot[]) => unknown): void {
    try { Promise.resolve(handler(this.list(owner))).catch(this.report); } catch (error) { this.report(error); }
  }
}
