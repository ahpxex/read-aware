//! Resolve user-picked path strings for commands that read book files.
//!
//! Desktop dialogs hand over plain filesystem paths. Android's document
//! picker hands over `content://` URIs — openable through the fs plugin's
//! resolver, but invisible to `std::fs`. Commands that need a real path (the
//! metadata extractors, the blob copy) call [`materialize`]: plain paths and
//! `file://` URLs pass through untouched; URI-backed picks are drained into a
//! temp file in the app's private cache that lives exactly as long as the
//! returned guard.

use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::error::CommandError;

#[cfg(test)]
mod tests;

pub(crate) struct MaterializedPath {
    pub path: PathBuf,
    /// Deletes the staged copy on drop; `None` for pass-through paths.
    _staged: Option<tempfile::NamedTempFile>,
}

pub(crate) fn materialize(app: &AppHandle, raw: &str) -> Result<MaterializedPath, CommandError> {
    let parsed = raw
        .parse::<FilePath>()
        .map_err(|error| CommandError::internal(format!("Invalid file path: {error}")))?;
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
    let source = app
        .fs()
        .open(FilePath::Url(url), options)
        .map_err(|error| CommandError::context("Failed to open selected book", error))?;
    // Before Android 13, the default temp directory is /data/local/tmp,
    // which ordinary apps cannot write. Always resolve our private cache.
    materialize_reader(app, source)
}

pub(crate) fn materialize_reader(app: &AppHandle, source: impl Read) -> Result<MaterializedPath, CommandError> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| CommandError::context("Failed to locate the import cache", error))?
        .join("book-imports");
    stage_reader(source, &cache_dir)
}

fn stage_reader(mut source: impl Read, cache_dir: &Path) -> Result<MaterializedPath, CommandError> {
    std::fs::create_dir_all(cache_dir)
        .map_err(|error| CommandError::context("Failed to create the import cache", error))?;
    let mut staged = tempfile::NamedTempFile::new_in(cache_dir)
        .map_err(|error| CommandError::context("Failed to create an import staging file", error))?;
    std::io::copy(&mut source, staged.as_file_mut())
        .map_err(|error| CommandError::context("Failed to stage selected book", error))?;
    Ok(MaterializedPath {
        path: staged.path().to_path_buf(),
        _staged: Some(staged),
    })
}
