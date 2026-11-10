//! Desktop side of native book archives: the IPC the reading engine asks for
//! an archive's directory and its small documents through, and the
//! `rablob://localhost/book/…` resources a page loads by URL. The archive
//! itself is read by `read_aware_store::book_archive`.
use read_aware_store::book_archive::{
    entry_media_type, entry_name_from_url_path, ArchiveEntry, BookArchive,
};
use serde::Serialize;
use tauri::Manager;

use crate::book_files::{
    failure_status, pinned_revision, unavailable, OpenBooks, Served, NOT_FOUND,
};
use crate::error::CommandError;

pub type BookArchives = OpenBooks<BookArchive>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedArchive {
    /// `sha256:<hex>`, the content version every consumer of the book shares.
    content_version: String,
    entries: Vec<ArchiveEntry>,
}

/// The archive's directory: what the engine builds its package from. `null`
/// when the book's file is not on this device.
#[tauri::command]
pub async fn book_archive_open(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<Option<OpenedArchive>, CommandError> {
    crate::storage::blocking("book_archive_open", move || {
        let archives = app.state::<BookArchives>();
        let Some((archive, sha256)) = archives.get(&app, &book_id, None, BookArchive::open)? else {
            return Ok(None);
        };
        let entries = archive.lock()?.entries();
        Ok(Some(OpenedArchive {
            content_version: format!("sha256:{sha256}"),
            entries,
        }))
    })
    .await
}

/// Several entries as text in one round trip — the package document and the
/// navigation the engine parses when it opens a book, or one page. An entry
/// the archive does not have comes back as `null`.
#[tauri::command]
pub async fn book_archive_texts(
    book_id: String,
    content_version: String,
    names: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<Option<String>>, CommandError> {
    crate::storage::blocking("book_archive_texts", move || {
        let expected = pinned_revision(&content_version)?;
        let archives = app.state::<BookArchives>();
        let (archive, _) = archives
            .get(&app, &book_id, Some(expected), BookArchive::open)?
            .ok_or_else(|| unavailable("Book file is not on this device"))?;
        let mut archive = archive.lock()?;
        names
            .iter()
            .map(|name| archive.read_text(name))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
}

/// `rablob://localhost/book/<bookId>/<sha256>/<entry name, percent-encoded>` —
/// one entry of a book's archive, as a page resource. The content hash in the
/// URL makes the response immutable.
pub fn serve_book_resource(app: &tauri::AppHandle, path: &str) -> Served {
    let mut parts = path.splitn(3, '/');
    let (Some(book_id), Some(sha256), Some(entry)) = (parts.next(), parts.next(), parts.next())
    else {
        return Err(NOT_FOUND);
    };
    let name = entry_name_from_url_path(entry).ok_or(NOT_FOUND)?;
    let archives = app.state::<BookArchives>();
    let read = archives
        .get(app, book_id, Some(sha256), BookArchive::open)
        .and_then(|opened| {
            let Some((archive, _)) = opened else {
                return Ok(None);
            };
            let mut archive = archive.lock()?;
            archive.read(&name)
        });
    match read {
        Ok(Some(bytes)) => {
            let media_type = entry_media_type(&name, &bytes);
            Ok((bytes, media_type))
        }
        Ok(None) => Err(NOT_FOUND),
        Err(error) => {
            log::warn!("book resource read failed: {}", error.code);
            Err(failure_status(&error))
        }
    }
}
