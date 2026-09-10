import type {
  PluginDisposable,
  PluginLifecyclePhase,
} from "@read-aware/plugin-types";
import { AppError } from "@read-aware/core";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugin-lifecycle");

type StagedRegistration = {
  cancelled: boolean;
  factory?: () => PluginDisposable;
  live?: PluginDisposable;
};

/**
 * Host-owned lifecycle barrier for one plugin realm.
 *
 * Registration calls made by activate() are inert until promote(). Everything
 * with external effects asks this controller for the appropriate phase before
 * it can run. This makes candidate activation a real readiness pass rather
 * than an optimistic activation followed by cleanup.
 */
export class PluginLifecycleController {
  private current: PluginLifecyclePhase = "activating";
  private readonly registrations = new Set<StagedRegistration>();
  private activationTransaction: StagedRegistration[] | undefined;
  private rollingBack = false;
  private readonly storageWrites = new Set<Promise<unknown>>();
  private readonly cleanups = new Set<Promise<void>>();
  private readonly reads = new Set<Promise<unknown>>();
  private readonly cleanupErrors: unknown[] = [];
  private stopped = false;
  private readonly operations = new AbortController();

  get signal(): AbortSignal { return this.operations.signal; }
  cancelOperations(): void { this.operations.abort(new AppError("plugin/cancelled", "Plugin runtime has stopped")); }

  constructor(disposables: PluginDisposable[]) {
    // The outer instance owns one scope, not a growing list of retired handles.
    disposables.push({ dispose: () => this.stop() });
  }

  get registrationCount(): number { return this.registrations.size; }

  get phase(): PluginLifecyclePhase {
    return this.current;
  }

  stage(factory: () => PluginDisposable): PluginDisposable {
    this.assertNotStopped();
    if (this.rollingBack) throw new Error("plugin registrations are unavailable during rollback");
    if (this.current === "migrating") {
      throw new Error("plugin registrations are unavailable during data migration");
    }
    const entry: StagedRegistration = { cancelled: false, factory };
    const handle: PluginDisposable = {
      dispose: () => this.disposeRegistration(entry),
    };
    this.registrations.add(entry);
    if (this.current === "active") {
      try { this.activateRegistrations([entry], "active"); }
      catch (error) {
        this.disposeRegistration(entry);
        throw error;
      }
    }
    return handle;
  }

  private disposeRegistration(entry: StagedRegistration): void {
    if (entry.cancelled) return;
    entry.cancelled = true;
    this.registrations.delete(entry);
    const live = entry.live;
    entry.live = undefined;
    entry.factory = undefined;
    live?.dispose();
  }

  private activateRegistration(entry: StagedRegistration): void {
    if (entry.cancelled || entry.live || !entry.factory) return;
    const live = entry.factory();
    // A synchronous host observer can dispose this registration or stop its
    // realm while the factory runs. The returned resource still needs closing.
    if (entry.cancelled || this.stopped) {
      live.dispose();
      if (this.stopped) throw new AppError("plugin/cancelled", "Plugin stopped during registration");
      return;
    }
    entry.live = live;
    if (this.activationTransaction) this.activationTransaction.push(entry);
    else entry.factory = undefined;
  }

  promote(): void {
    this.assertNotStopped();
    if (this.current !== "activating" || this.activationTransaction) {
      throw new Error(`cannot promote plugin from ${this.current} phase`);
    }
    this.current = "active";
    this.activateRegistrations([...this.registrations], "activating");
  }

  private activateRegistrations(entries: StagedRegistration[], failurePhase: PluginLifecyclePhase): void {
    const initial = new Set(this.registrations);
    const activated: StagedRegistration[] = [];
    const parentTransaction = this.activationTransaction;
    this.activationTransaction = activated;
    try {
      for (const entry of entries) this.activateRegistration(entry);
      if (parentTransaction) for (const entry of activated) parentTransaction.push(entry);
      else for (const entry of activated) entry.factory = undefined;
    } catch (error) {
      if (!this.stopped) this.current = failurePhase;
      this.rollingBack = true;
      const failures: unknown[] = [error];
      for (const entry of activated.reverse()) {
        const live = entry.live;
        entry.live = undefined;
        try { live?.dispose(); }
        catch (disposeError) { failures.push(disposeError); }
      }
      // Reentrant registrations were produced by this failed attempt. Keeping
      // them for retry would register both the old child and its replacement.
      for (const entry of this.registrations) {
        if (!initial.has(entry)) this.disposeRegistration(entry);
      }
      if (failures.length > 1) throw new AggregateError(failures, "Plugin registration and rollback failed");
      throw error;
    } finally {
      this.activationTransaction = parentTransaction;
      this.rollingBack = false;
    }
  }

