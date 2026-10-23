//! Save destinations the user picked in a native save dialog.
//!
//! The webview never names a writable path. A native command opens the save
//! dialog and records whatever the user picked as a grant; every command that
//! writes a user-visible file accepts only such a grant. A compromised or
//! buggy webview can therefore write only where the user just agreed to save,
//! once. Grants come in two lifetimes:
//!
//! - token grants: an opaque, single-use token valid for `TARGET_LIFETIME`,
//!   for one-shot writes (`write_export_file`, `resource_save`);
//! - session grants: bound to one window's native task (the full backup
//!   export), valid until that task writes, is cancelled, or its window is
//!   destroyed. Preparing and capturing a large library can outlast any fixed
//!   lifetime, and the grant is useless outside that task.
//!
//! Checked alternatives: the dialog plugin's fs-scope grant is process-wide
//! and permanent, and also covers every file the user ever OPENED (picked
//! books), so it cannot express "this save, once".

use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
#[cfg(not(target_os = "ios"))]
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::FilePath;

use crate::error::{CommandError, CODE_EXPORT_TARGET_INVALID};

/// Long enough to serialize a large export, short enough that a stale token
/// is useless.
pub(crate) const TARGET_LIFETIME: Duration = Duration::from_secs(10 * 60);

fn invalid_target() -> CommandError {
    CommandError::new(
        CODE_EXPORT_TARGET_INVALID,
        "save target was not chosen in the save dialog, was used, or expired",
    )
}

/// A save destination recorded by a grant. On iOS the dialog plugin's save
/// picker cannot produce one — it writes an empty placeholder into Documents
/// and copies it out *during* presentation, before any bytes exist — so the
/// grant there defers the choice: `Export` stages the finished file and the
/// platform export picker moves it (`StagedExport::present`).
#[derive(Debug)]
pub(crate) enum SaveTarget {
    /// A concrete destination the user picked in the save dialog.
    #[cfg_attr(target_os = "ios", allow(dead_code))]
    Picked(FilePath),
    /// iOS: destination is decided later by the export picker; only a
    /// sanitized basename is carried.
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    Export { filename: String },
}

#[derive(Default)]
struct Grants {
    tokens: HashMap<String, (SaveTarget, Instant)>,
    /// One pending session grant per window: a newer choice replaces it.
    sessions: HashMap<String, (String, SaveTarget)>,
}

/// Save destinations the user picked, by single-use token or task session.
#[derive(Default)]
pub struct SaveTargets(Mutex<Grants>);

impl SaveTargets {
    pub(crate) fn issue(&self, target: SaveTarget, now: Instant) -> Result<String, CommandError> {
        let token = uuid::Uuid::new_v4().to_string();
        let mut grants = self.0.lock()?;
        grants
            .tokens
            .retain(|_, (_, issued)| now.duration_since(*issued) < TARGET_LIFETIME);
        grants.tokens.insert(token.clone(), (target, now));
        Ok(token)
    }

    pub(crate) fn redeem(&self, token: &str, now: Instant) -> Result<SaveTarget, CommandError> {
        let issued = self.0.lock()?.tokens.remove(token);
        match issued {
            Some((target, at)) if now.duration_since(at) < TARGET_LIFETIME => Ok(target),
            _ => Err(invalid_target()),
        }
    }

    pub(crate) fn bind_session(
        &self,
        owner: &str,
        session: &str,
        target: SaveTarget,
    ) -> Result<(), CommandError> {
        self.0
            .lock()?
            .sessions
            .insert(owner.to_owned(), (session.to_owned(), target));
        Ok(())
    }

    /// Consumes the owner's grant for `session`; a grant for another session
    /// of the same owner stays in place.
    pub(crate) fn redeem_session(
        &self,
        owner: &str,
        session: &str,
    ) -> Result<SaveTarget, CommandError> {
        let mut grants = self.0.lock()?;
        match grants.sessions.get(owner) {
            Some((bound, _)) if bound == session => grants
                .sessions
                .remove(owner)
                .map(|(_, target)| target)
                .ok_or_else(invalid_target),
            _ => Err(invalid_target()),
        }
    }

    pub(crate) fn release_session(&self, owner: &str, session: &str) -> Result<(), CommandError> {
        let mut grants = self.0.lock()?;
        if grants
            .sessions
            .get(owner)
            .is_some_and(|(bound, _)| bound == session)
        {
            grants.sessions.remove(owner);
        }
        Ok(())
    }

