//! `tauri::Error` → `CommandError`. `CommandError` lives in the Tauri-free
//! store crate, so neither crate may implement `From<tauri::Error>` for it
//! (the orphan rule); desktop code maps Tauri failures through this instead.
use crate::error::CommandError;

/// Tauri's own failures (paths, windows, the main-thread hop) have no more
/// specific classification than `internal`.
pub(crate) fn tauri_error(error: tauri::Error) -> CommandError {
    CommandError::internal(error.to_string())
}
