//! Book files kept open between requests, for the native readers a page of
//! the reader is served from (`book_archive.rs`, `palm_book.rs`).
//!
//! A page asks for its resources in a burst; reopening the file and rereading
//! its directory for each would cost more than the resource.
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use tauri::Manager;

use crate::error::CommandError;
use crate::storage::{get_blob_record_inner, DataDir, Db};

/// The books in the reader and its standby are the ones in use at a time.
const OPEN_BOOKS: usize = 3;

pub fn unavailable(message: impl Into<String>) -> CommandError {
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
        return Err(unavailable("Book file requires a book id"));
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

/// A reader over an open book file, shared by the requests using it.
pub type Shared<T> = Arc<Mutex<T>>;

struct Open<T> {
    book_id: String,
    /// The file's content hash: a replaced file is another book.
    sha256: String,
    reader: Shared<T>,
}

/// The most recently used readers of one kind, least recent first.
pub struct OpenBooks<T>(Mutex<Vec<Open<T>>>);

impl<T> Default for OpenBooks<T> {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

impl<T> OpenBooks<T> {
    /// The book's reader and content hash, opened once and shared, or `None`
    /// when its file is not on this device. `expected` pins a request to one
    /// content: a URL minted for an earlier file must not read a newer one.
    pub fn get(
        &self,
        app: &tauri::AppHandle,
        book_id: &str,
        expected: Option<&str>,
        open: impl FnOnce(&Path) -> Result<T, CommandError>,
    ) -> Result<Option<(Shared<T>, String)>, CommandError> {
        // A request pinned to the content a reader is already open on needs
        // nothing looked up: the hash names the bytes, whatever the library
        // says by now. This is every resource a page loads, and it must not
        // wait behind whoever holds the database.
        if let Some(expected) = expected {
            if let Some(reader) = self.held(book_id, expected)? {
                return Ok(Some((reader, expected.to_owned())));
            }
        }
        let Some((path, sha256)) = book_file(app, book_id)? else {
            return Ok(None);
        };
        if expected.is_some_and(|expected| expected != sha256) {
            return Err(CommandError::new(
                "reader/stale-location",
                "Book file belongs to another content revision",
            ));
        }
        if let Some(reader) = self.held(book_id, &sha256)? {
            return Ok(Some((reader, sha256)));
        }
        let reader = Arc::new(Mutex::new(open(&path)?));
        let mut books = self.0.lock()?;
        books.retain(|entry| entry.book_id != book_id);
        books.push(Open {
            book_id: book_id.to_owned(),
            sha256: sha256.clone(),
            reader: reader.clone(),
        });
        while books.len() > OPEN_BOOKS {
            books.remove(0);
        }
        Ok(Some((reader, sha256)))
    }
}

/// What a resource route answers: the bytes and their media type, or the
/// status that says why not.
pub type Served = Result<(Vec<u8>, &'static str), u16>;
/// No such book, file or resource, or a URL minted for an earlier file.
pub const NOT_FOUND: u16 = 404;
/// The file is there and could not be read as its format: the book is damaged.
pub const UNREADABLE: u16 = 422;

/// The status a failed read is answered with.
pub fn failure_status(error: &CommandError) -> u16 {
    if error.code == "book/parse-failed" {
        UNREADABLE
    } else {
        NOT_FOUND
    }
}

impl<T> OpenBooks<T> {
    /// The reader open on this content of the book, now the most recently used.
    fn held(&self, book_id: &str, sha256: &str) -> Result<Option<Shared<T>>, CommandError> {
        let mut books = self.0.lock()?;
        let Some(index) = books
            .iter()
            .position(|entry| entry.book_id == book_id && entry.sha256 == sha256)
        else {
            return Ok(None);
        };
        let entry = books.remove(index);
        let reader = entry.reader.clone();
        books.push(entry);
        Ok(Some(reader))
    }
}

/// The content revision a request names, without its `sha256:` prefix.
/// Unpinned, a request could read a file that replaced the one asked about.
pub fn pinned_revision(content_version: &str) -> Result<&str, CommandError> {
    content_version.strip_prefix("sha256:").ok_or_else(|| {
        CommandError::new(
            "reader/stale-location",
            "Book file requires its content revision",
        )
    })
}
