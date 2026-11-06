//! IPC commands over `read_aware_store::storage::library`.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn library_load(app: tauri::AppHandle) -> Result<Vec<LibraryBook>, CommandError> {
    crate::storage::blocking("library_load", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare(BOOK_SELECT)?;
        let rows = stmt.query_map([], row_to_library_book)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn library_get_book(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<LibraryBook>, CommandError> {
    crate::storage::blocking("library_get_book", move || {
        let db = tauri::Manager::state::<Db>(&app);
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
    })
    .await
}

/// LEGACY-MIGRATION-ONLY projection writer, exempt from the `apply_event` rule
/// in `apply.rs`. Its only caller is the one-time, flag-gated pre-SQLite boot
/// migration (`apps/web/src/platform/desktop-import.ts`); boot-time genesis
/// reconciliation then synthesizes the creation events the log never saw.
/// Every other write goes through `commit_events` — do not add callers.
///
/// Upserts a row verbatim (id preserved). Cover state is NOT taken from the
/// input: a migrated row is 'ready' only if this device holds its cover blob (a
/// pre-v24 record's inline data URL is lifted into the store first); anything
/// else starts 'unchecked' and the engine job re-extracts from the book file.
#[tauri::command]
pub async fn library_put_book(
    book: LibraryBook,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_put_book", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
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
             reading_status, progress_json, starred, collection_id, narrativity, spoiler_sensitive)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, author=excluded.author, format=excluded.format,
            file_name=excluded.file_name, mime_type=excluded.mime_type,
            file_size=excluded.file_size, cover_status=excluded.cover_status,
            cover_blob_key=excluded.cover_blob_key, created_at=excluded.created_at,
            updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at,
            progress_percent=excluded.progress_percent, reading_status=excluded.reading_status,
            progress_json=excluded.progress_json, starred=excluded.starred,
            collection_id=excluded.collection_id, narrativity=excluded.narrativity, spoiler_sensitive=excluded.spoiler_sensitive",
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
                book.spoiler_sensitive,
            ],
        )
        ?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn library_list_collections(
    app: tauri::AppHandle,
) -> Result<Vec<Collection>, CommandError> {
    crate::storage::blocking("library_list_collections", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare("SELECT id, name, created_at FROM collections")?;
        let rows = stmt.query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}

/// LEGACY-MIGRATION-ONLY projection writer, exempt from the `apply_event` rule
/// in `apply.rs`. Its only caller is the one-time, flag-gated pre-SQLite boot
/// migration (`apps/web/src/platform/desktop-import.ts`); boot-time genesis
/// reconciliation then synthesizes the creation events the log never saw.
/// Every other write goes through `commit_events` — do not add callers.
///
/// Upserts a collection; on conflict the original `created_at` is preserved.
#[tauri::command]
pub async fn library_put_collection(
    collection: Collection,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_put_collection", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        conn.execute(
            "INSERT INTO collections (id, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![collection.id, collection.name, collection.created_at],
        )?;
        Ok(())
    })
    .await
}
