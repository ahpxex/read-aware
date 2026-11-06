//! Desktop storage facade. The store itself (schema, event log, projections,
//! blobs) lives in the shared `read_aware_store` crate; this module re-exports
//! it so `crate::storage::*` paths keep working, and adds what only the
//! desktop app has: the IPC command wrappers, their executor, and the full
//! backup pipeline (which needs the bundled plugins, dialogs and progress
//! channels).

pub use read_aware_store::storage::*;

// The backup modules below reach these through `use super::*`.
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

mod execution;
pub(crate) use execution::blocking;
// Only AppKit (macOS) and the Android activity need the UI thread.
#[cfg(any(target_os = "macos", target_os = "android"))]
pub(crate) use execution::on_main_thread;

mod commands;
pub use commands::*;

pub(crate) mod backup_archive;
pub(crate) mod backup_export;
pub(crate) mod backup_import;
mod backup_restore_events;
pub(crate) mod backup_snapshot;
pub(crate) mod backup_staging;
pub(crate) mod backup_tasks;
