import { AppError, errorCode, type ReadingModeConfiguration, type ReadingModeSnapshot, type ReadingModePosition, type ReadingModeStepOutcome, type ReadingModeDescriptor } from "@read-aware/core";
import { ReadingModeWrites } from "./reading-mode-writes";
import { ReadingModePositionWrites } from "./reading-mode-position-writes";

export type ModeDescriptor = ReadingModeDescriptor & { implementation?: object };
export type ModeRequest = { revision: number; active: boolean; unitId: string | null; modeKey: string | null };
export type ModeFeedback = { status: "inactive" | "building" | "ready" | "empty" | "error"; errorCode?: string;
  progress: { ordinal: number; total: number } | null; cfiRange: string | null; position?: ReadingModePosition | null };
export type ModeStepResult = { outcome: ReadingModeStepOutcome; feedback: ModeFeedback };
type Pending = { revision: number; before: ModeRequest; resolve(mode: ReadingModeSnapshot): void; reject(error: unknown): void; cleanup(): void };

/** Owns requested mode state and completion. The reader reports the actual indexed state. */
export class ReadingModeController {
  private modes: ModeDescriptor[] = [];
  private get descriptor(): ModeDescriptor | null { return this.modes.find(mode => mode.key === this.request.modeKey) ?? null; }
  private supported = true;
  private request: ModeRequest;
  private result: ReadingModeSnapshot;
  private listeners = new Set<() => void>();
  private pending: Pending | undefined;
  private confirmedRevision = -1;
  private readonly writes = new ReadingModeWrites((revision, error) => this.persistenceFailed(revision, error));
  private readonly positionWrites = new ReadingModePositionWrites();
  private configurationWrite: Promise<void> = Promise.resolve();
  private rollback: ModeRequest | undefined;
  private persistenceTracked = false;
  private settlingRevision: number | undefined;
  private positionWaiter: ((position: ReadingModePosition, signal: AbortSignal) => Promise<ModeFeedback>) | undefined;
  private stepper: ((direction: -1 | 1, signal: AbortSignal) => Promise<ModeStepResult>) | undefined;

  constructor(active = false, unitId: string | null = null, private readonly deadlineMs = 35_000,
    modeKey: string | null = null, private readonly preferredUnit: (key: string) => string | null = () => null) {
    this.request = { revision: 0, active, unitId, modeKey };
    this.result = { status: "unavailable", unavailableReason: "no-provider", requestedActive: active,
      modeKey, label: null, availableModes: [], unitId, units: [], progress: null, cfiRange: null, position: null };
  }

  requested = (): ModeRequest => this.request;
  generation = (): number => this.request.revision;
  snapshot = (): ReadingModeSnapshot => this.result;
  observe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  requireDurability(): void { this.persistenceTracked = true; }
  trackPersistence = (revision: number, write: Promise<void>): void => { this.writes.track(revision, write); };

  trackConfiguration(revision: number, write: Promise<void>): void {
    if (revision === this.request.revision) this.configurationWrite = write;
    this.trackPersistence(revision, write);
  }

  /** A stale render must not dispatch a write, even if it has the latest revision ref. */
  persistPosition = (revision: number, modeKey: string | null, unitId: string | null, write: () => Promise<void>, position: ReadingModePosition | null = null): void => {
    const current = () => revision === this.request.revision && modeKey === this.request.modeKey && unitId === this.request.unitId;
    if (!current()) return;
    const receipt = Promise.resolve().then(async () => {
      if (!current()) return;
      await this.configurationWrite;
      if (current()) await write();
    });
    this.positionWrites.track(revision, position, receipt, () => this.persistPosition(revision, modeKey, unitId, write, position));
    if (this.confirmedRevision !== revision) this.trackPersistence(revision, receipt);
  };

  async reconcilePreference(readUnit: () => string | null): Promise<void> {
    const revision = this.request.revision;
    try { await this.writes.wait(revision); }
    catch { return; } // The write owner reports failure; rollback is not a new user intent.
    if (revision !== this.request.revision) return;
    const unitId = readUnit();
    if (unitId && this.descriptor?.units.some(unit => unit.id === unitId) && this.request.unitId !== unitId) {
      this.choose(this.request.active, unitId);
    }
  }

