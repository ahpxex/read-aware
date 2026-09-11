//! "Open with ReadAware" requests arriving from the OS: file paths in the
//! launch argv (Windows/Linux file associations), the argv of a second-instance
//! launch relayed by the single-instance plugin, and macOS Apple Events
//! (`RunEvent::Opened`). Paths park in a queue because the webview may not be
//! mounted yet when they arrive; the frontend drains the queue once on boot and
//! again on every `external-open-request` ping, so no ordering between the two
//! sides can drop a request.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::CommandError;
use tauri::{AppHandle, Emitter, Manager};

/// Extensions the importer accepts. Keep in sync with `BOOK_FILE_EXTENSIONS`
/// in `apps/web/src/features/library/lib/pick-book-files.ts`.
const BOOK_EXTENSIONS: [&str; 14] = [
    "epub", "mobi", "prc", "azw3", "azw", "kf8", "fb2", "fbz", "cbz", "cbr", "txt", "html", "htm",
    "pdf",
];

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenBatch {
    epoch: String,
    paths: Vec<String>,
}

struct QueueState {
    enabled: Option<bool>,
    epoch: String,
    paths: Vec<String>,
}

impl QueueState {
    fn publish(&mut self, enabled: bool) {
        if self.enabled != Some(enabled) {
            self.epoch = uuid::Uuid::new_v4().to_string();
            self.enabled = Some(enabled);
        }
        if !enabled {
            self.paths.clear();
        }
    }
}

/// Policy publication and draining share a lock, including at cold start.
pub struct ExternalOpenQueue(Mutex<QueueState>);

impl ExternalOpenQueue {
    pub fn new(paths: Vec<String>) -> Self {
        Self(Mutex::new(QueueState {
            enabled: None,
            epoch: uuid::Uuid::new_v4().to_string(),
            paths,
        }))
    }

    pub(crate) fn publish(&self, enabled: bool) -> Result<(), CommandError> {
        self.0.lock()?.publish(enabled);
        Ok(())
    }

    pub(crate) fn commit<T>(
        &self,
        enabled: bool,
        reset: bool,
        persist: impl FnOnce() -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let mut state = self.0.lock()?;
        let result = persist()?;
        state.publish(enabled);
        if reset {
            state.paths.clear();
            state.epoch = uuid::Uuid::new_v4().to_string();
        }
        Ok(result)
    }

    fn park(&self, paths: Vec<String>) -> Result<bool, CommandError> {
        let mut state = self.0.lock()?;
        if paths.is_empty() || state.enabled == Some(false) {
            return Ok(false);
        }
        state.paths.extend(paths);
        Ok(state.enabled == Some(true))
    }

    fn take(&self) -> Result<ExternalOpenBatch, CommandError> {
        let mut state = self.0.lock()?;
        if state.enabled.is_none() {
            return Err(CommandError::new(
                "settings/unavailable",
                "External file policy has not loaded",
            ));
        }
        Ok(ExternalOpenBatch {
            epoch: state.epoch.clone(),
            paths: std::mem::take(&mut state.paths),
        })
    }

    fn is_current(&self, epoch: &str) -> Result<bool, CommandError> {
        let state = self.0.lock()?;
        Ok(state.enabled == Some(true) && state.epoch == epoch)
    }

    /// Admission is the import's start boundary. Once accepted, staging may
    /// finish without holding this lock across file I/O or acquiring Db under it.
    pub(crate) fn admit(&self, epoch: &str) -> Result<(), CommandError> {
        if self.is_current(epoch)? {
            Ok(())
        } else {
            Err(CommandError::new(
                "ui/unavailable",
                "External file request was revoked before native import admission",
            ))
        }
    }
}

pub fn is_book_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            BOOK_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(ext))
        })
}

/// The deep-link plugin also forwards file:// Apple Events. Only application
/// links may bypass the file-intake policy to bring the window forward.
pub fn is_app_link_scheme(scheme: &str) -> bool {
    scheme == "readaware"
}

/// Book files among raw launch/relaunch args. Skips flags and anything that is
/// not an existing file; relative paths resolve against `cwd` (the SECOND
/// instance's working directory when relayed by single-instance, not ours).
pub fn collect_book_paths<I, S>(args: I, cwd: Option<&Path>) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| {
            let arg = arg.as_ref();
            if arg.is_empty() || arg.starts_with('-') {
                return None;
            }
            let raw = PathBuf::from(arg);
            let path = match (raw.is_absolute(), cwd) {
                (false, Some(cwd)) => cwd.join(raw),
                _ => raw,
            };
            (is_book_path(&path) && path.is_file()).then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

/// Park paths for the webview and ping it. Also surfaces the main window —
/// every caller is a "user just asked the OS to open a book" moment.
/// (Desktop only: mobile WebviewWindow has no show/unminimize/set_focus, and
/// nothing calls park there anyway — the module compiles everywhere because
/// its command is registered unconditionally.)
pub fn park(app: &AppHandle, paths: Vec<String>) {
    let queue = app.state::<ExternalOpenQueue>();
    match queue.park(paths) {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            log::error!("Accepting external files failed: {error}");
            return;
        }
    }
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    // A not-yet-mounted frontend misses this and drains on boot instead.
    let _ = app.emit("external-open-request", ());
}

/// Drain the parked queue. The frontend owns dedupe/import from here.
#[tauri::command]
pub fn external_open_take(
    state: tauri::State<'_, ExternalOpenQueue>,
) -> Result<ExternalOpenBatch, CommandError> {
    state.take()
}

