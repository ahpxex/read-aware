import type {
  PluginDisposable,
  PluginLifecyclePhase,
} from "@read-aware/plugin-types";

type StagedRegistration = {
  cancelled: boolean;
  factory: () => PluginDisposable;
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
  private readonly staged: StagedRegistration[] = [];
  private readonly storageWrites = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(private readonly disposables: PluginDisposable[]) {}

  get phase(): PluginLifecyclePhase {
    return this.current;
  }

  stage(factory: () => PluginDisposable): PluginDisposable {
    this.assertNotStopped();
    if (this.current === "migrating") {
      throw new Error("plugin registrations are unavailable during data migration");
    }
    const entry: StagedRegistration = { cancelled: false, factory };
    const handle: PluginDisposable = {
      dispose: () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        entry.live?.dispose();
        entry.live = undefined;
      },
    };
    this.staged.push(entry);
    this.disposables.push(handle);
    if (this.current === "active") entry.live = factory();
    return handle;
  }

  promote(): void {
    this.assertNotStopped();
    if (this.current !== "activating") {
      throw new Error(`cannot promote plugin from ${this.current} phase`);
    }
    this.current = "active";
    const activated: StagedRegistration[] = [];
    try {
      for (const entry of this.staged) {
        if (entry.cancelled || entry.live) continue;
        entry.live = entry.factory();
        activated.push(entry);
      }
    } catch (error) {
      for (const entry of activated.reverse()) {
        try {
          entry.live?.dispose();
        } finally {
          entry.live = undefined;
        }
      }
      this.current = "activating";
      throw error;
    }
  }

  beginMigration(): void {
    this.assertNotStopped();
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
    this.stopped = true;
    this.current = "activating";
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
}
