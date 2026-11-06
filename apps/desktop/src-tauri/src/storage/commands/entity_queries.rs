//! IPC commands over `read_aware_store::storage::entity_queries`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;
use serde_json::Value;

#[tauri::command]
pub async fn entity_query(query: Value, app: tauri::AppHandle) -> Result<EntityPage, CommandError> {
    crate::storage::blocking("entity_query", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        entity_query_inner(&mut conn, &query)
    })
    .await
}
