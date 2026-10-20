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
/** Local read-only HTTP transport. */
export const ERR_LOCAL_API_BIND = "local-api/bind";
export const ERR_LOCAL_API_UNAVAILABLE = "local-api/unavailable";
export const ERR_LOCAL_API_INVALID_INPUT = "local-api/invalid-input";
export const ERR_LOCAL_API_FORBIDDEN = "local-api/forbidden";
export const ERR_LOCAL_API_UNAUTHORIZED = "local-api/unauthorized";
export const ERR_LOCAL_API_READ_ONLY = "local-api/read-only";
export const ERR_LOCAL_API_BUSY = "local-api/busy";
export const ERR_LOCAL_API_TIMEOUT = "local-api/timeout";
export const ERR_LOCAL_API_TOO_LARGE = "local-api/too-large";
export const ERR_LOCAL_API_NOT_FOUND = "local-api/not-found";
export const ERR_SECRETS_UNAVAILABLE = "secrets/unavailable";
/** Local records were cleared, but file cleanup must finish before normal use. */
export const ERR_DATA_WIPE_INCOMPLETE = "data/wipe-incomplete";
/** Native full-backup preparation; never substitute a partial archive. */
export const ERR_BACKUP_INCOMPLETE = "backup/incomplete";
export const ERR_BACKUP_BUSY = "backup/busy";
export const ERR_BACKUP_CHANGED = "backup/changed";
export const ERR_BACKUP_CANCELLED = "backup/cancelled";
export const ERR_BACKUP_INVALID_ARCHIVE = "backup/invalid-archive";
export const ERR_BACKUP_UNLOCK_FAILED = "backup/unlock-failed";
export const ERR_BACKUP_PASSWORD_POLICY = "backup/password-policy";
export const ERR_BACKUP_RECOVERY_REQUIRED = "backup/recovery-required";
/** The chosen file is a retired v1 JSON library backup, which cannot be restored. */
export const ERR_BACKUP_LEGACY_FORMAT = "backup/legacy-format";
/** Invalid plugin service arguments or a bounded service payload over quota. */
export const ERR_PLUGIN_INVALID_ARGUMENT = "plugin/invalid-argument";
export const ERR_PLUGIN_QUOTA_EXCEEDED = "plugin/quota-exceeded";
export const ERR_PLUGIN_ASSET_CONFLICT = "plugin/asset-conflict";
/** Native plugin file management (src-tauri plugins.rs). */
export const ERR_PLUGIN_INVALID_PACKAGE = "plugin/invalid-package";
export const ERR_PLUGIN_BUILT_IN = "plugin/built-in";
export const ERR_PLUGIN_CANDIDATE_STALE = "plugin/candidate-stale";
export const ERR_PLUGIN_NO_PREVIOUS_VERSION = "plugin/no-previous-version";
/** An installed plugin cannot activate on this app: it targets older host
 *  contracts (the plugin needs an update) or newer ones (the app does). */
export const ERR_PLUGIN_UPDATE_REQUIRED = "plugin/update-required";
export const ERR_PLUGIN_APP_UPDATE_REQUIRED = "plugin/app-update-required";
/** Native software update checks and installs (desktop and Android). */
export const ERR_UPDATE_UNAVAILABLE = "update/unavailable";
export const ERR_UPDATE_NOT_READY = "update/not-ready";
export const ERR_UPDATE_NETWORK = "update/network";
export const ERR_UPDATE_INVALID_RELEASE = "update/invalid-release";
export const ERR_UPDATE_INSTALL_FAILED = "update/install-failed";
/** A write to a save target the native save dialog did not issue, or that expired. */
export const ERR_EXPORT_TARGET_INVALID = "export/target-invalid";

