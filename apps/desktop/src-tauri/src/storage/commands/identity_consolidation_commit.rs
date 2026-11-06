//! IPC commands over `read_aware_store::storage::identity_consolidation_commit`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn identity_consolidation_commit(
    expected_revision: String,
    profile_event: EventRow,
    entity_events: Vec<EventRow>,
    complete: bool,
    app: tauri::AppHandle,
) -> Result<IdentityConsolidationReceipt, CommandError> {
    crate::storage::blocking("identity_consolidation_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_commit_inner(
            &mut conn,
            &expected_revision,
            &profile_event,
            &entity_events,
            complete,
        )
    })
    .await
}
