//! IPC commands over `read_aware_store::storage::identity_consolidation`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;

#[tauri::command]
pub async fn identity_consolidation_snapshot(
    app: tauri::AppHandle,
) -> Result<IdentityConsolidationSnapshot, CommandError> {
    crate::storage::blocking("identity_consolidation_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_snapshot_inner(&mut conn)
    })
    .await
}
