import { AppError, type ReadingModeConfiguration, type ReadingModeSnapshot, type ReadingModePosition, type ReadingModeStepOutcome, type ReadingModeDescriptor } from "@read-aware/core";

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
    const result = await stepper(direction, signal);
    await this.waitForFeedback(result.feedback, signal, () => stepper === this.stepper && revision === this.request.revision);
    return result.outcome;
  }

  async waitForPosition(position: ReadingModePosition, signal: AbortSignal): Promise<void> {
    const waiter = this.positionWaiter;
    if (!waiter) throw new AppError("reader/unavailable", "Reading mode position is not attached");
    const revision = this.request.revision;
    const feedback = await waiter(position, signal);
    await this.waitForFeedback(feedback, signal, () => waiter === this.positionWaiter && revision === this.request.revision);
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
          if (this.result.status !== feedback.status || this.result.cfiRange !== feedback.cfiRange
            || this.result.progress?.ordinal !== feedback.progress?.ordinal || this.result.progress?.total !== feedback.progress?.total) return;
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
    const before = this.pending?.before ?? this.request;
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
    this.supersede();
    this.change(active, unitId);
  }

  async configure(input: ReadingModeConfiguration, signal?: AbortSignal): Promise<ReadingModeSnapshot> {
    if (signal?.aborted) throw signal.reason;
    this.validate(input);
    const modeKey = input.selectModeKey ?? this.request.modeKey;
    const descriptor = this.modes.find(mode => mode.key === modeKey);
    const unitId = input.unitId ?? (modeKey === this.request.modeKey ? this.request.unitId : null) ?? (descriptor ? this.defaultUnit(descriptor) : null);
    if (this.confirmedRevision === this.request.revision && this.request.active === input.active && this.request.unitId === unitId
      && this.request.modeKey === modeKey
      && ["inactive", "ready", "empty"].includes(this.result.status)) return structuredClone(this.result);
    const before = this.pending?.before ?? this.request;
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
    this.change(input.active, unitId, modeKey);
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
      this.confirmedRevision = revision;
      const pending = this.pending;
      this.pending = undefined;
      pending?.cleanup();
      if (status === "error") pending?.reject(new AppError(feedback.errorCode ?? "reader/segmentation-failed", "Reading mode failed"));
      else pending?.resolve(structuredClone(this.result));
    }
    this.emit();
  }

  retire(): boolean {
    const before = this.pending?.before;
    this.supersede();
    if (!before) return false;
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

  private defaultUnit(descriptor: ModeDescriptor): string {
    const preferred = this.preferredUnit(descriptor.key);
    return descriptor.units.some(unit => unit.id === preferred) ? preferred! : descriptor.defaultUnitId;
  }

  private availableModes(): ReadingModeDescriptor[] {
    return this.modes.map(({ key, label, units, defaultUnitId }) => ({ key, label, units: units.map(unit => ({ ...unit })), defaultUnitId }));
  }

  private change(active: boolean, unitId: string | null, modeKey = this.request.modeKey): void {
    this.request = { revision: this.request.revision + 1, active, unitId, modeKey };
    const unavailableReason = !this.supported ? "unsupported-format" : !this.descriptor ? "no-provider" : null;
    this.result = { status: unavailableReason ? "unavailable" : active ? "preparing" : "inactive", unavailableReason,
      requestedActive: active, modeKey, label: this.descriptor?.label ?? null, availableModes: this.availableModes(),
      unitId, units: this.descriptor?.units ?? [], progress: null, cfiRange: null, position: null };
    if (!active && unavailableReason) {
      this.confirmedRevision = this.request.revision;
      const pending = this.pending; this.pending = undefined;
      pending?.cleanup(); pending?.resolve(structuredClone(this.result));
    }
    this.emit();
  }

  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
