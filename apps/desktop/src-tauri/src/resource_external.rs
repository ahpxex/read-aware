//! Host-confirmed OS handoff. Copies remain separate from both library blobs
//! and the resource lease; only the system association is used, never a program argument.
use super::{invalid, ResourceFiles, LIFETIME, MAX_FILE, MAX_TOTAL};
use crate::error::CommandError;
use crate::tauri_error::tauri_error;
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

struct Preview {
    directory: PathBuf,
    size: u64,
    created: Instant,
}
#[derive(Default)]
struct PreviewState {
    initialized: bool,
    shutting_down: bool,
    entries: HashMap<String, Preview>,
}
#[derive(Default)]
pub struct ExternalPreviews(Mutex<PreviewState>);
pub fn initialize(app: &tauri::AppHandle) -> Result<(), CommandError> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(tauri_error)?
        .join("resource-previews");
    app.state::<ExternalPreviews>().0.lock()?.initialize(&root)
}

pub fn shutdown(app: &tauri::AppHandle) -> Result<(), CommandError> {
    app.state::<ExternalPreviews>().0.lock()?.shutdown();
    Ok(())
}

fn remove(preview: &Preview) -> bool {
    match std::fs::remove_dir_all(&preview.directory) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            log::warn!("External resource cleanup pending: {error}");
            false
        }
    }
}
impl PreviewState {
    fn shutdown(&mut self) {
        self.shutting_down = true;
        self.entries.retain(|_, entry| !remove(entry));
    }

    fn prune(&mut self) {
        self.entries
            .retain(|_, entry| entry.created.elapsed() < LIFETIME || !remove(entry));
    }
    fn initialize(&mut self, root: &Path) -> Result<(), CommandError> {
        if self.initialized {
            return Ok(());
        }
        std::fs::create_dir_all(root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
        }
        // A process restart does not resume preview leases. Only this private
        // cache's generated directories are removed; no source paths are touched.
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().starts_with("preview-")
                && entry.file_type()?.is_dir()
            {
                std::fs::remove_dir_all(entry.path())?;
            }
        }
        self.initialized = true;
        Ok(())
    }
}
impl Drop for PreviewState {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn filename(value: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 256
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
    {
        return Err(invalid("Invalid external resource filename"));
    }
    let extension = Path::new(value)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let supported: Vec<String> = serde_json::from_str(include_str!(
        "../../../../packages/core/src/resource-external-formats.json"
    ))?;
    if !supported.contains(&extension) {
        return Err(invalid(
            "External opening requires a supported document or media extension",
        ));
    }
    Ok(())
}
fn handoff(
    state: &mut PreviewState,
    root: &Path,
    source: File,
    name: &str,
    open: impl FnOnce(&Path) -> Result<(), CommandError>,
) -> Result<String, CommandError> {
    if state.shutting_down {
        return Err(CommandError::new(
            "ui/unavailable",
            "Application is exiting",
        ));
    }
    filename(name)?;
    state.initialize(root)?;
    state.prune();
    let budget = MAX_FILE
        .min(MAX_TOTAL.saturating_sub(state.entries.values().map(|entry| entry.size).sum()));
    if state.entries.len() >= 16 || source.metadata()?.len() > budget {
        return Err(super::quota());
    }
    let directory = tempfile::Builder::new()
        .prefix("preview-")
        .tempdir_in(root)?;
    let target = directory.path().join(name);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&target)?;
    let size = std::io::copy(&mut source.take(budget + 1), &mut output)?;
    if size > budget {
        return Err(super::quota());
    }
    output.sync_all()?;
    drop(output);
    let id = uuid::Uuid::new_v4().to_string();
    state.entries.insert(
        id.clone(),
        Preview {
            directory: directory.keep(),
            size,
            created: Instant::now(),
        },
    );
    if let Err(error) = open(&target) {
        // An association can report failure after touching the file. Failed
        // removal must still occupy quota instead of leaking untracked copies.
        if state.entries.get(&id).is_some_and(remove) {
            state.entries.remove(&id);
        }
        return Err(error);
    }
    Ok(id)
}

