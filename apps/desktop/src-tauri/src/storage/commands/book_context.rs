//! IPC commands over `read_aware_store::storage::book_context`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;
use serde_json::Value;

#[tauri::command]
pub async fn book_context_snapshot(
    app: tauri::AppHandle,
    book_id: String,
    content_version: Option<String>,
) -> Result<Value, CommandError> {
    crate::storage::blocking("book_context_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        if content_version.is_some() {
            book_context_snapshot_versioned(&mut conn, &book_id, content_version.as_deref())
        } else {
            book_context_snapshot_inner(&mut conn, &book_id)
        }
    })
    .await
}
