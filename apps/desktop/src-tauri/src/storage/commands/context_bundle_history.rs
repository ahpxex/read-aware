//! IPC commands over `read_aware_store::storage::context_bundle_history`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;
use serde_json::Value;

#[tauri::command]
pub async fn context_bundle_history(
    app: tauri::AppHandle,
    query: Value,
) -> Result<Value, CommandError> {
    crate::storage::blocking("context_bundle_history", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_history_inner(&mut conn, query)
    })
    .await
}

#[tauri::command]
pub async fn context_bundle_read(
    app: tauri::AppHandle,
    query: Value,
) -> Result<Value, CommandError> {
    crate::storage::blocking("context_bundle_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_read_inner(&mut conn, query)
    })
    .await
}
