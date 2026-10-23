//! iOS export picker: `ExportPickBridge.m` presents a
//! `UIDocumentPickerViewController` in export mode over a staged file and the
//! delegate reports the outcome straight back into Rust (`ra_export_pick_finished`)
//! — no parked JSON, no polling.
//!
//! This exists because tauri-plugin-dialog's iOS `save_file` writes an empty
//! placeholder and copies it during presentation — before our bytes exist, and
//! to a path that is not writable afterwards. The export picker copies a
//! *staged* file instead: see `save_targets::StagedExport`.

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, LazyLock, Mutex, OnceLock};

use crate::error::CommandError;

type Outcome = Result<bool, CommandError>;

/// The bridge's `start` entry point, handed over from its load-time
/// constructor — release builds strip the export table a runtime symbol
/// lookup would need (see `FolderPickBridge.m`).
static BRIDGE: OnceLock<extern "C" fn(u64, *const c_char)> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: LazyLock<Mutex<HashMap<u64, mpsc::Sender<Outcome>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[no_mangle]
pub extern "C" fn ra_register_export_pick_bridge(start: extern "C" fn(u64, *const c_char)) {
    let _ = BRIDGE.set(start);
}

/// Called by the picker delegate once the export resolves. `status`: 0
/// exported, 1 cancelled, 2 failed (with an optional C-string detail).
#[no_mangle]
pub extern "C" fn ra_export_pick_finished(id: u64, status: i32, error: *const c_char) {
    // SAFETY: the bridge passes null or a NUL-terminated string literal that
    // outlives this call.
    let message = (!error.is_null()).then(|| {
        unsafe { CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned()
    });
    let outcome = match status {
        0 => Ok(true),
        1 => Ok(false),
        _ => Err(CommandError::internal(
            message.unwrap_or_else(|| "export pick failed".to_owned()),
        )),
    };
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(sender) = pending.remove(&id) {
            let _ = sender.send(outcome);
        }
    }
}

/// Present the export picker for `staged` and block the (dedicated blocking)
/// thread until the user exports or cancels. `true` = exported.
pub(crate) fn present(staged: &Path) -> Result<bool, CommandError> {
    let start = *BRIDGE
        .get()
        .ok_or_else(|| CommandError::internal("ExportPickBridge was not registered"))?;
    let path = CString::new(staged.as_os_str().as_bytes())
        .map_err(|_| CommandError::internal("staged export path contains NUL"))?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    PENDING.lock()?.insert(id, sender);
    start(id, path.as_ptr());
    receiver
        .recv()
        .map_err(|_| CommandError::internal("export pick bridge dropped"))?
}