  bindPositionWaiter(waiter: NonNullable<ReadingModeController["positionWaiter"]>): () => void {
    this.positionWaiter = waiter;
    this.emit();
    return () => { if (this.positionWaiter === waiter) { this.positionWaiter = undefined; this.emit(); } };
  }

  bindStepper(stepper: NonNullable<ReadingModeController["stepper"]>): () => void {
    this.stepper = stepper;
    this.emit();
    return () => { if (this.stepper === stepper) { this.stepper = undefined; this.emit(); } };
  }

  async step(direction: -1 | 1, signal: AbortSignal): Promise<ReadingModeStepOutcome> {
    if (signal.aborted) throw signal.reason;
    const stepper = this.stepper;
    if (!stepper || !this.request.active) throw new AppError("reader/unavailable", "Reading mode stepper is not attached");
    const revision = this.request.revision;
    const retry = this.positionWrites.retryable();
    const result = await stepper(direction, signal);
    const current = () => stepper === this.stepper && revision === this.request.revision;
    await this.waitForFeedback(result.feedback, signal, current);
    if (this.persistenceTracked) await this.positionWrites.wait(revision, result.feedback.position ?? null, signal, retry);
    this.checkFeedback(result.feedback, signal, current);
    return result.outcome;
  }

  async waitForPosition(position: ReadingModePosition, signal: AbortSignal): Promise<void> {
    const waiter = this.positionWaiter;
    if (!waiter) throw new AppError("reader/unavailable", "Reading mode position is not attached");
    const revision = this.request.revision;
    const retry = this.positionWrites.retryable();
    const feedback = await waiter(position, signal);
    const current = () => waiter === this.positionWaiter && revision === this.request.revision;
    await this.waitForFeedback(feedback, signal, current);
    if (this.persistenceTracked) await this.positionWrites.wait(revision, feedback.position ?? null, signal, retry);
    this.checkFeedback(feedback, signal, current);
  }

  private checkFeedback(feedback: ModeFeedback, signal: AbortSignal, current: () => boolean): void {
    if (signal.aborted) throw signal.reason;
    if (!current()) throw new AppError("reader/superseded", "Reading mode changed during movement");
    if (this.result.status === "error") throw new AppError(this.result.errorCode ?? "reader/segmentation-failed", "Reading mode restoration failed");
    if (!this.matchesFeedback(feedback)) throw new AppError("reader/superseded", "Reading mode changed during movement");
  }

  private matchesFeedback(feedback: ModeFeedback): boolean {
    return this.result.status === feedback.status && this.result.cfiRange === feedback.cfiRange
      && this.result.progress?.ordinal === feedback.progress?.ordinal && this.result.progress?.total === feedback.progress?.total;
  }