    pub fn release_owner(&self, owner: &str) {
        match self.0.lock() {
            Ok(mut grants) => {
                grants.sessions.remove(owner);
            }
            Err(error) => log::warn!("save target owner cleanup failed: {error}"),
        }
    }
}

/// Open the native save dialog. `None` when the user cancels.
pub(crate) async fn choose(
    app: &tauri::AppHandle,
    filename: String,
    filter: Option<(String, String)>,
) -> Result<Option<SaveTarget>, CommandError> {
    // iOS presents no dialog here: its save picker can only export a finished
    // file, so the choice is deferred to `StagedExport::present`. The grant
    // still records the user consented to *this* filename.
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return Ok(Some(SaveTarget::Export {
            filename: sanitize_export_filename(
                &filename,
                filter.as_ref().map(|(_, extension)| extension.as_str()),
            ),
        }));
    }
    #[cfg(not(target_os = "ios"))]
    {
        let mut dialog = app.dialog().file().set_file_name(filename);
        if let Some((name, extension)) = filter {
            dialog = dialog.add_filter(name, &[extension.as_str()]);
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        dialog.save_file(move |picked| {
            // The waiter only disappears if the command itself was dropped.
            let _ = sender.send(picked);
        });
        receiver
            .await
            .map(|picked| picked.map(SaveTarget::Picked))
            .map_err(|_| CommandError::internal("save dialog closed without a result"))
    }
}

