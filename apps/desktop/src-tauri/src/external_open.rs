//! "Open with ReadAware" requests arriving from the OS: file paths in the
//! launch argv (Windows/Linux file associations), the argv of a second-instance
//! launch relayed by the single-instance plugin, and macOS Apple Events
//! (`RunEvent::Opened`). Paths park in a queue because the webview may not be
//! mounted yet when they arrive; the frontend drains the queue once on boot and
//! again on every `external-open-request` ping, so no ordering between the two
//! sides can drop a request.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// Extensions the importer accepts. Keep in sync with `BOOK_FILE_EXTENSIONS`
/// in `apps/web/src/features/library/lib/pick-book-files.ts`.
const BOOK_EXTENSIONS: [&str; 14] = [
    "epub", "mobi", "prc", "azw3", "azw", "kf8", "fb2", "fbz", "cbz", "cbr", "txt", "html",
    "htm", "pdf",
];

/// Book paths waiting for the webview to collect them.
#[derive(Default)]
pub struct ExternalOpenQueue(pub Mutex<Vec<String>>);

pub fn is_book_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            BOOK_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(ext))
        })
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
            (is_book_path(&path) && path.is_file())
                .then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

/// Park paths for the webview and ping it. Also surfaces the main window —
/// every caller is a "user just asked the OS to open a book" moment.
/// (Desktop only: mobile WebviewWindow has no show/unminimize/set_focus, and
/// nothing calls park there anyway — the module compiles everywhere because
/// its command is registered unconditionally.)
pub fn park(app: &AppHandle, paths: Vec<String>) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if paths.is_empty() {
        return;
    }
    let queue = app.state::<ExternalOpenQueue>();
    queue.0.lock().unwrap().extend(paths);
    // A not-yet-mounted frontend misses this and drains on boot instead.
    let _ = app.emit("external-open-request", ());
}

/// Drain the parked queue. The frontend owns dedupe/import from here.
#[tauri::command]
pub fn external_open_take(state: tauri::State<'_, ExternalOpenQueue>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

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