#[tauri::command]
pub async fn resource_open_associated(
    app: tauri::AppHandle,
    id: String,
    filename: String,
) -> Result<(), CommandError> {
    let retained_app = app.clone();
    crate::storage::blocking("resource_open_associated", move || {
        let source = {
            let resources = app.state::<ResourceFiles>();
            let mut entries = resources.0.lock()?;
            super::lease(&mut entries, &id)?
        };
        let root = app
            .path()
            .app_cache_dir()
            .map_err(tauri_error)?
            .join("resource-previews");
        let state = app.state::<ExternalPreviews>();
        let mut previews = state.0.lock()?;
        handoff(&mut previews, &root, source, &filename, |target| {
            let target = target
                .to_str()
                .ok_or_else(|| invalid("External cache path is not valid Unicode"))?;
            app.opener()
                .open_path(target, None::<&str>)
                .map_err(|error| {
                    CommandError::new(
                        "ui/unavailable",
                        format!("System file association failed: {error}"),
                    )
                })
        })
    })
    .await?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LIFETIME).await;
        // Blocking file removal runs away from the async executor. Failed removals
        // retain their quota and retry on the next handoff or process shutdown.
        let _ = crate::storage::blocking("resource_preview_cleanup", move || {
            retained_app.state::<ExternalPreviews>().0.lock()?.prune();
            Ok(())
        })
        .await;
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_removes_live_copies_and_rejects_queued_handoffs() {
        let source_dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let original = source_dir.path().join("original.txt");
        std::fs::write(&original, "source").unwrap();
        let mut state = PreviewState::default();
        let mut copied = PathBuf::new();
        handoff(
            &mut state,
            cache.path(),
            File::open(&original).unwrap(),
            "copy.txt",
            |path| {
                copied = path.to_owned();
                Ok(())
            },
        )
        .unwrap();
        state.shutdown();
        state.shutdown();
        assert!(!copied.exists());
        assert_eq!(std::fs::read(&original).unwrap(), b"source");
        assert!(state.entries.is_empty());
        assert!(handoff(
            &mut state,
            cache.path(),
            File::open(&original).unwrap(),
            "late.txt",
            |_| { panic!("An exiting app must not dispatch another preview") }
        )
        .is_err());
        assert_eq!(std::fs::read_dir(cache.path()).unwrap().count(), 0);
    }

    #[test]
    fn associated_handoff_copies_only_supported_resources_and_cleans_expired_leases() {
        let source_dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let original = source_dir.path().join("original.txt");
        std::fs::write(&original, "source").unwrap();
        let mut state = PreviewState::default();
        let mut copied = PathBuf::new();
        let id = handoff(
            &mut state,
            cache.path(),
            File::open(&original).unwrap(),
            "copy.txt",
            |path| {
                copied = path.to_owned();
                assert_eq!(std::fs::read(path).unwrap(), b"source");
                Ok(())
            },
        )
        .unwrap();
        std::fs::write(&copied, "external edit").unwrap();
        assert_eq!(std::fs::read(&original).unwrap(), b"source");
        assert!(copied.starts_with(cache.path()));
        for name in [
            "../copy.txt",
            "a\\copy.txt",
            "C:copy.txt",
            "run.exe",
            "run.sh",
            "launcher.desktop",
            "no-extension",
        ] {
            assert!(filename(name).is_err());
        }
        assert!(handoff(
            &mut state,
            cache.path(),
            File::open(&original).unwrap(),
            "fail.txt",
            |_| Err(invalid("no association"))
        )
        .is_err());
        assert_eq!(state.entries.len(), 1);
        state.entries.get_mut(&id).unwrap().created -= LIFETIME;
        state.prune();
        assert!(state.entries.is_empty());
        assert!(!copied.exists());
        assert!(original.exists());
    }
    #[test]
    fn associated_preview_restart_removes_only_owned_cache_directories() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("preview-old")).unwrap();
        std::fs::write(root.path().join("preview-old/a.txt"), "old").unwrap();
        std::fs::write(root.path().join("unrelated.txt"), "keep").unwrap();
        let mut state = PreviewState::default();
        state.initialize(root.path()).unwrap();
        assert!(!root.path().join("preview-old").exists());
        assert!(root.path().join("unrelated.txt").exists());
    }
}