/** Sync/relay failure codes (classified in apps/web platform/sync). */
export const ERR_SYNC_NETWORK = "sync/network";
export const ERR_SYNC_SERVER = "sync/server";
export const ERR_SYNC_UNAUTHORIZED = "sync/unauthorized";
export const ERR_SYNC_MISDIRECTED = "sync/misdirected";
export const ERR_SYNC_PASSPHRASE = "sync/passphrase";
export const ERR_SYNC_QUOTA = "sync/quota";
export const ERR_SYNC_FILE_TOO_LARGE = "sync/file-too-large";
/** The relay refused a blob for a reason with no more specific code (4xx). */
export const ERR_SYNC_REJECTED = "sync/rejected";
/** Manifest-only row: this device has no bytes to upload (bookkeeping state). */
export const ERR_SYNC_NO_LOCAL_BYTES = "sync/no-local-bytes";
export const ERR_SYNC_RATE_LIMITED = "sync/rate-limited";
/** The sync backend is a plugin transport that is not registered right now
 *  (plugin disabled, failed to start, or uninstalled). */
export const ERR_SYNC_TRANSPORT_UNAVAILABLE = "sync/transport-unavailable";
/** The plugin transport's endpoint no longer matches the connected one (its
 *  settings changed since connect) — the user must reconnect. */
export const ERR_SYNC_TRANSPORT_MISMATCH = "sync/transport-mismatch";

/** The device is still backfilling the pre-checkpoint log behind a snapshot
 *  bootstrap; full-log operations (rebuild, verify) wait for it. */
export const ERR_SYNC_LOG_INCOMPLETE = "sync/log-incomplete";
/** A projection checkpoint from another schema/format — ignored, never trusted. */
export const ERR_SYNC_CHECKPOINT_MISMATCH = "sync/checkpoint-mismatch";
/** A checkpoint operation's precondition failed (unconfirmed events, non-empty
 *  log, no cursor); the caller retries later, nothing is broken. */
export const ERR_SYNC_CHECKPOINT_PRECONDITION = "sync/checkpoint-precondition";
/** AI provider failure codes (classified in @read-aware/agent). */
export const ERR_AI_NOT_CONFIGURED = "ai/not-configured";
/** BYOK public web search/fetch failures; separate from the model account. */
export const ERR_SEARCH_NOT_CONFIGURED = "search/not-configured";
export const ERR_SEARCH_AUTH = "search/auth";
export const ERR_SEARCH_ACCESS = "search/access";
export const ERR_SEARCH_RATE_LIMITED = "search/rate-limited";
export const ERR_SEARCH_NETWORK = "search/network";
export const ERR_SEARCH_TIMEOUT = "search/timeout";
export const ERR_SEARCH_CANCELLED = "search/cancelled";
export const ERR_SEARCH_INVALID_INPUT = "search/invalid-input";
export const ERR_SEARCH_PROVIDER = "search/provider";
export const ERR_SEARCH_FETCH_FAILED = "search/fetch-failed";
export const ERR_SEARCH_TOO_LARGE = "search/too-large";
export const ERR_AI_MEMORY_DISABLED = "ai/memory-disabled";
export const ERR_AI_CONTEXT_CHANGED = "ai/context-changed";
export const ERR_AI_CONTEXT_WITHHELD = "ai/context-withheld";
export const ERR_AI_INVALID_READING_CONTEXT = "ai/invalid-reading-context";
export const ERR_AI_AUTH = "ai/auth";
export const ERR_AI_RATE_LIMITED = "ai/rate-limited";
export const ERR_AI_QUOTA = "ai/quota";
export const ERR_AI_NETWORK = "ai/network";
export const ERR_AI_PROVIDER = "ai/provider";
export const ERR_AI_CONTEXT_OVERFLOW = "ai/context-overflow";
export const ERR_AI_UNKNOWN = "ai/unknown";
export const ERR_AI_REQUEST_CANCELLED = "ai/request-cancelled";
export const ERR_AI_REQUEST_TIMEOUT = "ai/request-timeout";
export const ERR_AI_BUSY = "ai/busy";

/** Imported font file is not a parseable/supported font. */
export const ERR_FONT_INVALID = "font/invalid";
/** Imported font file exceeds the size cap. */
export const ERR_FONT_TOO_LARGE = "font/too-large";
/** Byte release was requested for a font still in the registry. */
export const ERR_FONT_STILL_PRESENT = "font/still-present";
/** Projections are mid-rebuild; releasing files must wait for recovery. */
export const ERR_FONT_CLEANUP_STALE = "font/cleanup-stale";

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
  return new Error(typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)), {
    cause: value,
  });
}
