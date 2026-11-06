//! IPC commands over `read_aware_store::storage::book_classification`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn book_classification_inspect(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<BookClassificationSnapshot>, CommandError> {
    crate::storage::blocking("book_classification_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_classification_inspect_inner(&mut conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn book_classification_commit(
    event: EventRow,
    expected_revision: Option<String>,
    app: tauri::AppHandle,
) -> Result<BookClassificationReceipt, CommandError> {
    crate::storage::blocking("book_classification_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_classification_commit_inner(&mut conn, &event, expected_revision.as_deref())
    })
    .await
}
