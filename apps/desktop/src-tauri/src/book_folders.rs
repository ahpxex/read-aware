//! Folder imports: the importable books below a folder the user picked.
//!
//! Each platform enumerates on its own side of the picker, and every result
//! lands in the same per-file import pipeline (`library_import` reads a
//! path or `content://` URI directly, so no book bytes cross the IPC bridge):
//! - desktop: `book_folder_pick` opens the folder dialog and walks the
//!   picked folder here — the webview never names a path, so it cannot list
//!   anything the user did not choose;
//! - Android: `MainActivity.startFolderPick` opens the SAF tree picker and
//!   walks the granted tree (document URIs);
//! - iOS: `FolderPickBridge.m` opens a folder `UIDocumentPicker` and walks it
//!   under a security-scoped grant that `book_folder_release` gives back once
//!   the imports are done.
//!
//! Mobile results are parked natively and collected by polling — the same
//! reliable request/response channel the book picker uses (see
//! `book_pick_start`) — as one JSON document:
//! `{"generation":N,"status":"picked"|"cancelled"|"error","error"?,"rootName"?,"files"?,"truncated"?}`.

use crate::error::CommandError;
#[cfg(any(desktop, test))]
use crate::external_open::is_book_path;
#[cfg(desktop)]
use crate::storage::blocking;
#[cfg(any(desktop, test))]
use std::path::{Path, PathBuf};

/// More books than this in one folder is refused rather than half-imported.
#[cfg(any(desktop, test))]
/// Mirrored by `MainActivity.FOLDER_PICK_MAX_BOOKS` and `FolderPickBridge.m`.
pub(crate) const MAX_FOLDER_BOOKS: usize = 5000;
/// Nesting deeper than this is not a book library; deeper folders are skipped.
#[cfg(any(desktop, test))]
const MAX_FOLDER_DEPTH: usize = 32;

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderBook {
    /// Absolute path the import pipeline reads.
    pub path: String,
    /// `/`-separated path below the picked folder.
    pub relative_path: String,
    pub size: u64,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    pub root_name: String,
    pub files: Vec<FolderBook>,
    /// The folder holds more than `MAX_FOLDER_BOOKS` books.
    pub truncated: bool,
}

/// A name the walk leaves alone: dotfiles and dot-folders (`.git`, `.Trash`,
/// AppleDouble `._x.epub` twins) and the `__MACOSX` folder ZIP tools leave.
#[cfg(any(desktop, test))]
fn is_skipped_name(name: &str) -> bool {
    name.starts_with('.') || name == "__MACOSX"
}

#[cfg(any(desktop, test))]
fn scan_folder(root: &Path) -> Result<FolderScan, CommandError> {
    let metadata = std::fs::metadata(root).map_err(|err| {
        CommandError::context(&format!("Failed to open folder {}", root.display()), err)
    })?;
    if !metadata.is_dir() {
        return Err(CommandError::internal(format!(
            "{} is not a folder",
            root.display()
        )));
    }
    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let mut files = Vec::new();
    let mut truncated = false;
    // (directory, its path below the root as segments)
    let mut pending: Vec<(PathBuf, Vec<String>)> = vec![(root.to_path_buf(), Vec::new())];
    'walk: while let Some((dir, segments)) = pending.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            // The root was readable a moment ago; an unreadable subfolder
            // (permissions, a vanished mount) costs only its own books.
            Err(err) if !segments.is_empty() => {
                log::warn!(
                    "Folder import skipped unreadable folder {}: {err}",
                    dir.display()
                );
                continue;
            }
            Err(err) => {
                return Err(CommandError::context(
                    &format!("Failed to list folder {}", dir.display()),
                    err,
                ));
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    log::warn!(
                        "Folder import skipped an unreadable entry in {}: {err}",
                        dir.display()
                    );
                    continue;
                }
            };
            // A name that is not UTF-8 cannot round-trip through the webview.
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if is_skipped_name(&name) {
                continue;
            }
            // Symlinks are not followed: no cycles, nothing outside the pick.
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if segments.len() + 1 < MAX_FOLDER_DEPTH {
                    let mut child = segments.clone();
                    child.push(name);
                    pending.push((path, child));
                }
                continue;
            }
            if !kind.is_file() || !is_book_path(&path) {
                continue;
            }
            if files.len() == MAX_FOLDER_BOOKS {
                truncated = true;
                break 'walk;
            }
            let Some(path_text) = path.to_str().map(str::to_owned) else {
                continue;
            };
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            let mut relative = segments.clone();
            relative.push(name);
            files.push(FolderBook {
                path: path_text,
                relative_path: relative.join("/"),
                size,
            });
        }
    }
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(FolderScan {
        root_name,
        files,
        truncated,
    })
}

/// Desktop: let the user pick a folder in the native dialog and list the
/// importable books below it, without following symlinks or entering hidden
/// folders. `None` when the user cancels. The path comes from the dialog
/// alone, never from the webview.
#[cfg(desktop)]
#[tauri::command]
pub async fn book_folder_pick(
    app: tauri::AppHandle,
    window: tauri::Window,
    title: String,
) -> Result<Option<FolderScan>, CommandError> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .pick_folder(move |picked| {
            // The waiter only disappears if the command itself was dropped.
            let _ = sender.send(picked);
        });
    let picked = receiver
        .await
        .map_err(|_| CommandError::internal("folder dialog closed without a result"))?;
    let path = match picked {
        None => return Ok(None),
        Some(FilePath::Path(path)) => path,
        Some(FilePath::Url(url)) => {
            return Err(CommandError::internal(format!(
                "folder dialog returned a URL: {url}"
            )));
        }
    };
    blocking("book_folder_pick", move || scan_folder(&path).map(Some)).await
}

