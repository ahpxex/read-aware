//! IPC commands over `read_aware_store::storage::memory_creation`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn memory_create(
    event: EventRow,
    automatic: bool,
    app: tauri::AppHandle,
) -> Result<MemoryCreation, CommandError> {
    crate::storage::blocking("memory_create", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_create_inner(&mut conn, &event, automatic)
    })
    .await
}
