import { AppError } from "@read-aware/core";
import { validBackupPassword } from "./backup-password";

export type FullBackupProgress =
  | { phase: "preparing" }
  | { phase: "database"; remainingPages: number; totalPages: number }
  | { phase: "files"; copiedBytes: number }
  | { phase: "verifyingPrograms" }
  | { phase: "encrypting" };
export type FullBackupCaptureReceipt = { taskId: string; format: 2 };
type Dependencies = {
  id(): string;
  /** Opens the host's save dialog and binds the picked destination to this
   * task natively. Resolves to the location for display, or null on cancel. */
  selectDestination(taskId: string): Promise<string | null>;
  /** Includes source preparation and all write fences; resolves only after
   * physical capture and fence release. No password or destination here. */
  capture(
    taskId: string,
    progress: (update: FullBackupProgress) => void,
    signal?: AbortSignal,
  ): Promise<FullBackupCaptureReceipt>;
  /** Writes to the destination bound by `selectDestination`, consuming it.
   * Resolves `false` when the user cancelled at the iOS export picker — the
   * real destination choice on that platform. */
  write(taskId: string, password: string): Promise<boolean>;
  /** Also releases an unused destination binding. */
  cancel(taskId: string): Promise<void>;
  warn(message: string, error: unknown): void;
};

/** Host-only task. Actors receive neither passwords, file paths nor task IDs.
 * The native owner holds all plaintext and publishes encrypted output atomically. */
export function createFullBackupExport(deps: Dependencies) {
  return async (
    password: string,
    signal?: AbortSignal,
    onProgress?: (update: FullBackupProgress) => void,
  ): Promise<boolean> => {
    signal?.throwIfAborted();
    if (!validBackupPassword(password)) {
      throw new AppError("backup/password-policy", "Invalid full backup passphrase length");
    }
    // Never keep a write fence across user input.
    const taskId = deps.id();
    const destination = await deps.selectDestination(taskId);
    if (destination === null) {
      signal?.throwIfAborted();
      return false;
    }
    // From here the native destination binding exists; every exit cancels.
    let cancelling: Promise<void> | undefined;
    const cancel = (): Promise<void> =>
      (cancelling ??= Promise.resolve()
        .then(() => deps.cancel(taskId))
        .catch((error) => deps.warn("Full backup task cleanup failed", error))
        .finally(() => {
          cancelling = undefined;
        }));
    const abort = () => {
      void cancel();
    };
    const progress = (update: FullBackupProgress) => {
      // An abort IPC can arrive before native capture admission. Retry once
      // native progress proves admission; the final cleanup also retries.
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        onProgress?.(update);
      } catch (error) {
        deps.warn("Full backup progress observer failed", error);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const receipt = await deps.capture(taskId, progress, signal);
      signal?.throwIfAborted();
      if (receipt?.taskId !== taskId || receipt.format !== 2) {
        throw new AppError("backup/changed", "Unexpected full backup capture receipt");
      }
      progress({ phase: "encrypting" });
      signal?.throwIfAborted();
      if (!(await deps.write(taskId, password))) return false;
      // A successful atomic publication remains success even if abort raced
      // with the native reply. Do not claim the saved file was rolled back.
      return true;
    } finally {
      signal?.removeEventListener("abort", abort);
      await cancelling;
      // Wait for physical capture/write before retiring a ready task. Also
      // covers a lost/invalid receipt or cancellation before native admission.
      await cancel();
    }
  };
}
