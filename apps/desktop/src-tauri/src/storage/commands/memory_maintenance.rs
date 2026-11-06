//! IPC commands over `read_aware_store::storage::memory_maintenance`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{memory_mutations::MemorySnapshot, Db, EventRow};

#[tauri::command]
pub async fn memories_snapshot(
    query: Option<serde_json::Value>,
    app: tauri::AppHandle,
) -> Result<Vec<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memories_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        if query.is_some() {
            snapshots_query_inner(&mut conn, query)
        } else {
            snapshots_inner(&mut conn)
        }
    })
    .await
}

#[tauri::command]
pub async fn memory_maintenance_commit(
    conditions: Vec<MemoryCondition>,
    events: Vec<EventRow>,
    app: tauri::AppHandle,
) -> Result<Vec<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memory_maintenance_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        commit_inner(&mut conn, &conditions, &events)
    })
    .await
}
