import { AppError, type HostMaintenancePort, type HostMaintenanceSnapshot, type HostMaintenanceSurface } from "@read-aware/core";

type Adapter = {
  snapshot(): HostMaintenanceSnapshot;
  check(signal?: AbortSignal): Promise<HostMaintenanceSnapshot>;
  subscribe(handler: () => void): () => void;
  navigate(signal?: AbortSignal): Promise<unknown>;
};

export class HostMaintenanceService implements HostMaintenancePort {
  private surfaces = new Map<HostMaintenanceSurface, () => void>();
  private observerCount = 0;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {}

  async snapshot() { return this.adapter.snapshot(); }
  checkForUpdates(signal?: AbortSignal) { return this.adapter.check(signal); }

  /** Host mount registration, never included in the Worker/Agent port. */
  bindSurface(surface: HostMaintenanceSurface, reveal: () => void): () => void {
    this.surfaces.set(surface, reveal);
    return () => { if (this.surfaces.get(surface) === reveal) this.surfaces.delete(surface); };
  }

  async openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal) {
    if (surface !== "updates" && surface !== "diagnostics") throw new AppError("ui/invalid-target", "Unknown maintenance surface");
    signal?.throwIfAborted();
    await this.adapter.navigate(signal);
    signal?.throwIfAborted();
    const reveal = this.surfaces.get(surface);
    if (!reveal) throw new AppError("ui/unavailable", "Maintenance controls are not mounted");
    reveal();
    return { status: "opened" as const, surface };
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
