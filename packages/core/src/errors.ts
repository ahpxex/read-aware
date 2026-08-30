/**
 * The shared error contract for every ReadAware layer.
 *
 * An `AppError` carries a stable machine-readable `code` ("domain/cause", e.g.
 * `fs/not-found`, `ai/rate-limited`) next to its developer-facing `message`.
 * UI code matches on the CODE and renders localized, actionable copy; the
 * message is for the log file and is never shown verbatim to the user.
 *
 * Rules of the contract:
 * - Codes are stable identifiers, not prose. Renaming one is a breaking change
 *   for every surface that matches on it (including persisted `errorCode`
 *   columns), so codes are only ever added.
 * - `retryable` means "the same action may succeed if simply tried again"
 *   (transient IO, rate limits, network). Surfaces use it to decide whether a
 *   retry affordance is honest — offering retry on a terminal failure is not.
 * - Unknown/unclassified failures normalize to a generic code instead of
 *   leaking raw text into presentation decisions.
 */

/** IPC rejection that carried no structured code (legacy `Result<T, String>`). */
export const ERR_IPC_UNKNOWN = "ipc/unknown";

/** Well-known codes produced by the desktop backend (see src-tauri error.rs). */
export const ERR_FS_NOT_FOUND = "fs/not-found";
export const ERR_FS_PERMISSION = "fs/permission";
export const ERR_FS_NO_SPACE = "fs/no-space";
export const ERR_DB_LOCKED = "db/locked";
export const ERR_DB_ERROR = "db/error";
export const ERR_SECRETS_UNAVAILABLE = "secrets/unavailable";

/** Sync/relay failure codes (classified in apps/web platform/sync). */
export const ERR_SYNC_NETWORK = "sync/network";
export const ERR_SYNC_SERVER = "sync/server";
export const ERR_SYNC_UNAUTHORIZED = "sync/unauthorized";
export const ERR_SYNC_MISDIRECTED = "sync/misdirected";
export const ERR_SYNC_PASSPHRASE = "sync/passphrase";
export const ERR_SYNC_QUOTA = "sync/quota";
export const ERR_SYNC_RATE_LIMITED = "sync/rate-limited";

/** AI provider failure codes (classified in @read-aware/agent). */
export const ERR_AI_NOT_CONFIGURED = "ai/not-configured";
export const ERR_AI_AUTH = "ai/auth";
export const ERR_AI_RATE_LIMITED = "ai/rate-limited";
export const ERR_AI_QUOTA = "ai/quota";
export const ERR_AI_NETWORK = "ai/network";
export const ERR_AI_PROVIDER = "ai/provider";
export const ERR_AI_CONTEXT_OVERFLOW = "ai/context-overflow";
export const ERR_AI_UNKNOWN = "ai/unknown";

export type AppErrorOptions = {
  retryable?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * The stable code of a thrown value, if it carries one. Matches any object
 * with a string `code` (AppError subclasses, but also plain rethrown shapes
 * that crossed a structured-clone or serialization boundary).
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/** Whether a thrown value declares itself worth retrying. Defaults to false. */
export function isRetryable(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "retryable" in error) {
    return (error as { retryable: unknown }).retryable === true;
  }
  return false;
}

/**
 * Normalize an arbitrary thrown value into an `Error` without losing it:
 * non-Error values become the `cause` of a wrapper. Use at boundaries that
 * must hand a real Error to a logger or an error state.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : JSON.stringify(value) ?? String(value), {
    cause: value,
  });
}
