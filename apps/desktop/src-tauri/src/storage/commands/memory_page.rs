//! IPC commands over `read_aware_store::storage::memory_page`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;
use serde_json::Value;

#[tauri::command]
pub async fn memories_page(
    query: Value,
    app: tauri::AppHandle,
) -> Result<MemoryPage, CommandError> {
    crate::storage::blocking("memories_page", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_page_inner(&mut conn, &query)
    })
    .await
}
