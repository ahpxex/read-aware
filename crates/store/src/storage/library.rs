//! Books and collections — the shelf's read model.
//!
//! Rows are derived from the log by `apply.rs`; the one write here that
//! bypasses it is the verbatim restore (backup import, legacy IndexedDB
//! sweep), whose rows get their events from the boot-time genesis pass.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;
use crate::error::CommandError;
use rusqlite::OptionalExtension;

// --- Library projection (books + collections; book-file bytes via blob store) ---

/// Mirrors `LibraryBook` in apps/web (…/library/lib/library-types.ts). The nested
/// `progress` (ReaderProgress | null) is carried verbatim as JSON.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub file_name: String,
    #[serde(default)]
    pub mime_type: String,
    pub file_size: i64,
    /// `book.coverExtracted` projection: 'unchecked' | 'ready' | 'none'.
    #[serde(default = "default_cover_status")]
    pub cover_status: String,
    #[serde(default)]
    pub cover_blob_key: Option<String>,
    /// Whether the cover bytes are on this device (a synced-in book knows its
    /// cover exists before the relay hands the bytes over). Read-only.
    #[serde(default)]
    pub cover_local: bool,
    /// Content hash of the stored cover — the shelf's cache-busting token.
    #[serde(default)]
    pub cover_version: Option<String>,
    /// Pre-v24 wire shape (backup files, the IndexedDB sweep): an inline
    /// data-URL cover. Accepted on write and lifted into the blob store.
    #[serde(default, skip_serializing)]
    pub cover_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    pub progress_percent: f64,
    pub reading_status: String,
    #[serde(default)]
    pub progress: Value,
    #[serde(default)]
    pub starred: Option<bool>,
    #[serde(default)]
    pub collection_id: Option<String>,
    /// 叙事性分类（book.narrativityClassified 的物化）；None = 未分类。
    #[serde(default)]
    pub narrativity: Option<String>,
    #[serde(default)]
    pub spoiler_sensitive: Option<bool>,
    /// `book.imported.sourcePath`: where a folder import found the file,
    /// relative to the picked folder. Read-only (events own it).
    #[serde(default)]
    pub source_path: Option<String>,
    /// Whether title/author still wait on the reading engine: 'deferred',
    /// 'settled', or None for a book imported before this was recorded.
    /// Read-only (events own it).
    #[serde(default)]
    pub metadata_status: Option<String>,
}

fn default_cover_status() -> String {
    "unchecked".to_owned()
}

/// Mirrors `Collection` in library-types.ts.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

pub fn row_to_library_book(row: &rusqlite::Row) -> rusqlite::Result<LibraryBook> {
    let progress_str: Option<String> = row.get("progress_json")?;
    let progress = progress_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    Ok(LibraryBook {
        id: row.get("id")?,
        title: row.get("title")?,
        author: row.get("author")?,
        format: row.get("format")?,
        file_name: row.get("file_name")?,
        mime_type: row
            .get::<_, Option<String>>("mime_type")?
            .unwrap_or_default(),
        file_size: row.get("file_size")?,
        cover_status: row.get("cover_status")?,
        cover_blob_key: row.get("cover_blob_key")?,
        cover_local: row.get::<_, Option<i64>>("cover_local")?.unwrap_or(0) != 0,
        cover_version: row.get("cover_version")?,
        cover_url: None,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_opened_at: row.get("last_opened_at")?,
        progress_percent: row.get("progress_percent")?,
        reading_status: row.get("reading_status")?,
        progress,
        starred: Some(row.get::<_, i64>("starred")? != 0),
        collection_id: row.get("collection_id")?,
        narrativity: row.get("narrativity")?,
        spoiler_sensitive: row.get("spoiler_sensitive")?,
        source_path: row.get("source_path")?,
        metadata_status: row.get("metadata_status")?,
    })
}

/// The shelf's read model, joined with the cover blob's local presence and
/// hash. Explicit columns: the payload is exactly what the shelf lists, and
/// never carries image bytes.
pub const BOOK_SELECT: &str = "SELECT b.id, b.title, b.author, b.format, b.file_name, b.mime_type,
        b.file_size, b.cover_status, b.cover_blob_key,
        (bo.storage_uri IS NOT NULL) AS cover_local, bo.sha256 AS cover_version,
        b.created_at, b.updated_at, b.last_opened_at, b.progress_percent,
        b.reading_status, b.progress_json, b.starred, b.collection_id, b.narrativity, b.spoiler_sensitive,
        b.source_path, b.metadata_status
   FROM books b
   LEFT JOIN blob_objects bo ON bo.key = b.cover_blob_key AND bo.deleted_at IS NULL";

/// Every shelf book, in no particular order.
pub fn list_books_inner(conn: &Connection) -> Result<Vec<LibraryBook>, CommandError> {
    let mut statement = conn.prepare(BOOK_SELECT)?;
    let rows = statement.query_map([], row_to_library_book)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One shelf book, or None when no book has this id.
pub fn get_book_inner(conn: &Connection, id: &str) -> Result<Option<LibraryBook>, CommandError> {
    Ok(conn
        .query_row(
            &format!("{BOOK_SELECT} WHERE b.id = ?1"),
            params![id],
            row_to_library_book,
        )
        .optional()?)
}

// Collection deletion has no command of its own: `collection.removed` describes
// it, and applying that event drops the row and clears its books' membership.

// ── Content identity (dedup) ─────────────────────────────────────────────────

/// A book already holding this exact source file, if any — the import gate
/// (import.rs): re-importing content the shelf has (including a copy synced
/// in from another device, whose manifest row carries the sha before any
/// bytes do) is a duplicate, not a new book.
pub fn find_book_by_sha_inner(
    conn: &Connection,
    sha256: &str,
    exclude_id: Option<&str>,
) -> Result<Option<String>, CommandError> {
    conn.query_row(
        "SELECT b.id FROM books b
         JOIN blob_objects bo ON bo.key = 'bookfile:' || b.id
         WHERE bo.sha256 = ?1 AND bo.sha256 IS NOT NULL AND bo.sha256 != ''
           AND b.id != COALESCE(?2, '')
         ORDER BY b.created_at, b.id LIMIT 1",
        params![sha256, exclude_id],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}