/// A basename safe for the iOS export picker: separators and control
/// characters removed; `.`, `..` and empty names fall back to `export` plus
/// the original extension.
#[cfg(any(target_os = "ios", test))]
fn sanitize_export_filename(filename: &str, extension: Option<&str>) -> String {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or_default();
    let stripped: String = base.chars().filter(|ch| !ch.is_control()).collect();
    let clean = stripped.trim();
    if clean.is_empty() || clean == "." || clean == ".." {
        return match extension
            .map(str::trim)
            .filter(|ext| !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        {
            Some(ext) => format!("export.{ext}"),
            None => "export".to_owned(),
        };
    }
    clean.to_owned()
}

/// Streams content into a staged file. The file is synced afterwards.
pub(crate) type Produce<'a> = Box<dyn FnOnce(&mut File) -> Result<(), CommandError> + 'a>;

/// The outcome of `publish`: `Done` when the bytes already reached the
/// destination; `Export` when a staged file still needs the iOS export picker
/// — presented only after the caller released its locks, so a picker is never
/// open while a mutex or task lease is held.
pub(crate) enum Delivery {
    Done,
    Export(StagedExport),
}

/// A produced file staged for the iOS export picker at
/// `export-staging/<uuid>/<filename>`; the directory is removed when
/// `present` returns and on drop — staged output never outlives the attempt.
/// The staging root is never purged while the app runs (two exports can
/// overlap: a second picker may be open while a first stage still exists);
/// leftovers from a killed process are removed at startup by
/// [`purge_export_staging`].
pub(crate) struct StagedExport {
    root: PathBuf,
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    filename: String,
}

impl StagedExport {
    /// The staged file the export picker copies out.
    #[cfg(any(target_os = "ios", test))]
    pub(crate) fn staged_file(&self) -> PathBuf {
        self.root.join(&self.filename)
    }

    /// Presents the export picker and blocks until it resolves: `true` when
    /// the file was exported, `false` when the user cancelled.
    pub(crate) fn present(self, io: &impl SaveIo) -> Result<bool, CommandError> {
        io.present_export(&self)
    }
}

impl Drop for StagedExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// Publishes produced content to a granted target.
pub(crate) trait SaveIo {
    fn publish(&self, target: SaveTarget, produce: Produce<'_>) -> Result<Delivery, CommandError>;
    /// Moves a staged export into place through the platform picker. Only
    /// reachable on iOS, where `choose` grants `SaveTarget::Export`.
    fn present_export(&self, staged: &StagedExport) -> Result<bool, CommandError>;
}

/// Removes staged exports left behind by a process killed mid-picker. Runs
/// once at app startup on iOS — never while the app runs, where another
/// export's picker may still be copying its stage. A missing staging
/// directory is not an error.
#[cfg(any(target_os = "ios", test))]
pub(crate) fn purge_export_staging(cache_dir: &Path) -> Result<(), CommandError> {
    match std::fs::remove_dir_all(cache_dir.join("export-staging")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => Ok(result?),
    }
}

/// Produce into `<root>/<uuid>/<filename>`: flushed and synced so the
/// picker's copy never sees a partial file. A producer failure removes the
/// stage directory.
fn stage_export(
    root: PathBuf,
    filename: String,
    produce: Produce<'_>,
) -> Result<StagedExport, CommandError> {
    let dir = root.join(uuid::Uuid::new_v4().to_string());
    let result = (|| {
        std::fs::create_dir_all(&dir)?;
        let mut file = File::create(dir.join(&filename))?;
        produce(&mut file)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(StagedExport {
            root: dir,
            filename,
        }),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(error)
        }
    }
}

impl SaveIo for tauri::AppHandle {
    fn publish(&self, target: SaveTarget, produce: Produce<'_>) -> Result<Delivery, CommandError> {
        match target {
            SaveTarget::Picked(FilePath::Path(path)) => {
                replace_path(&path, produce)?;
                Ok(Delivery::Done)
            }
            // A document-provider URI (Android): only the provider can write
            // it, and it cannot be replaced atomically. Stage first so a failed
            // or cancelled producer never truncates the chosen document.
            SaveTarget::Picked(FilePath::Url(url)) => {
                use tauri_plugin_fs::{FsExt, OpenOptions};
                let staging = self.path().app_cache_dir()?.join("save-staging");
                std::fs::create_dir_all(&staging)?;
                let mut staged = tempfile::NamedTempFile::new_in(&staging)?;
                produce(staged.as_file_mut())?;
                staged.as_file_mut().seek(SeekFrom::Start(0))?;
                let mut options = OpenOptions::new();
                options.write(true).create(true).truncate(true);
                let mut file = self.fs().open(FilePath::Url(url), options).map_err(|err| {
                    CommandError::context("Failed to open the save target", err.to_string())
                })?;
                std::io::copy(staged.as_file_mut(), &mut file)?;
                file.flush()?;
                Ok(Delivery::Done)
            }
            SaveTarget::Export { filename } => {
                let root = self.path().app_cache_dir()?.join("export-staging");
                stage_export(root, filename, produce).map(Delivery::Export)
            }
        }
    }

    fn present_export(&self, staged: &StagedExport) -> Result<bool, CommandError> {
        #[cfg(target_os = "ios")]
        {
            crate::export_pick::present(&staged.staged_file())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = staged;
            Err(CommandError::internal(
                "the export picker is only implemented on iOS",
            ))
        }
    }
}

#[cfg(test)]
type TestPresenter = Box<dyn Fn(PathBuf) -> Result<bool, CommandError> + Send + Sync>;

/// Plain filesystem paths only; document-provider targets need the app.
#[cfg(test)]
pub(crate) struct LocalFiles {
    /// Root the `export-staging` directory is created under.
    staging: PathBuf,
    /// Test stand-in for the iOS export picker; receives the staged file.
    present: TestPresenter,
}

#[cfg(test)]
impl LocalFiles {
    /// Picked-path publishing only; an `Export` target cannot be presented.
    pub(crate) fn paths() -> Self {
        Self {
            staging: std::env::temp_dir(),
            present: Box::new(|_| Err(CommandError::internal("LocalFiles has no export presenter")))
                as TestPresenter,
        }
    }

    /// Stages under `staging` and hands the staged file to `present`, the
    /// test's iOS picker stand-in.
    pub(crate) fn exporting(
        staging: PathBuf,
        present: impl Fn(PathBuf) -> Result<bool, CommandError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            staging,
            present: Box::new(present),
        }
    }
}

#[cfg(test)]
impl SaveIo for LocalFiles {
    fn publish(&self, target: SaveTarget, produce: Produce<'_>) -> Result<Delivery, CommandError> {
        match target {
            SaveTarget::Picked(FilePath::Path(path)) => {
                replace_path(&path, produce)?;
                Ok(Delivery::Done)
            }
            SaveTarget::Picked(FilePath::Url(_)) => {
                Err(CommandError::internal("provider targets need the app"))
            }
            SaveTarget::Export { filename } => {
                let root = self.staging.join("export-staging");
                stage_export(root, filename, produce).map(Delivery::Export)
            }
        }
    }

    fn present_export(&self, staged: &StagedExport) -> Result<bool, CommandError> {
        (self.present)(staged.staged_file())
    }
}

/// Replace `path` atomically (sibling temp file + rename), so a failed or
/// cancelled producer keeps the previous file.
pub(crate) fn replace_path(path: &Path, produce: Produce<'_>) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(CODE_EXPORT_TARGET_INVALID, "save target has no parent")
    })?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    produce(temp.as_file_mut())?;
    temp.as_file_mut().flush()?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|err| CommandError::context("Failed to write the saved file", err.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(name: &str) -> SaveTarget {
        SaveTarget::Picked(FilePath::Path(std::env::temp_dir().join(name)))
    }

    #[test]
    fn tokens_are_single_use_expiring_and_unforgeable() {
        let targets = SaveTargets::default();
        let now = Instant::now();
        let token = targets.issue(target("export.json"), now).unwrap();
        assert!(matches!(
            targets.redeem(&token, now).unwrap(),
            SaveTarget::Picked(FilePath::Path(picked)) if picked.ends_with("export.json")
        ));
        assert_eq!(
            targets.redeem(&token, now).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        let forged = std::env::temp_dir().join("export.json");
        assert_eq!(
            targets
                .redeem(forged.to_str().unwrap(), now)
                .unwrap_err()
                .code,
            CODE_EXPORT_TARGET_INVALID
        );
        let stale = targets.issue(target("export.json"), now).unwrap();
        assert_eq!(
            targets
                .redeem(&stale, now + TARGET_LIFETIME)
                .unwrap_err()
                .code,
            CODE_EXPORT_TARGET_INVALID
        );
    }

    #[test]
    fn session_grants_belong_to_one_owner_task_and_are_consumed_once() {
        let targets = SaveTargets::default();
        targets
            .bind_session("main", "task-a", target("a.age"))
            .unwrap();
        assert_eq!(
            targets.redeem_session("other", "task-a").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        assert_eq!(
            targets.redeem_session("main", "task-b").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        // A token is not a session and a session is not a token.
        assert_eq!(
            targets.redeem("task-a", Instant::now()).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        assert!(matches!(
            targets.redeem_session("main", "task-a").unwrap(),
            SaveTarget::Picked(FilePath::Path(picked)) if picked.ends_with("a.age")
        ));
        assert_eq!(
            targets.redeem_session("main", "task-a").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );

        targets
            .bind_session("main", "task-a", target("a.age"))
            .unwrap();
        targets
            .bind_session("main", "task-b", target("b.age"))
            .unwrap();
        assert!(
            targets.redeem_session("main", "task-a").is_err(),
            "a newer choice replaces the grant"
        );
        targets.release_session("main", "task-a").unwrap();
        assert!(
            targets.redeem_session("main", "task-b").is_ok(),
            "another task's release keeps it"
        );

        targets
            .bind_session("main", "task-c", target("c.age"))
            .unwrap();
        targets.release_session("main", "task-c").unwrap();
        assert!(targets.redeem_session("main", "task-c").is_err());
        targets
            .bind_session("main", "task-d", target("d.age"))
            .unwrap();
        targets.release_owner("main");
        assert!(targets.redeem_session("main", "task-d").is_err());
    }

    #[test]
    fn a_path_target_is_replaced_whole_or_not_at_all() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.txt");
        std::fs::write(&path, "previous contents, longer").unwrap();
        replace_path(&path, Box::new(|file| Ok(file.write_all(b"new")?))).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        let failed = replace_path(
            &path,
            Box::new(|file| {
                file.write_all(b"partial")?;
                Err(CommandError::internal("producer failed"))
            }),
        );
        assert!(failed.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn export_targets_stage_then_the_presenter_moves_the_file() {
        let staging = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let moved = destination.path().to_owned();
        let io = LocalFiles::exporting(staging.path().to_owned(), move |file: PathBuf| {
            // The picker sees a complete file: content was synced before it ran.
            assert_eq!(std::fs::read(&file).unwrap(), b"full export");
            std::fs::copy(&file, moved.join(file.file_name().unwrap()))?;
            Ok(true)
        });
        let delivery = io
            .publish(
                SaveTarget::Export {
                    filename: "backup.age".to_owned(),
                },
                Box::new(|file| Ok(file.write_all(b"full export")?)),
            )
            .unwrap();
        let Delivery::Export(staged) = delivery else {
            panic!("an export target must produce a staged export")
        };
        let staged_file = staged.staged_file();
        assert_eq!(std::fs::read(&staged_file).unwrap(), b"full export");
        assert_eq!(
            staged_file.parent().unwrap().parent().unwrap(),
            staging.path().join("export-staging")
        );
        assert!(staged.present(&io).unwrap());
        assert!(!staged_file.exists(), "the stage is removed once presented");
        assert_eq!(
            std::fs::read(destination.path().join("backup.age")).unwrap(),
            b"full export"
        );
    }

    #[test]
    fn export_targets_drop_the_stage_on_cancel_and_producer_failure() {
        let staging = tempfile::tempdir().unwrap();
        let io = LocalFiles::exporting(staging.path().to_owned(), |_: PathBuf| Ok(false));
        let Delivery::Export(staged) = io
            .publish(
                SaveTarget::Export {
                    filename: "a.txt".to_owned(),
                },
                Box::new(|file| Ok(file.write_all(b"x")?)),
            )
            .unwrap()
        else {
            panic!("expected a staged export")
        };
        let staged_file = staged.staged_file();
        assert!(!staged.present(&io).unwrap(), "cancelled at the picker");
        assert!(!staged_file.exists());

        // A producer failure never stages and removes its directory.
        let result = io.publish(
            SaveTarget::Export {
                filename: "b.txt".to_owned(),
            },
            Box::new(|file| {
                file.write_all(b"partial")?;
                Err(CommandError::internal("producer failed"))
            }),
        );
        assert!(result.is_err());
        assert_eq!(
            std::fs::read_dir(staging.path().join("export-staging"))
                .map(|dir| dir.count())
                .unwrap_or(0),
            0
        );
    }

    #[test]
    fn staged_exports_do_not_delete_each_other() {
        let staging = tempfile::tempdir().unwrap();
        let moved = tempfile::tempdir().unwrap();
        let destination = moved.path().to_owned();
        let io = LocalFiles::exporting(staging.path().to_owned(), move |file: PathBuf| {
            std::fs::copy(&file, destination.join(file.file_name().unwrap()))?;
            Ok(true)
        });
        let stage = |name: &str, content: &[u8]| {
            let Delivery::Export(staged) = io
                .publish(
                    SaveTarget::Export {
                        filename: name.to_owned(),
                    },
                    Box::new(move |file| Ok(file.write_all(content)?)),
                )
                .unwrap()
            else {
                panic!("expected a staged export")
            };
            staged
        };
        // A second export while the first picker's stage still exists must not
        // remove it — staging roots are per-export, never purged at publish.
        let first = stage("a.txt", b"first");
        let first_file = first.staged_file();
        let second = stage("b.txt", b"second");
        assert!(first_file.exists());
        assert!(second.staged_file().exists());
        assert!(first.present(&io).unwrap());
        assert_eq!(std::fs::read(moved.path().join("a.txt")).unwrap(), b"first");
        assert!(second.present(&io).unwrap());
        assert_eq!(
            std::fs::read(moved.path().join("b.txt")).unwrap(),
            b"second"
        );
    }

    #[test]
    fn export_staging_purge_removes_leftovers_and_tolerates_a_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let staged = dir.path().join("export-staging").join("a-uuid");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("backup.age"), b"data").unwrap();
        purge_export_staging(dir.path()).unwrap();
        assert!(!dir.path().join("export-staging").exists());
        purge_export_staging(dir.path()).unwrap();
    }

    #[test]
    fn export_filenames_are_safe_basenames() {
        let sanitize = |name: &str, ext: Option<&str>| sanitize_export_filename(name, ext);
        assert_eq!(sanitize("backup.age", Some("age")), "backup.age");
        assert_eq!(sanitize("../escape.txt", None), "escape.txt");
        assert_eq!(sanitize("a\\b\\c.epub", None), "c.epub");
        assert_eq!(sanitize("bad\u{7}name.txt", None), "badname.txt");
        assert_eq!(sanitize("..", Some("age")), "export.age");
        assert_eq!(sanitize(".", None), "export");
        assert_eq!(sanitize("///", Some("txt")), "export.txt");
        assert_eq!(sanitize("../..", Some("..")), "export");
        assert_eq!(sanitize("dir/", None), "export");
    }
}
