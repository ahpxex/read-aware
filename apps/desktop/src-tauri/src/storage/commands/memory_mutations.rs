//! IPC commands over `read_aware_store::storage::memory_mutations`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn memory_inspect(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memory_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_inspect_inner(&mut conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn memory_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<MemoryMutationReceipt, CommandError> {
    crate::storage::blocking("memory_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