  private waitForFeedback(feedback: ModeFeedback, signal: AbortSignal, current: () => boolean): Promise<void> {
    // The native index settles before React commits the current-unit consumers
    // (including playback). Do not expose completion with their old snapshot.
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.listeners.delete(check); signal.removeEventListener("abort", check); };
      const check = () => {
        try {
          if (signal.aborted) throw signal.reason;
          if (!current()) throw new AppError("reader/superseded", "Reading mode changed during movement");
          if (this.result.status === "error") throw new AppError(this.result.errorCode ?? "reader/segmentation-failed", "Reading mode restoration failed");
          if (!this.matchesFeedback(feedback)) return;
          cleanup(); resolve();
        } catch (error) { cleanup(); reject(error); }
      };
      this.listeners.add(check); signal.addEventListener("abort", check, { once: true }); check();
    });
  }

  environment(descriptors: ModeDescriptor | ModeDescriptor[] | null, supported: boolean): void {
    const modes = descriptors === null ? [] : Array.isArray(descriptors) ? descriptors : [descriptors];
    const oldDescriptor = this.descriptor;
    if (JSON.stringify(this.modes) === JSON.stringify(modes) && this.supported === supported
      && this.modes.every((mode, i) => mode.implementation === modes[i]?.implementation)) return;
    const wasSupported = this.supported;
    this.modes = modes;
    this.supported = supported;
    // Registering an unrelated provider is discovery, not a new reading intent.
    if (this.request.modeKey && JSON.stringify(oldDescriptor) === JSON.stringify(this.descriptor)
      && oldDescriptor?.implementation === this.descriptor?.implementation && wasSupported === supported) {
      this.result = { ...this.result, availableModes: this.availableModes() }; this.emit(); return;
    }
    const before = this.pending?.before ?? this.rollback ?? this.request;
    this.supersede();
    const modeKey = before.modeKey ?? modes[0]?.key ?? null;
    const descriptor = modes.find(mode => mode.key === modeKey);
    const preferred = descriptor && before.modeKey === null ? this.preferredUnit(descriptor.key) : null;
    const unitId = preferred && descriptor?.units.some(unit => unit.id === preferred) ? preferred
      : descriptor?.units.some(unit => unit.id === before.unitId)
      ? before.unitId : descriptor ? this.defaultUnit(descriptor) : before.unitId;
    this.change(before.active, unitId, modeKey);
  }

  /** Native UI and changes to the mode's declared settings supersede in-flight actor commands. */
  choose(active: boolean, unitId = this.request.unitId): void {
    this.validate({ active, ...(unitId && this.descriptor ? { unitId } : {}) });
    const before = this.pending?.before ?? this.rollback ?? this.request;
    this.supersede();
    this.change(active, unitId, this.request.modeKey, before);
  }

  async configure(input: ReadingModeConfiguration, signal?: AbortSignal): Promise<ReadingModeSnapshot> {
    if (signal?.aborted) throw signal.reason;
    this.validate(input);
    const modeKey = input.selectModeKey ?? this.request.modeKey;
    const descriptor = this.modes.find(mode => mode.key === modeKey);
    const unitId = input.unitId ?? (modeKey === this.request.modeKey ? this.request.unitId : null) ?? (descriptor ? this.defaultUnit(descriptor) : null);
    if (this.confirmedRevision === this.request.revision && this.request.active === input.active && this.request.unitId === unitId
      && this.request.modeKey === modeKey
      && ["inactive", "ready", "empty"].includes(this.result.status)) {
      const revision = this.request.revision;
      if (this.persistenceTracked) {
        const owner = new AbortController();
        const abort = () => owner.abort(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => owner.abort(new AppError("reader/timeout", "Reading mode persistence did not settle")), this.deadlineMs);
        const retry = this.positionWrites.retryable();
        try {
          await this.writes.wait(revision, owner.signal);
          await this.positionWrites.wait(revision, this.result.position, owner.signal, retry);
        }
        finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
      }
      if (signal?.aborted) throw signal.reason;
      if (revision !== this.request.revision) throw new AppError("reader/superseded", "Reading mode changed during persistence");
      return structuredClone(this.result);
    }
    const before = this.pending?.before ?? this.rollback ?? this.request;
    this.supersede();
    const revision = this.request.revision + 1;
    const work = new Promise<ReadingModeSnapshot>((resolve, reject) => {
      const cancel = (reason: unknown) => {
        if (this.pending?.revision !== revision) return;
        this.supersede(reason);
        // Revert only this unfinished request. A newer UI/actor action owns its own state.
        this.change(before.active, before.unitId, before.modeKey);
      };
      const abort = () => cancel(signal?.reason);
      const timer = setTimeout(() => cancel(new AppError("reader/timeout", "Reading mode did not settle")), this.deadlineMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending = { revision, before, resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
    });
    this.change(input.active, unitId, modeKey, before);
    return work;
  }

  feedback(revision: number, modeKey: string | null, unitId: string | null, feedback: ModeFeedback): void {
    if (revision !== this.request.revision || modeKey !== this.descriptor?.key || unitId !== this.request.unitId) return;
    if (!this.supported || !this.descriptor) return;
    if (this.request.active && feedback.status === "inactive" || !this.request.active && feedback.status !== "inactive") return;
    const status = feedback.status === "building" ? "preparing" : feedback.status;
    this.result = { ...this.result, status, errorCode: feedback.errorCode,
      progress: feedback.progress, cfiRange: feedback.cfiRange, position: feedback.position ?? null };
    if (["inactive", "ready", "empty", "error"].includes(status)) {
      this.finish(revision);
    }
    this.emit();
  }

  retire(): boolean {
    const before = this.pending?.before;
    this.supersede();
    if (!before) {
      this.positionWrites.retire();
      this.writes.start(this.request.revision);
      return false;
    }
    this.change(before.active, before.unitId, before.modeKey);
    return true;
  }

  private validate(input: ReadingModeConfiguration): void {
    if (!input || typeof input !== "object" || typeof input.active !== "boolean"
      || input.modeKey !== undefined && typeof input.modeKey !== "string"
      || input.selectModeKey !== undefined && typeof input.selectModeKey !== "string"
      || input.unitId !== undefined && typeof input.unitId !== "string") throw new AppError("reader/invalid-target", "Invalid reading mode configuration");
    if (input.modeKey !== undefined && input.modeKey !== this.request.modeKey) throw new AppError("reader/superseded", "Reading mode provider changed");
    const descriptor = input.selectModeKey === undefined ? this.descriptor : this.modes.find(mode => mode.key === input.selectModeKey);
    if (input.selectModeKey !== undefined && !descriptor) throw new AppError("reader/unavailable", "Requested reading mode is not registered");
    if (input.active && (!this.supported || !descriptor)) throw new AppError("reader/unavailable", "Reading mode is unavailable");
    if (input.unitId !== undefined && !descriptor?.units.some(unit => unit.id === input.unitId)) throw new AppError("reader/invalid-target", "Unknown reading mode unit");
  }

  private supersede(reason: unknown = new AppError("reader/superseded", "Reading mode request was replaced")): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup(); pending?.reject(reason);
  }

  private persistenceFailed(revision: number, error: unknown): void {
    if (revision !== this.request.revision) return;
    const before = this.rollback;
    this.supersede(error);
    if (before) this.change(before.active, before.unitId, before.modeKey);
    else {
      this.result = { ...this.result, status: "error", errorCode: errorCode(error) };
      this.emit();
    }
  }

  private finish(revision: number): void {
    if (this.settlingRevision === revision) return;
    const settle = (failure?: { error: unknown }) => {
      if (this.settlingRevision === revision) this.settlingRevision = undefined;
      if (this.request.revision !== revision) return;
      if (failure) this.result = { ...this.result, status: "error", errorCode: errorCode(failure.error) };
      if (!["inactive", "ready", "empty", "error"].includes(this.result.status)
        && (this.request.active || this.result.status !== "unavailable")) return;
      this.confirmedRevision = revision;
      this.rollback = undefined;
      const pending = this.pending;
      this.pending = undefined;
      pending?.cleanup();
      if (failure) pending?.reject(failure.error);
      else if (this.result.status === "error") pending?.reject(new AppError(this.result.errorCode ?? "reader/segmentation-failed", "Reading mode failed"));
      else pending?.resolve(structuredClone(this.result));
      if (failure) this.emit();
    };
    if (!this.persistenceTracked) { settle(); return; }
    this.settlingRevision = revision;
    void this.writes.wait(revision).then(() => settle(), error => settle({ error }));
  }

  private defaultUnit(descriptor: ModeDescriptor): string {
    const preferred = this.preferredUnit(descriptor.key);
    return descriptor.units.some(unit => unit.id === preferred) ? preferred! : descriptor.defaultUnitId;
  }

  private availableModes(): ReadingModeDescriptor[] {
    return this.modes.map(({ key, label, units, defaultUnitId }) => ({ key, label, units: units.map(unit => ({ ...unit })), defaultUnitId }));
  }

  private change(active: boolean, unitId: string | null, modeKey = this.request.modeKey, rollback?: ModeRequest): void {
    this.request = { revision: this.request.revision + 1, active, unitId, modeKey };
    this.rollback = rollback;
    this.configurationWrite = Promise.resolve();
    this.writes.start(this.request.revision);
    this.positionWrites.start(this.request.revision);
    const unavailableReason = !this.supported ? "unsupported-format" : !this.descriptor ? "no-provider" : null;
    this.result = { status: unavailableReason ? "unavailable" : active ? "preparing" : "inactive", unavailableReason,
      requestedActive: active, modeKey, label: this.descriptor?.label ?? null, availableModes: this.availableModes(),
      unitId, units: this.descriptor?.units ?? [], progress: null, cfiRange: null, position: null };
    if (!active && unavailableReason) {
      this.finish(this.request.revision);
    }
    this.emit();
  }

  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
