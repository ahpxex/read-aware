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
        // ENOSPC by raw errno: `ErrorKind::StorageFull` is not stable on our
        // minimum toolchain (1.77).
        let code = if error.raw_os_error() == Some(28) {
            CODE_FS_NO_SPACE
        } else {
            match error.kind() {
                std::io::ErrorKind::NotFound => CODE_FS_NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => CODE_FS_PERMISSION,
                _ => CODE_INTERNAL,
            }
        };
        Self::new(code, error.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error.to_string())
    }
}

/// A poisoned Mutex means another thread panicked mid-write; the connection's
/// state is suspect, which is a database-layer failure from the caller's view.
impl<T> From<std::sync::PoisonError<T>> for CommandError {
    fn from(error: std::sync::PoisonError<T>) -> Self {
        Self::new(CODE_DB_ERROR, format!("storage lock poisoned: {error}"))
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
