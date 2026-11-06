//! Read-back of the app's own log files (written by tauri-plugin-log into the
//! OS log dir) so the frontend can assemble a user-initiated diagnostics
//! bundle — exported to a file or sent to the relay, always explicitly, never
//! automatically. Read-only: nothing here writes or deletes.

use crate::tauri_error::tauri_error;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

use crate::error::CommandError;

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

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_log_dir()
        .map_err(|error| CommandError::context("log directory unavailable", tauri_error(error)))
}

/// The log directory path, for the settings surface ("open log folder").
#[tauri::command]
pub fn diagnostics_log_dir(app: tauri::AppHandle) -> Result<String, CommandError> {
    Ok(log_dir(&app)?.to_string_lossy().into_owned())
}

/// Tails of the app's log files, newest file first, capped at
/// `MAX_TOTAL_BYTES` across the set. Newest-first means the cap always spends
/// its budget on the most recent history.
#[tauri::command]
pub async fn diagnostics_read_logs(
    app: tauri::AppHandle,
) -> Result<Vec<LogFileTail>, CommandError> {
    crate::storage::blocking("diagnostics_read_logs", move || {
        read_log_tails(&log_dir(&app)?)
    })
    .await
}

fn read_log_tails(dir: &Path) -> Result<Vec<LogFileTail>, CommandError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // No directory yet = nothing has ever logged; an empty bundle is the
        // honest answer. Any other failure is a failed read, not "no logs".
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(CommandError::context(
                "could not list the log directory",
                error,
            ))
        }
    };

    let mut files: Vec<(String, u64, PathBuf)> = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|error| CommandError::context("could not list the log directory", error))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(LOG_FILE_PREFIX) || !name.ends_with(".log") {
            continue;
        }
        let modified = match entry.metadata().and_then(|metadata| metadata.modified()) {
            Ok(modified) => modified,
            // Rotation deleted it between listing and inspection.
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(CommandError::context(
                    &format!("could not inspect {name}"),
                    error,
                ))
            }
        };
        let modified_ms = modified
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        files.push((name, modified_ms, entry.path()));
    }
    files.sort_by_key(|file| std::cmp::Reverse(file.1));

    let mut remaining = MAX_TOTAL_BYTES;
    let mut tails = Vec::new();
    for (name, modified_ms, path) in files {
        if remaining == 0 {
            break;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(CommandError::context(
                    &format!("could not read {name}"),
                    error,
                ))
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_log_directory_is_empty_but_an_unreadable_one_fails() {
        let root = tempfile::tempdir().unwrap();
        assert!(read_log_tails(&root.path().join("never-logged"))
            .unwrap()
            .is_empty());
        let not_a_dir = root.path().join("file");
        fs::write(&not_a_dir, "x").unwrap();
        assert!(read_log_tails(&not_a_dir).is_err());
    }

    #[test]
    fn newest_logs_are_tailed_first_within_the_budget() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("other.txt"), "ignored").unwrap();
        fs::write(root.path().join("readaware_old.log"), "old").unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(root.path().join("readaware_old.log"))
            .unwrap()
            .set_modified(old)
            .unwrap();
        fs::write(
            root.path().join("readaware.log"),
            "x".repeat(MAX_TOTAL_BYTES + 10),
        )
        .unwrap();
        let tails = read_log_tails(root.path()).unwrap();
        assert_eq!(tails.len(), 1);
        assert_eq!(tails[0].name, "readaware.log");
        assert!(tails[0].truncated);
        assert_eq!(tails[0].text.len(), MAX_TOTAL_BYTES);
    }
}