  beginMigration(): void {
    this.assertNotStopped();
    if (this.activationTransaction) throw new Error("cannot migrate during registration activation");
    if (this.current !== "activating") {
      throw new Error(`cannot migrate plugin from ${this.current} phase`);
    }
    this.current = "migrating";
  }

  finishMigration(): void {
    this.assertNotStopped();
    if (this.current !== "migrating") {
      throw new Error(`plugin is not migrating (current phase: ${this.current})`);
    }
    this.current = "activating";
  }

  suspend(): void {
    this.assertNotStopped();
    if (this.activationTransaction) throw new Error("cannot suspend during registration activation");
    if (this.current === "migrating") {
      throw new Error("cannot suspend a plugin while its data migration is running");
    }
    this.current = "activating";
  }

  assertActive(operation: string): void {
    this.assertNotStopped();
    if (this.current !== "active") {
      throw new Error(`${operation} is unavailable while plugin is ${this.current}`);
    }
  }

  assertStorageWrite(operation: string): void {
    this.assertNotStopped();
    if (this.current !== "active" && this.current !== "migrating") {
      throw new Error(`${operation} is unavailable while plugin is ${this.current}`);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.current = "activating";
    this.cancelOperations();
    const errors: unknown[] = [];
    for (const entry of [...this.registrations].reverse()) {
      try { this.disposeRegistration(entry); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Plugin registration disposal failed");
  }

  private assertNotStopped(): void {
    if (this.stopped) throw new Error("plugin runtime has stopped");
  }

  storageWrite<T>(operation: string, write: () => Promise<T>): Promise<T> {
    this.assertStorageWrite(operation);
    const pending = write();
    this.storageWrites.add(pending);
    void pending.then(() => this.storageWrites.delete(pending), () => this.storageWrites.delete(pending));
    return pending;
  }

  async drainStorageWrites(): Promise<void> {
    const errors: unknown[] = [];
    while (this.storageWrites.size) {
      const results = await Promise.allSettled([...this.storageWrites]);
      for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length) throw errors[0];
  }

  /** Cancel the consumer promptly; retain the source operation until its own
   * finally releases resources, including non-interruptible parser/IPC loads. */
  read<T>(operation: string, run: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    if (this.stopped) throw new AppError("plugin/cancelled", `${operation} is unavailable after plugin stop`);
    const signal = callerSignal ? AbortSignal.any([this.signal, callerSignal]) : this.signal;
    signal.throwIfAborted();
    if (this.reads.size >= 32) throw new AppError("plugin/busy", "Plugin read capacity is occupied");
    const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return run(signal); });
    this.reads.add(pending);
    this.trackCleanup(pending.then(() => { this.reads.delete(pending); }, error => {
      this.reads.delete(pending);
      // Normal read failures already reach the caller. After cancellation only
      // the expected abort is ignorable; source/cleanup failures still surface.
      if (signal.aborted && error !== signal.reason && !(error instanceof Error && error.name === "AbortError")) throw error;
    }));
    return new Promise<T>((resolve, reject) => {
      const cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      void pending.then(value => { signal.removeEventListener("abort", cancel); if (signal.aborted) reject(signal.reason); else resolve(value); },
        error => { signal.removeEventListener("abort", cancel); reject(signal.aborted ? signal.reason : error); });
    });
  }

  trackCleanup(pending: Promise<void>): void {
    this.cleanups.add(pending);
    void pending.then(
      () => this.cleanups.delete(pending),
      error => {
        this.cleanups.delete(pending);
        log.warn("Plugin asynchronous resource cleanup failed", error);
        // Keep one failure for the shutdown caller; repeated failures are logged.
        if (!this.cleanupErrors.length) this.cleanupErrors.push(error);
      },
    );
  }

  async drainCleanups(): Promise<void> {
    while (this.cleanups.size) await Promise.allSettled([...this.cleanups]);
    const errors = this.cleanupErrors.splice(0);
    if (errors.length) throw new AggregateError(errors, "Plugin resource cleanup failed");
  }
}
