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

  constructor(private readonly disposables: PluginDisposable[]) {}

  get phase(): PluginLifecyclePhase {
    return this.current;
  }

  stage(factory: () => PluginDisposable): PluginDisposable {
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
    if (this.current !== "activating") {
      throw new Error(`cannot migrate plugin from ${this.current} phase`);
    }
    this.current = "migrating";
  }

  finishMigration(): void {
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
    if (this.current !== "active") {
      throw new Error(`${operation} is unavailable while plugin is ${this.current}`);
    }
  }

  assertStorageWrite(operation: string): void {
    if (this.current !== "active" && this.current !== "migrating") {
      throw new Error(`${operation} is unavailable while plugin is ${this.current}`);
    }
  }
}
