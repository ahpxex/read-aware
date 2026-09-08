import { AppError, type ReadingModeConfiguration, type ReadingModeSnapshot } from "@read-aware/core";

export type ModeDescriptor = { key: string; label: string; units: { id: string; label: string }[]; defaultUnitId: string };
export type ModeRequest = { revision: number; active: boolean; unitId: string | null };
export type ModeFeedback = { status: "inactive" | "building" | "ready" | "empty" | "error"; errorCode?: string;
  progress: { ordinal: number; total: number } | null; cfiRange: string | null };
type Pending = { revision: number; before: ModeRequest; resolve(mode: ReadingModeSnapshot): void; reject(error: unknown): void; cleanup(): void };

/** Owns requested mode state and completion. The reader reports the actual indexed state. */
export class ReadingModeController {
  private descriptor: ModeDescriptor | null = null;
  private supported = true;
  private request: ModeRequest;
  private result: ReadingModeSnapshot;
  private listeners = new Set<() => void>();
  private pending: Pending | undefined;
  private confirmedRevision = -1;

  constructor(active = false, unitId: string | null = null, private readonly deadlineMs = 35_000) {
    this.request = { revision: 0, active, unitId };
    this.result = { status: "unavailable", unavailableReason: "no-provider", requestedActive: active,
      modeKey: null, label: null, unitId, units: [], progress: null, cfiRange: null };
  }

  requested = (): ModeRequest => this.request;
  snapshot = (): ReadingModeSnapshot => this.result;
  observe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  environment(descriptor: ModeDescriptor | null, supported: boolean): void {
    if (JSON.stringify(this.descriptor) === JSON.stringify(descriptor) && this.supported === supported) return;
    const before = this.pending?.before ?? this.request;
    this.descriptor = descriptor;
    this.supported = supported;
    this.supersede();
    const unitId = descriptor?.units.some(unit => unit.id === before.unitId)
      ? before.unitId : descriptor?.defaultUnitId ?? before.unitId;
    this.change(before.active, unitId);
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
    const unitId = input.unitId ?? this.request.unitId ?? this.descriptor?.defaultUnitId ?? null;
    if (this.confirmedRevision === this.request.revision && this.request.active === input.active && this.request.unitId === unitId
      && ["inactive", "ready", "empty"].includes(this.result.status)) return structuredClone(this.result);
    const before = this.pending?.before ?? this.request;
    this.supersede();
    const revision = this.request.revision + 1;
    const work = new Promise<ReadingModeSnapshot>((resolve, reject) => {
      const cancel = (reason: unknown) => {
        if (this.pending?.revision !== revision) return;
        this.supersede(reason);
        // Revert only this unfinished request. A newer UI/actor action owns its own state.
        this.change(before.active, before.unitId);
      };
      const abort = () => cancel(signal?.reason);
      const timer = setTimeout(() => cancel(new AppError("reader/timeout", "Reading mode did not settle")), this.deadlineMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending = { revision, before, resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
    });
    this.change(input.active, unitId);
    return work;
  }

  feedback(revision: number, modeKey: string | null, unitId: string | null, feedback: ModeFeedback): void {
    if (revision !== this.request.revision || modeKey !== this.descriptor?.key || unitId !== this.request.unitId) return;
    if (!this.supported || !this.descriptor) return;
    if (this.request.active && feedback.status === "inactive" || !this.request.active && feedback.status !== "inactive") return;
    const status = feedback.status === "building" ? "preparing" : feedback.status;
    this.result = { ...this.result, status, errorCode: feedback.errorCode,
      progress: feedback.progress, cfiRange: feedback.cfiRange };
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
    this.change(before.active, before.unitId);
    return true;
  }

  private validate(input: ReadingModeConfiguration): void {
    if (!input || typeof input !== "object" || typeof input.active !== "boolean"
      || input.modeKey !== undefined && typeof input.modeKey !== "string"
      || input.unitId !== undefined && typeof input.unitId !== "string") throw new AppError("reader/invalid-target", "Invalid reading mode configuration");
    if (input.active && (!this.supported || !this.descriptor)) throw new AppError("reader/unavailable", "Reading mode is unavailable");
    if (input.modeKey !== undefined && input.modeKey !== this.descriptor?.key) throw new AppError("reader/superseded", "Reading mode provider changed");
    if (input.unitId !== undefined && !this.descriptor?.units.some(unit => unit.id === input.unitId)) throw new AppError("reader/invalid-target", "Unknown reading mode unit");
  }

  private supersede(reason: unknown = new AppError("reader/superseded", "Reading mode request was replaced")): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup(); pending?.reject(reason);
  }

  private change(active: boolean, unitId: string | null): void {
    this.request = { revision: this.request.revision + 1, active, unitId };
    const unavailableReason = !this.supported ? "unsupported-format" : !this.descriptor ? "no-provider" : null;
    this.result = { status: unavailableReason ? "unavailable" : active ? "preparing" : "inactive", unavailableReason,
      requestedActive: active, modeKey: this.descriptor?.key ?? null, label: this.descriptor?.label ?? null,
      unitId, units: this.descriptor?.units ?? [], progress: null, cfiRange: null };
    if (!active && unavailableReason) {
      this.confirmedRevision = this.request.revision;
      const pending = this.pending; this.pending = undefined;
      pending?.cleanup(); pending?.resolve(structuredClone(this.result));
    }
    this.emit();
  }

  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}
