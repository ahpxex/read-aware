//! IPC commands over `read_aware_store::storage::plugin_storage_usage`.
use crate::storage::*;
use read_aware_store::storage::plugin_storage_usage::*;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_storage_usage(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<PluginStorageUsage, CommandError> {
    blocking("plugin_storage_usage", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let result = usage(&tx, &plugin_id)?;
        tx.commit()?;
        Ok(result)
    })
    .await
}
