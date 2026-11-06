//! IPC commands over `read_aware_store::storage::entity_mutations`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn entity_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<EntityMutationReceipt, CommandError> {
    crate::storage::blocking("entity_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        entity_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
