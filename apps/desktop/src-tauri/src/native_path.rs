//! Resolve user-picked path strings for commands that read book files.
//!
//! Desktop dialogs hand over plain filesystem paths. Android's document
//! picker hands over `content://` URIs — openable through the fs plugin's
//! resolver, but invisible to `std::fs`. Commands that need a real path (the
//! metadata extractors, the blob copy) call [`materialize`]: plain paths and
//! `file://` URLs pass through untouched; URI-backed picks are drained into a
//! temp file that lives exactly as long as the returned guard.

use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

pub(crate) struct MaterializedPath {
    pub path: PathBuf,
    /// Deletes the staged copy on drop; `None` for pass-through paths.
    _staged: Option<tempfile::NamedTempFile>,
}

pub(crate) fn materialize(app: &AppHandle, raw: &str) -> Result<MaterializedPath, String> {
    let parsed = raw
        .parse::<FilePath>()
        .map_err(|error| format!("Invalid file path {raw}: {error}"))?;
    let url = match parsed {
        FilePath::Path(path) => {
            return Ok(MaterializedPath {
                path,
                _staged: None,
            })
        }
        FilePath::Url(url) => url,
    };
    if url.scheme() == "file" {
        if let Ok(path) = url.to_file_path() {
            return Ok(MaterializedPath {
                path,
                _staged: None,
            });
        }
    }

    let mut options = OpenOptions::new();
    options.read(true);
    let mut source = app
        .fs()
        .open(FilePath::Url(url), options)
        .map_err(|error| format!("Failed to open {raw}: {error}"))?;
    let mut staged = tempfile::NamedTempFile::new()
        .map_err(|error| format!("Failed to create a staging file for {raw}: {error}"))?;
    std::io::copy(&mut source, staged.as_file_mut())
        .map_err(|error| format!("Failed to stage {raw}: {error}"))?;
    Ok(MaterializedPath {
        path: staged.path().to_path_buf(),
        _staged: Some(staged),
    })
}
