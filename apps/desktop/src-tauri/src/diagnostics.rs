//! Read-back of the app's own log files (written by tauri-plugin-log into the
//! OS log dir) so the frontend can assemble a user-initiated diagnostics
//! bundle — exported to a file or sent to the relay, always explicitly, never
//! automatically. Read-only: nothing here writes or deletes.

use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

/// Total tail budget across all files: enough for days of Info-level logging,
/// small enough to keep a diagnostics upload bounded.
const MAX_TOTAL_BYTES: usize = 256 * 1024;

/// Log file names as tauri-plugin-log writes them: `readaware.log` plus
/// `readaware_<timestamp>.log` rotations (see build_log_plugin in lib.rs).
const LOG_FILE_PREFIX: &str = "readaware";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileTail {
    pub name: String,
    pub modified_ms: u64,
    /// UTF-8 tail of the file; when `truncated`, it may start mid-line.
    pub text: String,
    pub truncated: bool,
}

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|error| format!("log directory unavailable: {error}"))
}

/// The log directory path, for the settings surface ("open log folder").
#[tauri::command]
pub fn diagnostics_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(log_dir(&app)?.to_string_lossy().into_owned())
}

/// Tails of the app's log files, newest file first, capped at
/// `MAX_TOTAL_BYTES` across the set. Newest-first means the cap always spends
/// its budget on the most recent history.
#[tauri::command]
pub fn diagnostics_read_logs(app: tauri::AppHandle) -> Result<Vec<LogFileTail>, String> {
    let dir = log_dir(&app)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // No directory yet = nothing has ever logged; an empty bundle is the
        // honest answer, not an error.
        Err(_) => return Ok(Vec::new()),
    };

    let mut files: Vec<(String, u64, PathBuf)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with(LOG_FILE_PREFIX) || !name.ends_with(".log") {
                return None;
            }
            let modified_ms = entry
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((name, modified_ms, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));

    let mut remaining = MAX_TOTAL_BYTES;
    let mut tails = Vec::new();
    for (name, modified_ms, path) in files {
        if remaining == 0 {
            break;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let truncated = bytes.len() > remaining;
        let tail = if truncated {
            &bytes[bytes.len() - remaining..]
        } else {
            &bytes[..]
        };
        remaining -= tail.len();
        tails.push(LogFileTail {
            name,
            modified_ms,
            text: String::from_utf8_lossy(tail).into_owned(),
            truncated,
        });
    }
    Ok(tails)
}
