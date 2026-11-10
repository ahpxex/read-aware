//! Desktop side of native book archives: the IPC the reading engine asks for
//! an archive's directory and its small documents through, and the
//! `rablob://localhost/book/…` resources a page loads by URL. The archive
//! itself is read by `read_aware_store::book_archive`.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use read_aware_store::book_archive::{
    entry_media_type, entry_name_from_url_path, ArchiveEntry, BookArchive,
};
use serde::Serialize;
use tauri::Manager;

use crate::error::CommandError;
use crate::storage::{get_blob_record_inner, DataDir, Db};

/// Archives kept open between requests. A page asks for its images and
/// stylesheets in a burst; reopening the file and rereading its directory for
/// each would cost more than the entry. The books in the reader and its
/// standby are the ones in use at a time.
const OPEN_ARCHIVES: usize = 3;

/// An open archive, shared by the requests reading it.
type SharedArchive = Arc<Mutex<BookArchive>>;

struct Open {
    book_id: String,
    /// The file's content hash: a replaced file is another archive.
    sha256: String,
    archive: SharedArchive,
}

#[derive(Default)]
pub struct BookArchives(Mutex<Vec<Open>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedArchive {
    /// `sha256:<hex>`, the content version every consumer of the book shares.
    content_version: String,
    entries: Vec<ArchiveEntry>,
}

fn unavailable(message: impl Into<String>) -> CommandError {
    CommandError::new("library/content-unavailable", message)
}

/// Book ids are UUIDs; anything else is not a lookup key.
fn valid_book_id(book_id: &str) -> bool {
    !book_id.is_empty()
        && book_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// The book's file and its content hash, or `None` when the bytes are not on
/// this device (a book synced in without its file).
fn book_file(
    app: &tauri::AppHandle,
    book_id: &str,
) -> Result<Option<(PathBuf, String)>, CommandError> {
    if !valid_book_id(book_id) {
        return Err(unavailable("Book archive requires a book id"));
    }
    let db = app.state::<Db>();
    let data_dir = app.state::<DataDir>();
    let conn = db.0.lock()?;
    let record = get_blob_record_inner(&conn, &data_dir.0, &format!("bookfile:{book_id}"))?;
    drop(conn);
    let Some((path, info)) = record else {
        return Ok(None);
    };
    let sha256 = info
        .sha256
        .ok_or_else(|| unavailable("Book file has no content revision"))?;
    Ok(Some((path, sha256)))
}

/// The book's archive, opened once and shared, or `None` when its file is
/// not on this device. `expected` pins a request to one content: a URL minted
/// for an earlier file must not read a newer one.
fn open_archive(
    app: &tauri::AppHandle,
    book_id: &str,
    expected: Option<&str>,
) -> Result<Option<(SharedArchive, String)>, CommandError> {
    let Some((path, sha256)) = book_file(app, book_id)? else {
        return Ok(None);
    };
    if expected.is_some_and(|expected| expected != sha256) {
        return Err(CommandError::new(
            "reader/stale-location",
            "Book archive belongs to another content revision",
        ));
    }
    let archives = app.state::<BookArchives>();
    let mut open = archives.0.lock()?;
    if let Some(index) = open
        .iter()
        .position(|entry| entry.book_id == book_id && entry.sha256 == sha256)
    {
        // Most recently used last.
        let entry = open.remove(index);
        let archive = entry.archive.clone();
        open.push(entry);
        return Ok(Some((archive, sha256)));
    }
    let archive = Arc::new(Mutex::new(BookArchive::open(&path)?));
    open.retain(|entry| entry.book_id != book_id);
    open.push(Open {
        book_id: book_id.to_owned(),
        sha256: sha256.clone(),
        archive: archive.clone(),
    });
    while open.len() > OPEN_ARCHIVES {
        open.remove(0);
    }
    Ok(Some((archive, sha256)))
}

/// The archive's directory: what the engine builds its package from. `null`
/// when the book's file is not on this device.
#[tauri::command]
pub async fn book_archive_open(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<Option<OpenedArchive>, CommandError> {
    crate::storage::blocking("book_archive_open", move || {
        let Some((archive, sha256)) = open_archive(&app, &book_id, None)? else {
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
        // Unpinned, a request could read a file that replaced the one asked about.
        let expected = content_version.strip_prefix("sha256:").ok_or_else(|| {
            CommandError::new(
                "reader/stale-location",
                "Book archive requires its content revision",
            )
        })?;
        let (archive, _) = open_archive(&app, &book_id, Some(expected))?
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
/// one entry of a book's archive, as a page resource. The content hash in the URL makes the
/// response immutable. Returns `None` for anything that is not such a
/// resource, which the caller answers as not found.
pub fn serve_book_resource(app: &tauri::AppHandle, path: &str) -> Option<(Vec<u8>, &'static str)> {
    let mut parts = path.splitn(3, '/');
    let (book_id, sha256, entry) = (parts.next()?, parts.next()?, parts.next()?);
    let name = entry_name_from_url_path(entry)?;
    let (archive, _) = match open_archive(app, book_id, Some(sha256)) {
        Ok(opened) => opened?,
        Err(error) => {
            log::warn!("book resource lookup failed: {}", error.code);
            return None;
        }
    };
    let bytes = match archive.lock().ok()?.read(&name) {
        Ok(bytes) => bytes?,
        Err(error) => {
            log::warn!("book resource read failed: {}", error.code);
            return None;
        }
    };
    let media_type = entry_media_type(&name, &bytes);
    Some((bytes, media_type))
}
