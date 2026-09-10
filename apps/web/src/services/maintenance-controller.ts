import { AppError, HOST_MAINTENANCE_SURFACES, type HostMaintenancePort, type HostMaintenanceSnapshot, type HostMaintenanceSurface, type WorkspaceSettingsSection } from "@read-aware/core";

export function maintenanceSection(surface: HostMaintenanceSurface): WorkspaceSettingsSection {
  if (!HOST_MAINTENANCE_SURFACES.includes(surface)) throw new AppError("ui/invalid-target", "Unknown maintenance surface");
  if (surface === "plugins") return "plugins";
  if (surface === "ai-connection") return "ai";
  if (surface === "backup-import" || surface === "backup-export" || surface === "delete-data") return "dataSync";
  return "about";
}

type Adapter = {
  requestConnectionTest?: HostMaintenancePort["requestConnectionTest"];
  requestBackup?: HostMaintenancePort["requestBackup"];
  snapshot(): HostMaintenanceSnapshot;
  check(signal?: AbortSignal): Promise<HostMaintenanceSnapshot>;
  subscribe(handler: () => void): () => void;
  navigate(section: WorkspaceSettingsSection, signal?: AbortSignal): Promise<unknown>;
};

export class HostMaintenanceService implements HostMaintenancePort {
  private surfaces = new Map<HostMaintenanceSurface, () => void>();
  private observerCount = 0;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {}

  async snapshot() { return this.adapter.snapshot(); }
  requestConnectionTest(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.adapter.requestConnectionTest) throw new AppError("ui/unavailable", "AI test controls are unavailable");
    return this.adapter.requestConnectionTest(signal);
  }
  requestBackup(action: import("@read-aware/core").BackupAction, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (action !== "import" && action !== "export") throw new AppError("ui/invalid-target", "Invalid backup action");
    if (!this.adapter.requestBackup) throw new AppError("ui/unavailable", "Backup controls are unavailable");
    return this.adapter.requestBackup(action, signal);
  }
  checkForUpdates(signal?: AbortSignal) { return this.adapter.check(signal); }

  /** Host mount registration, never included in the Worker/Agent port. */
  bindSurface(surface: HostMaintenanceSurface, reveal: () => void): () => void {
    this.surfaces.set(surface, reveal);
    return () => { if (this.surfaces.get(surface) === reveal) this.surfaces.delete(surface); };
  }

  async openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal) {
    const section = maintenanceSection(surface);
    signal?.throwIfAborted();
    await this.adapter.navigate(section, signal);
    signal?.throwIfAborted();
    this.revealControl(surface);
    return { status: "opened" as const, surface };
  }

  /** Host-only focus, for a flow whose settings page is already mounted. */
  revealControl(surface: HostMaintenanceSurface): void {
    const reveal = this.surfaces.get(surface);
    if (!reveal) throw new AppError("ui/unavailable", "Maintenance controls are not mounted");
    reveal();
  }

  observe(handler: (value: HostMaintenanceSnapshot) => unknown): () => void {
    if (this.observerCount >= 64) throw new AppError("ui/observer-limit", "Too many maintenance observers");
    let stopped = false, running = false, dirty = false;
    const notify = async () => {
      dirty = true;
      if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          try { await handler(this.adapter.snapshot()); } catch (error) { this.report(error); }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const off = this.adapter.subscribe(() => { void notify(); });
    this.observerCount++;
    void notify();
    return () => { if (!stopped) { stopped = true; this.observerCount--; off(); } };
  }
}
