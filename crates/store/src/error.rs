//! The desktop backend's structured command error.
//!
//! Commands return `Result<T, CommandError>`; Tauri serializes the error as
//! `{ "code": "...", "message": "..." }`, and the frontend's `invoke` seam
//! (apps/web/src/platform/ipc.ts) turns that into an `IpcError` carrying the
//! same stable code. Codes let the UI distinguish causes ("file missing" vs
//! "disk full" vs "database locked") without substring-matching prose; the
//! message stays developer-facing detail for the log file.
//!
//! The code vocabulary is shared with @read-aware/core (packages/core/src/
//! errors.ts) — add new codes there first, and never rename one: persisted
//! surfaces and localized copy match on them.
//!
//! Legacy commands still returning `Result<T, String>` remain valid — the
//! frontend maps those to the `ipc/unknown` code. Migrate a command by
//! switching its signature and letting `?` classify through the `From` impls
//! below; use `CommandError::context` where the old code prefixed a
//! `format!("...: {e}")` context string.

use serde::Serialize;

pub const CODE_INTERNAL: &str = "internal";
pub const CODE_DB_ERROR: &str = "db/error";
pub const CODE_DB_LOCKED: &str = "db/locked";
pub const CODE_FS_NOT_FOUND: &str = "fs/not-found";
pub const CODE_FS_PERMISSION: &str = "fs/permission";
pub const CODE_FS_NO_SPACE: &str = "fs/no-space";
pub const CODE_SECRETS_UNAVAILABLE: &str = "secrets/unavailable";
/// A plugin folder/zip/payload that is not a valid plugin package.
pub const CODE_PLUGIN_INVALID_PACKAGE: &str = "plugin/invalid-package";
pub const CODE_PLUGIN_INVALID_ARGUMENT: &str = "plugin/invalid-argument";
/// Built-in plugins ship with the app: never replaced or uninstalled.
pub const CODE_PLUGIN_BUILT_IN: &str = "plugin/built-in";
/// A staged candidate that is gone or no longer matches its update baseline.
pub const CODE_PLUGIN_CANDIDATE_STALE: &str = "plugin/candidate-stale";
pub const CODE_PLUGIN_NO_PREVIOUS_VERSION: &str = "plugin/no-previous-version";
/// Software updates: disabled for this installation or platform.
pub const CODE_UPDATE_UNAVAILABLE: &str = "update/unavailable";
/// Install requested without a checked, parked update.
pub const CODE_UPDATE_NOT_READY: &str = "update/not-ready";
pub const CODE_UPDATE_NETWORK: &str = "update/network";
/// The release manifest or artifact failed validation or verification.
pub const CODE_UPDATE_INVALID_RELEASE: &str = "update/invalid-release";
pub const CODE_UPDATE_INSTALL_FAILED: &str = "update/install-failed";
/// A save target that the native save dialog did not issue (or that expired).
pub const CODE_EXPORT_TARGET_INVALID: &str = "export/target-invalid";
/// A picked file is not a parseable/supported font.
pub const CODE_FONT_INVALID: &str = "font/invalid";
/// A picked font file exceeds the size cap.
pub const CODE_FONT_TOO_LARGE: &str = "font/too-large";
/// A byte release was refused because the registry row still exists.
pub const CODE_FONT_STILL_PRESENT: &str = "font/still-present";
/// A byte release raced with projection recovery — retry after it settles.
pub const CODE_FONT_CLEANUP_STALE: &str = "font/cleanup-stale";

#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    /// A failure with no more specific cause — validation, invariants, task
    /// plumbing. Distinct from the classified codes so the UI's generic copy
    /// path handles it.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(CODE_INTERNAL, message)
    }

    /// Prefix a context string onto a classified cause, keeping its code.
    /// Replaces the old `map_err(|e| format!("{context}: {e}"))` shape.
    pub fn context(context: &str, source: impl Into<CommandError>) -> Self {
        let inner = source.into();
        Self {
            code: inner.code,
            message: format!("{context}: {}", inner.message),
        }
    }

    /// Like `context`, but re-codes the failure: for causes whose most useful
    /// identity is the subsystem that failed (e.g. any key-file problem means
    /// "the secret store is unavailable"), not the underlying fs/db detail.
    pub fn context_coded(code: &str, context: &str, source: impl Into<CommandError>) -> Self {
        let inner = source.into();
        Self::new(code, format!("{context}: {}", inner.message))
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<rusqlite::Error> for CommandError {
    fn from(error: rusqlite::Error) -> Self {
        let code = match &error {
            rusqlite::Error::SqliteFailure(inner, _) => match inner.code {
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked => {
                    CODE_DB_LOCKED
                }
                rusqlite::ErrorCode::DiskFull => CODE_FS_NO_SPACE,
                _ => CODE_DB_ERROR,
            },
            _ => CODE_DB_ERROR,
        };
        Self::new(code, error.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        // `StorageFull` covers ENOSPC and Windows' disk-full codes alike.
        let code = match error.kind() {
            std::io::ErrorKind::StorageFull => CODE_FS_NO_SPACE,
            std::io::ErrorKind::NotFound => CODE_FS_NOT_FOUND,
            std::io::ErrorKind::PermissionDenied => CODE_FS_PERMISSION,
            _ => CODE_INTERNAL,
        };
        Self::new(code, error.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error.to_string())
    }
}

/// A poisoned Mutex means another thread panicked mid-update of in-memory
/// state (sessions, grants, queues). The SQLite connection does not surface
/// this: `storage::SharedConnection` recovers its lock instead.
impl<T> From<std::sync::PoisonError<T>> for CommandError {
    fn from(error: std::sync::PoisonError<T>) -> Self {
        Self::new(CODE_DB_ERROR, format!("state lock poisoned: {error}"))
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(error.to_string())
    }
}

/// Bare-string errors from validation/`format!` sites that predate the typed
/// error: honest fallback is the unclassified `internal` code. New code should
/// prefer `CommandError::new`/`context` with a real code.
impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::internal(message)
    }
}