#[tauri::command]
pub fn external_open_is_current(
    state: tauri::State<'_, ExternalOpenQueue>,
    epoch: String,
) -> Result<bool, CommandError> {
    state.is_current(&epoch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_import_admission_rejects_revoked_batches_even_after_reopening() {
        let queue = ExternalOpenQueue::new(vec!["cold.epub".into()]);
        queue.publish(true).unwrap();
        let batch = queue.take().unwrap();
        queue.admit(&batch.epoch).unwrap();
        queue.commit(false, false, || Ok(())).unwrap();
        assert_eq!(queue.admit(&batch.epoch).unwrap_err().code, "ui/unavailable");
        queue.commit(true, false, || Ok(())).unwrap();
        assert!(queue.admit(&batch.epoch).is_err());
        queue.admit(&queue.take().unwrap().epoch).unwrap();
    }

    #[test]
    fn file_urls_cannot_use_the_auth_link_focus_path() {
        assert!(is_app_link_scheme("readaware"));
        assert!(!is_app_link_scheme("file"));
        assert!(!is_app_link_scheme("https"));
    }

    #[test]
    fn bundle_associations_cover_every_supported_external_book_extension() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut extensions: Vec<&str> = config["bundle"]["fileAssociations"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|entry| {
                entry["ext"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_str().unwrap())
            })
            .collect();
        extensions.sort();
        let mut accepted = BOOK_EXTENSIONS.to_vec();
        accepted.sort();
        assert_eq!(extensions, accepted);
    }

    #[test]
    fn cold_and_warm_requests_wait_for_policy_and_disabled_files_never_replay() {
        let queue = ExternalOpenQueue::new(vec!["cold.epub".into()]);
        assert_eq!(queue.take().unwrap_err().code, "settings/unavailable");
        assert!(!queue.park(vec!["before-ready.epub".into()]).unwrap());
        queue.publish(false).unwrap();
        assert!(queue.take().unwrap().paths.is_empty());
        assert!(!queue.park(vec!["disabled.epub".into()]).unwrap());
        queue.publish(true).unwrap();
        assert!(queue.take().unwrap().paths.is_empty());
        assert!(queue.park(vec!["new.epub".into()]).unwrap());
        assert_eq!(queue.take().unwrap().paths, ["new.epub"]);
    }

    #[test]
    fn successful_disable_revokes_drained_batches_even_after_reenable() {
        let queue = ExternalOpenQueue::new(vec!["first.epub".into()]);
        queue.publish(true).unwrap();
        let batch = queue.take().unwrap();
        assert!(queue.is_current(&batch.epoch).unwrap());
        queue.park(vec!["parked.epub".into()]).unwrap();
        queue.commit(false, false, || Ok(())).unwrap();
        queue.commit(true, false, || Ok(())).unwrap();
        assert!(!queue.is_current(&batch.epoch).unwrap());
        assert!(queue.take().unwrap().paths.is_empty());
        queue.park(vec!["new.epub".into()]).unwrap();
        let next = queue.take().unwrap();
        assert!(queue.is_current(&next.epoch).unwrap());
    }

    #[test]
    fn failed_sqlite_commit_preserves_policy_epoch_and_parked_files() {
        let queue = ExternalOpenQueue::new(vec![]);
        queue.publish(true).unwrap();
        let epoch = queue.take().unwrap().epoch;
        queue.park(vec!["kept.epub".into()]).unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_kv (value TEXT); CREATE TRIGGER reject BEFORE INSERT ON app_kv BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
        let result = queue.commit(false, false, || {
            conn.execute("INSERT INTO app_kv VALUES ('disabled')", [])?;
            Ok(())
        });
        assert_eq!(result.unwrap_err().code, "db/error");
        assert!(queue.is_current(&epoch).unwrap());
        assert_eq!(queue.take().unwrap().paths, ["kept.epub"]);
    }

    #[test]
    fn unchanged_general_preferences_do_not_revoke_active_batches() {
        let queue = ExternalOpenQueue::new(vec![]);
        queue.publish(true).unwrap();
        let epoch = queue.take().unwrap().epoch;
        queue.commit(true, false, || Ok(())).unwrap();
        assert!(queue.is_current(&epoch).unwrap());
    }

    #[test]
    fn deleting_preferences_or_wiping_data_invalidates_even_enabled_batches() {
        let queue = ExternalOpenQueue::new(vec![]);
        queue.publish(true).unwrap();
        let epoch = queue.take().unwrap().epoch;
        queue.park(vec!["before-reset.epub".into()]).unwrap();
        queue.commit(true, true, || Ok(())).unwrap();
        assert!(!queue.is_current(&epoch).unwrap());
        assert!(queue.take().unwrap().paths.is_empty());
    }

    #[test]
    fn collect_filters_flags_and_non_books() {
        let dir = tempfile::tempdir().unwrap();
        let book = dir.path().join("story.EPUB");
        std::fs::write(&book, b"x").unwrap();
        let other = dir.path().join("notes.docx");
        std::fs::write(&other, b"x").unwrap();

        let collected = collect_book_paths(
            [
                "--flag",
                book.to_str().unwrap(),
                other.to_str().unwrap(),
                "missing.epub",
            ],
            None,
        );
        assert_eq!(collected, vec![book.to_string_lossy().into_owned()]);
    }

    #[test]
    fn collect_resolves_relative_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("book.pdf"), b"x").unwrap();

        let collected = collect_book_paths(["book.pdf"], Some(dir.path()));
        assert_eq!(
            collected,
            vec![dir.path().join("book.pdf").to_string_lossy().into_owned()]
        );
    }
}
