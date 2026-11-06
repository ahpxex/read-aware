//! IPC commands over `read_aware_store::storage::plugin_assets`.
use crate::storage::*;
use read_aware_store::storage::plugin_assets::*;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_asset_get(
    app: AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<PluginAsset>, CommandError> {
    blocking("plugin_asset_get", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        get_inner(&conn, &plugin_id, &key)
    })
    .await
}

#[tauri::command]
pub async fn plugin_asset_list(
    app: AppHandle,
    plugin_id: String,
    after: Option<String>,
    limit: Option<usize>,
) -> Result<PluginAssetPage, CommandError> {
    blocking("plugin_asset_list", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        list_inner(&conn, &plugin_id, after.as_deref(), limit)
    })
    .await
}

#[tauri::command]
pub async fn plugin_asset_policy(
    app: AppHandle,
    plugin_id: String,
) -> Result<PluginAssetPolicy, CommandError> {
    blocking("plugin_asset_policy", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        policy_inner(&conn, &plugin_id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_asset_delete(
    app: AppHandle,
    plugin_id: String,
    key: String,
    expected_revision: String,
) -> Result<PluginAssetDeletion, CommandError> {
    blocking("plugin_asset_delete", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let dir = app.state::<DataDir>();
        delete_inner(&mut conn, &dir.0, &plugin_id, &key, &expected_revision)
    })
    .await
}
