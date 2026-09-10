import { AppError, type HostMaintenanceSnapshot, type HostUpdateState } from "@read-aware/core";
import type { AvailableSoftwareUpdate, DownloadProgress, InstallSoftwareUpdateResult } from "./software-update";

type Adapter = {
  supported(): boolean;
  channel(): "stable" | "beta";
  read(): HostUpdateState;
  write(state: HostUpdateState): void;
  version(): Promise<string | null>;
  check(): Promise<AvailableSoftwareUpdate | null>;
  install(progress: (value: DownloadProgress) => void): Promise<InstallSoftwareUpdateResult>;
};

/** Native UI and external actors share one updater and one operation lock. */
export class SoftwareUpdateController {
  private checking: Promise<void> | null = null;
  private installing: Promise<void> | null = null;
  private checkedChannel: "stable" | "beta" | null = null;
  private channelRevision = 0;
  constructor(private adapter: Adapter, private report: (message: string, error: unknown) => void) {}

  snapshot(): HostMaintenanceSnapshot {
    const state = this.adapter.read();
    return { phase: state.phase, currentVersion: state.currentVersion, availableVersion: state.availableVersion,
      progress: state.progress, errorStage: state.errorStage, supported: this.adapter.supported(),
      channel: this.adapter.channel(), checkedChannel: this.checkedChannel };
  }

  async loadCurrentVersion(): Promise<void> {
    try {
      const currentVersion = await this.adapter.version();
      if (currentVersion) this.patch({ currentVersion });
    } catch (error) { this.report("App version lookup failed", error); }
  }

  async checkForUpdates(signal?: AbortSignal): Promise<HostMaintenanceSnapshot> {
    signal?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Software updater requires a supported native platform");
    if (this.installing) throw new AppError("ui/unavailable", "An update installation is already in progress");
    if (!this.checking) {
      const channel = this.adapter.channel();
      const revision = this.channelRevision;
      this.checkedChannel = null;
      // Defer execution until the shared promise has been assigned, including synchronous adapter failures.
      this.checking = Promise.resolve().then(async () => {
        this.patch({ phase: "checking", availableVersion: null, progress: null, errorStage: null });
        try {
          const update = await this.adapter.check();
          if (revision !== this.channelRevision || channel !== this.adapter.channel()) throw new AppError("ui/superseded", "Update channel changed during the check");
          this.checkedChannel = channel;
          this.patch({ phase: update ? "available" : "up-to-date", availableVersion: update?.version ?? null,
            ...(update ? { currentVersion: update.currentVersion } : {}) });
        } catch (error) {
          this.report("Update check failed", error);
          this.patch({ phase: "error", availableVersion: null, errorStage: "check" });
          throw new AppError(error instanceof AppError ? error.code : "ipc/unknown", "Software update check failed");
        }
      }).finally(() => { this.checking = null; });
    }
    await this.checking;
    signal?.throwIfAborted();
    return this.snapshot();
  }

  /** Host UI only. This method is deliberately absent from the public actor service. */
  async installUpdate(): Promise<void> {
    if (this.installing) return this.installing;
    if (!this.adapter.supported() || this.checking || this.checkedChannel !== this.adapter.channel()
      || !this.adapter.read().availableVersion) throw new AppError("ui/unavailable", "Check the selected channel before installing");
    this.installing = Promise.resolve().then(async () => {
      this.patch({ phase: "downloading", progress: null, errorStage: null });
      try {
        const result = await this.adapter.install(progress => this.patch(progress));
        this.patch({ phase: result === "permission-required" ? "permission-required" : "installer-open", progress: null });
      } catch (error) {
        this.report("Update install failed", error);
        this.patch({ phase: "error", errorStage: "install" });
      }
    }).finally(() => { this.installing = null; });
    return this.installing;
  }

  channelChanged(): void {
    this.channelRevision++;
    // An accepted installation cannot be cancelled by changing the preference.
    if (this.installing || this.checking || this.checkedChannel === this.adapter.channel()) return;
    this.checkedChannel = null;
    this.patch({ phase: "idle", availableVersion: null, progress: null, errorStage: null });
  }
  installerOpened(): void { this.patch({ phase: "installer-open", progress: null }); }
  private patch(patch: Partial<HostUpdateState>): void { this.adapter.write({ ...this.adapter.read(), ...patch }); }
}
