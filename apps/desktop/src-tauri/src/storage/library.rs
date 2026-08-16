//! Books and collections — the shelf's read model.
//!
//! Rows are derived from the log by `apply.rs`; the writes here are the two
//! paths that legitimately bypass it (backup restore and the cover cache).
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
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
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub cover_checked: Option<bool>,
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
        cover_url: row.get("cover_url")?,
        cover_checked: Some(row.get::<_, i64>("cover_checked")? != 0),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_opened_at: row.get("last_opened_at")?,
        progress_percent: row.get("progress_percent")?,
        reading_status: row.get("reading_status")?,
        progress,
        starred: Some(row.get::<_, i64>("starred")? != 0),
        collection_id: row.get("collection_id")?,
    })
}

#[tauri::command]
pub fn library_load(db: State<'_, Db>) -> Result<Vec<LibraryBook>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM books")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_library_book)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn library_get_book(id: String, db: State<'_, Db>) -> Result<Option<LibraryBook>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT * FROM books WHERE id = ?1",
        params![id],
        row_to_library_book,
    ) {
        Ok(book) => Ok(Some(book)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn library_put_book(book: LibraryBook, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let progress_json = if book.progress.is_null() {
        None
    } else {
        Some(book.progress.to_string())
    };
    conn.execute(
        "INSERT INTO books
            (id, title, author, format, file_name, mime_type, file_size, cover_url,
             cover_checked, created_at, updated_at, last_opened_at, progress_percent,
             reading_status, progress_json, starred, collection_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, author=excluded.author, format=excluded.format,
            file_name=excluded.file_name, mime_type=excluded.mime_type,
            file_size=excluded.file_size, cover_url=excluded.cover_url,
            cover_checked=excluded.cover_checked, created_at=excluded.created_at,
            updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at,
            progress_percent=excluded.progress_percent, reading_status=excluded.reading_status,
            progress_json=excluded.progress_json, starred=excluded.starred,
            collection_id=excluded.collection_id",
        params![
            book.id,
            book.title,
            book.author,
            book.format,
            book.file_name,
            book.mime_type,
            book.file_size,
            book.cover_url,
            book.cover_checked.unwrap_or(false) as i64,
            book.created_at,
            book.updated_at,
            book.last_opened_at,
            book.progress_percent,
            book.reading_status,
            progress_json,
            book.starred.unwrap_or(false) as i64,
            book.collection_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Write a book's cover cache.
///
/// Covers are extracted locally from object-storage content, so they are NOT
/// domain facts and never enter the event log — this is the one projection
/// write that legitimately bypasses `commit_events`. `rebuild_projections`
/// preserves these columns for the same reason.
#[tauri::command]
pub fn library_set_book_cover(
    id: String,
    cover_url: Option<String>,
    cover_checked: bool,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET cover_url = ?2, cover_checked = ?3 WHERE id = ?1",
        params![id, cover_url, cover_checked as i64],
    )
    .map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for id in &ids {
        delete_blob_inner(&conn, &data_dir.0, &format!("bookfile:{id}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn library_list_collections(db: State<'_, Db>) -> Result<Vec<Collection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM collections")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Upsert a collection. On conflict the original `created_at` is preserved, so
/// this doubles as rename.
#[tauri::command]
pub fn library_put_collection(collection: Collection, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO collections (id, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![collection.id, collection.name, collection.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Collection deletion has no command of its own: `collection.removed` describes
// it, and applying that event drops the row and clears its books' membership.


// ── Content identity (dedup) ─────────────────────────────────────────────────

/// A book already holding this exact source file, if any — the import gate:
/// re-importing content the shelf has (including a copy synced in from
/// another device, whose manifest row carries the sha before any bytes do)
/// is a duplicate, not a new book.
#[tauri::command]
pub fn library_find_book_by_sha(
    sha256: String,
    exclude_id: Option<String>,
    db: State<'_, Db>,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
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
        other => Err(other.to_string()),
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
) -> Result<Vec<Vec<DuplicateBookEntry>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                DuplicateBookEntry { id: row.get(1)?, created_at: row.get(2)? },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut groups: Vec<Vec<DuplicateBookEntry>> = Vec::new();
    let mut current_sha: Option<String> = None;
    for row in rows {
        let (sha, entry) = row.map_err(|e| e.to_string())?;
        if current_sha.as_deref() != Some(&sha) {
            current_sha = Some(sha);
            groups.push(Vec::new());
        }
        groups.last_mut().expect("group pushed above").push(entry);
    }
    Ok(groups)
}
