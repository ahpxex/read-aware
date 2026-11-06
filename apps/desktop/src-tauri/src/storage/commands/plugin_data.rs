//! IPC commands over `read_aware_store::storage::plugin_data`.
use crate::storage::*;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_data_snapshot(
    plugin_id: String,
    app: AppHandle,
) -> Result<PluginDataSnapshot, CommandError> {
    blocking("plugin_data_snapshot", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        plugin_data_snapshot_inner(&mut conn, &plugin_id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_data_restore(
    plugin_id: String,
    snapshot: PluginDataSnapshot,
    app: AppHandle,
) -> Result<(), CommandError> {
    blocking("plugin_data_restore", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        plugin_data_restore_inner(&mut conn, &plugin_id, snapshot)
    })
    .await
}