/// Mobile picks through `book_folder_pick_start`/`_poll` instead.
#[cfg(mobile)]
#[tauri::command]
pub fn book_folder_pick() -> Option<FolderScan> {
    None
}

// ── Mobile folder pickers ───────────────────────────────────────────────────

/// Run `task` against the Android activity. Call it on the UI thread (inside
/// `on_main_thread`); `None` when the activity is not reachable yet.
#[cfg(target_os = "android")]
fn with_activity<T>(
    task: impl FnOnce(&mut jni::JNIEnv, &jni::objects::JObject) -> Option<T>,
) -> Option<T> {
    use tao::platform::android::prelude::main_android_context;
    let ctx = main_android_context()?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
    task(&mut env, &activity)
}

/// Open the platform folder picker (Android SAF tree picker, iOS folder
/// document picker). The walk runs natively once the user picks; collect the
/// outcome with `book_folder_pick_poll`. No-op on desktop, which picks through
/// the dialog and scans in one call, `book_folder_pick`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn book_folder_pick_start(
    app: tauri::AppHandle,
    generation: i32,
) -> Result<(), CommandError> {
    crate::storage::on_main_thread(&app, move || {
        with_activity(|env, activity| {
            if let Err(err) = env.call_method(
                activity,
                "startFolderPick",
                "(I)V",
                &[jni::objects::JValue::Int(generation)],
            ) {
                log::error!("startFolderPick JNI call failed: {err}");
                let _ = env.exception_clear();
            }
            Some(())
        });
    })
    .await
}

/// Collect (and clear) the parked folder-pick JSON, or `None` while the picker
/// is open or the walk is still running.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn book_folder_pick_poll(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    crate::storage::on_main_thread(&app, || {
        with_activity(|env, activity| {
            let value = env
                .call_method(
                    activity,
                    "takeFolderPickResult",
                    "()Ljava/lang/String;",
                    &[],
                )
                .map_err(|err| {
                    log::error!("takeFolderPickResult JNI call failed: {err}");
                    let _ = env.exception_clear();
                })
                .ok()?;
            let obj = value.l().ok()?;
            if obj.is_null() {
                return None;
            }
            let jstr = jni::objects::JString::from(obj);
            let text = env.get_string(&jstr).ok()?;
            Some(text.into())
        })
    })
    .await
}

/// iOS: entry points of `FolderPickBridge.m`, handed over from its load-time
/// constructor (release builds strip the export table a symbol lookup would
/// need — see `STATUS_BAR_BRIDGE`).
#[cfg(target_os = "ios")]
#[derive(Clone, Copy)]
struct FolderPickBridge {
    start: extern "C" fn(i32),
    /// The parked JSON as a `malloc`ed C string the caller frees, or null.
    take: extern "C" fn() -> *mut std::ffi::c_char,
    release: extern "C" fn(),
}

#[cfg(target_os = "ios")]
static FOLDER_PICK_BRIDGE: std::sync::OnceLock<FolderPickBridge> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn ra_register_folder_pick_bridge(
    start: extern "C" fn(i32),
    take: extern "C" fn() -> *mut std::ffi::c_char,
    release: extern "C" fn(),
) {
    let _ = FOLDER_PICK_BRIDGE.set(FolderPickBridge {
        start,
        take,
        release,
    });
}

#[cfg(target_os = "ios")]
fn ios_bridge() -> Result<FolderPickBridge, CommandError> {
    FOLDER_PICK_BRIDGE
        .get()
        .copied()
        .ok_or_else(|| CommandError::internal("FolderPickBridge was not registered"))
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub fn book_folder_pick_start(generation: i32) -> Result<(), CommandError> {
    (ios_bridge()?.start)(generation);
    Ok(())
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub fn book_folder_pick_poll() -> Result<Option<String>, CommandError> {
    extern "C" {
        fn free(pointer: *mut std::ffi::c_void);
    }
    let pointer = (ios_bridge()?.take)();
    if pointer.is_null() {
        return Ok(None);
    }
    // SAFETY: the bridge returns a NUL-terminated `strdup` copy it no longer
    // references; this side owns it from here and frees it exactly once.
    let text = unsafe { std::ffi::CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { free(pointer.cast()) };
    Ok(Some(text))
}

/// iOS: end the security-scoped access the last folder pick holds. The files
/// it listed stay readable until then, so call it once their imports finished.
#[cfg(target_os = "ios")]
#[tauri::command]
pub fn book_folder_release() -> Result<(), CommandError> {
    (ios_bridge()?.release)();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn book_folder_pick_start(_generation: i32) {}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn book_folder_pick_poll() -> Option<String> {
    None
}

/// Android grants last as long as the activity, and desktop scans hold
/// nothing: only iOS has access to give back.
#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub fn book_folder_release() {}

#[cfg(test)]
#[path = "book_folders_tests.rs"]
mod tests;
