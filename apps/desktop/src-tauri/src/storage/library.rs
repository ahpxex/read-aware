//! Books and collections — the shelf's read model.
//!
//! Rows are derived from the log by `apply.rs`; the one write here that
//! bypasses it is the verbatim restore (backup import, legacy IndexedDB
//! sweep), whose rows get their events from the boot-time genesis pass.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use crate::error::CommandError;
use super::*;

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

pub(crate) fn row_to_library_book(row: &rusqlite::Row) -> rusqlite::Result<LibraryBook> {
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
    })
}

/// The shelf's read model, joined with the cover blob's local presence and
/// hash. Explicit columns: the payload is exactly what the shelf lists, and
/// never carries image bytes.
const BOOK_SELECT: &str = "SELECT b.id, b.title, b.author, b.format, b.file_name, b.mime_type,
        b.file_size, b.cover_status, b.cover_blob_key,
        (bo.storage_uri IS NOT NULL) AS cover_local, bo.sha256 AS cover_version,
        b.created_at, b.updated_at, b.last_opened_at, b.progress_percent,
        b.reading_status, b.progress_json, b.starred, b.collection_id, b.narrativity
   FROM books b
   LEFT JOIN blob_objects bo ON bo.key = b.cover_blob_key AND bo.deleted_at IS NULL";

