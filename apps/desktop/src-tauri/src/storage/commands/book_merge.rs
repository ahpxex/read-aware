//! IPC commands over `read_aware_store::storage::book_merge`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{DataDir, Db, EventRow};
use rusqlite::OptionalExtension;
use tauri::Manager;

#[tauri::command]
pub async fn library_merge_preview(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<MergePreview>, CommandError> {
    crate::storage::blocking("library_merge_preview", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let result = merge_preview(&tx, &book_id)?;
        tx.commit()?;
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn library_duplicate_groups(
    app: tauri::AppHandle,
    offset: usize,
    limit: usize,
) -> Result<DuplicatePage, CommandError> {
    crate::storage::blocking("library_duplicate_groups", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        duplicate_page(&conn, offset, limit)
    })
    .await
}

#[tauri::command]
pub async fn library_resolve_book(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<String>, CommandError> {
    crate::storage::blocking("library_resolve_book", move || { validate(&book_id)?; let db = app.state::<Db>(); let conn = db.0.lock()?; current(&conn)?;
        conn.query_row("SELECT id FROM books WHERE id=?1 UNION ALL SELECT a.keep_id FROM book_aliases a JOIN books b ON b.id=a.keep_id WHERE a.merged_id=?1 LIMIT 1",
            [&book_id], |row| row.get(0)).optional().map_err(Into::into) }).await
}

#[tauri::command]
pub async fn library_merge_commit(
    app: tauri::AppHandle,
    book_id: String,
    expected_revision: String,
    events: Vec<EventRow>,
) -> Result<MergeReceipt, CommandError> {
    crate::storage::blocking("library_merge_commit", move || {
        let db = app.state::<Db>();
        let data = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        merge_commit(&mut conn, &data.0, &book_id, &expected_revision, &events)
    })
    .await
}
