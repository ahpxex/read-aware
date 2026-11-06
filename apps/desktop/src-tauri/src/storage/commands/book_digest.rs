//! IPC commands over `read_aware_store::storage::book_digest`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn book_digest_inspect(
    id: String,
    chapter_index: i64,
    app: tauri::AppHandle,
) -> Result<Option<BookDigestSnapshot>, CommandError> {
    crate::storage::blocking("book_digest_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_digest_inspect_inner(&mut conn, &id, chapter_index)
    })
    .await
}

#[tauri::command]
pub async fn book_digest_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<BookDigestSnapshot, CommandError> {
    crate::storage::blocking("book_digest_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_digest_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}

/// Host checkpoint reconciliation checks an immutable event, never an old projection.
#[tauri::command]
pub async fn book_digest_receipt(
    event: EventRow,
    app: tauri::AppHandle,
) -> Result<bool, CommandError> {
    crate::storage::blocking("book_digest_receipt", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        book_digest_receipt_inner(&conn, &event)
    })
    .await
}
