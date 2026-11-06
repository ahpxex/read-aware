//! IPC commands over `read_aware_store::storage::capability_changes`.
use crate::storage::*;

#[tauri::command]
pub async fn capability_changes_open(
    owner: String,
    selector: ChangeSelector,
    app: tauri::AppHandle,
) -> Result<String, CommandError> {
    crate::storage::blocking("capability_changes_open", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        capability_changes_open_inner(&mut conn, &owner, selector)
    })
    .await
}

#[tauri::command]
pub async fn capability_changes_read(
    owner: String,
    selector: ChangeSelector,
    cursor: String,
    limit: usize,
    app: tauri::AppHandle,
) -> Result<CapabilityChangePage, CommandError> {
    crate::storage::blocking("capability_changes_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        capability_changes_read_inner(&mut conn, &owner, selector, &cursor, limit)
    })
    .await
}