#[tauri::command]
pub fn library_load(db: State<'_, Db>) -> Result<Vec<LibraryBook>, CommandError> {
    let conn = db.0.lock()?;
    let mut stmt = conn
        .prepare(BOOK_SELECT)
        ?;
    let rows = stmt
        .query_map([], row_to_library_book)
        ?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[tauri::command]
pub fn library_get_book(id: String, db: State<'_, Db>) -> Result<Option<LibraryBook>, CommandError> {
    let conn = db.0.lock()?;
    match conn.query_row(
        &format!("{BOOK_SELECT} WHERE b.id = ?1"),
        params![id],
        row_to_library_book,
    ) {
        Ok(book) => Ok(Some(book)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Upsert a row verbatim (id preserved) — backup restore and the legacy
/// IndexedDB sweep. Cover state is NOT taken from the input: a restored row
/// is 'ready' only if this device holds its cover blob (a pre-v24 record's
/// inline data URL is lifted into the store first); anything else starts
/// 'unchecked' and the engine job re-extracts from the book file.
#[tauri::command]
pub fn library_put_book(
    book: LibraryBook,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<(), CommandError> {
    let conn = db.0.lock()?;
    let progress_json = if book.progress.is_null() {
        None
    } else {
        Some(book.progress.to_string())
    };
    let cover_key = crate::covers::cover_blob_key(&book.id);
    let mut cover_present = get_blob_record_inner(&conn, &data_dir.0, &cover_key)?.is_some();
    if !cover_present {
        if let Some(cover) = book
            .cover_url
            .as_deref()
            .and_then(crate::covers::cover_from_data_url)
            .as_ref()
            .and_then(crate::covers::normalize_cover)
        {
            crate::covers::store_cover(&conn, &data_dir.0, &book.id, &cover)?;
            cover_present = true;
        }
    }
    let (cover_status, cover_blob_key) = if cover_present {
        ("ready", Some(cover_key))
    } else {
        ("unchecked", None)
    };
    conn.execute(
        "INSERT INTO books
            (id, title, author, format, file_name, mime_type, file_size, cover_status,
             cover_blob_key, created_at, updated_at, last_opened_at, progress_percent,
             reading_status, progress_json, starred, collection_id, narrativity)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, author=excluded.author, format=excluded.format,
            file_name=excluded.file_name, mime_type=excluded.mime_type,
            file_size=excluded.file_size, cover_status=excluded.cover_status,
            cover_blob_key=excluded.cover_blob_key, created_at=excluded.created_at,
            updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at,
            progress_percent=excluded.progress_percent, reading_status=excluded.reading_status,
            progress_json=excluded.progress_json, starred=excluded.starred,
            collection_id=excluded.collection_id, narrativity=excluded.narrativity",
        params![
            book.id,
            book.title,
            book.author,
            book.format,
            book.file_name,
            book.mime_type,
            book.file_size,
            cover_status,
            cover_blob_key,
            book.created_at,
            book.updated_at,
            book.last_opened_at,
            book.progress_percent,
            book.reading_status,
            progress_json,
            book.starred.unwrap_or(false) as i64,
            book.collection_id,
            book.narrativity,
        ],
    )
    ?;
    Ok(())
}

/// Release the file bytes of deleted books.
///
/// The ROWS are removed by replaying `book.removed` through `commit_events`;
/// this drops the object-storage side, which the log deliberately does not
/// describe. Safe to call for ids that have no blob.
#[tauri::command]
pub fn library_release_book_files(
    ids: Vec<String>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<(), CommandError> {
    let conn = db.0.lock()?;
    for id in &ids {
        delete_blob_inner(&conn, &data_dir.0, &format!("bookfile:{id}"))?;
        delete_blob_inner(&conn, &data_dir.0, &crate::covers::cover_blob_key(id))?;
    }
    Ok(())
}

#[tauri::command]
pub fn library_list_collections(db: State<'_, Db>) -> Result<Vec<Collection>, CommandError> {
    let conn = db.0.lock()?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM collections")
        ?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        ?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Upsert a collection. On conflict the original `created_at` is preserved, so
/// this doubles as rename.
#[tauri::command]
pub fn library_put_collection(collection: Collection, db: State<'_, Db>) -> Result<(), CommandError> {
    let conn = db.0.lock()?;
    conn.execute(
        "INSERT INTO collections (id, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![collection.id, collection.name, collection.created_at],
    )
    ?;
    Ok(())
}

// Collection deletion has no command of its own: `collection.removed` describes
// it, and applying that event drops the row and clears its books' membership.


// ── Content identity (dedup) ─────────────────────────────────────────────────

/// A book already holding this exact source file, if any — the import gate
/// (import.rs): re-importing content the shelf has (including a copy synced
/// in from another device, whose manifest row carries the sha before any
/// bytes do) is a duplicate, not a new book.
pub(crate) fn find_book_by_sha_inner(
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateBookEntry {
    pub id: String,
    pub created_at: String,
}

/// Groups of shelf books that share one source file (same bookfile sha256) —
/// the post-pull merge detector's input. Each group is ordered oldest-first
/// then by id, so `group[0]` IS the deterministic keeper on every device.
#[tauri::command]
pub fn library_duplicate_book_groups(
    db: State<'_, Db>,
) -> Result<Vec<Vec<DuplicateBookEntry>>, CommandError> {
    let conn = db.0.lock()?;
    let mut stmt = conn
        .prepare(
            "SELECT bo.sha256, b.id, b.created_at
             FROM books b
             JOIN blob_objects bo ON bo.key = 'bookfile:' || b.id
             WHERE bo.sha256 IS NOT NULL AND bo.sha256 != ''
               AND bo.sha256 IN (
                 SELECT bo2.sha256 FROM books b2
                 JOIN blob_objects bo2 ON bo2.key = 'bookfile:' || b2.id
                 WHERE bo2.sha256 IS NOT NULL AND bo2.sha256 != ''
                 GROUP BY bo2.sha256 HAVING COUNT(*) > 1)
             ORDER BY bo.sha256, b.created_at, b.id",
        )
        ?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                DuplicateBookEntry { id: row.get(1)?, created_at: row.get(2)? },
            ))
        })
        ?;
    let mut groups: Vec<Vec<DuplicateBookEntry>> = Vec::new();
    let mut current_sha: Option<String> = None;
    for row in rows {
        let (sha, entry) = row?;
        if current_sha.as_deref() != Some(&sha) {
            current_sha = Some(sha);
            groups.push(Vec::new());
        }
        groups.last_mut().expect("group pushed above").push(entry);
    }
    Ok(groups)
}
