//! ReadAware's on-device store, shared by the desktop app and the `ra` CLI.
//!
//! SQLite is the source of truth: `storage::events` appends to the domain event
//! log and `storage::apply` updates the projections in the same transaction.
//! Blob bytes live under `<data_dir>/blobs/`. Nothing here depends on Tauri;
//! the desktop crate wraps these functions in IPC commands and owns every OS
//! and webview integration.

pub mod book_metadata;
pub mod comic_metadata;
pub mod covers;
pub mod desktop_preferences;
pub mod error;
pub mod fb2_metadata;
pub mod import;
pub mod metadata;
pub mod mobi_metadata;
pub mod pdf_metadata;
pub mod plugin_id;
pub mod secrets;
pub mod storage;
