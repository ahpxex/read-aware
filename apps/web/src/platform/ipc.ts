/**
 * The single seam for Tauri IPC calls. App code imports `invoke` from HERE,
 * never from `@tauri-apps/api/core` (enforced by convention + review; the
 * signature is identical so call sites don't change shape).
 *
 * Why the seam exists: a rejected raw `invoke()` throws whatever the Rust
 * command's error type serializes to — for legacy `Result<T, String>` commands
 * that is a bare PRIMITIVE STRING, not an Error. Every
 * `err instanceof Error ? err.message : ...` check in the app silently took
 * the wrong branch for IPC failures. This wrapper normalizes every rejection
 * into an `IpcError` (an `AppError` with a stable code):
 *
 * - Commands migrated to the structured Rust error type (src-tauri/src/error.rs)
 *   reject with `{ code, message }` — the code is carried through verbatim
 *   (e.g. `fs/not-found`, `db/locked`).
 * - Legacy string rejections become `ipc/unknown` with the string as message.
 *
 * The message stays developer-facing: surfaces render localized copy via
 * `describeError`, and the raw text goes to the log file only.
 */
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { AppError, ERR_DB_LOCKED, ERR_IPC_UNKNOWN } from "@read-aware/core";

export class IpcError extends AppError {
  /** The Tauri command whose invocation failed. */
  readonly command: string;

  constructor(code: string, message: string, command: string, options?: { retryable?: boolean }) {
    super(code, `${command}: ${message}`, { retryable: options?.retryable });
    this.name = "IpcError";
    this.command = command;
  }
}

/** Codes whose failures are transient by nature — same call may succeed. */
const RETRYABLE_CODES = new Set([ERR_DB_LOCKED]);

function normalizeIpcFailure(command: string, raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;
  if (typeof raw === "object" && raw !== null) {
    const { code, message } = raw as { code?: unknown; message?: unknown };
    if (typeof code === "string" && code.length > 0) {
      return new IpcError(code, typeof message === "string" ? message : String(raw), command, {
        retryable: RETRYABLE_CODES.has(code),
      });
    }
  }
  return new IpcError(
    ERR_IPC_UNKNOWN,
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw),
    command,
  );
}

/** Drop-in replacement for Tauri's `invoke` that never rejects with a bare string. */
export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args, options);
  } catch (raw) {
    throw normalizeIpcFailure(command, raw);
  }
}
