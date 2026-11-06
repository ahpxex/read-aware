//! IPC commands over `read_aware_store::storage::schema`.
use crate::error::CommandError;
use crate::storage::*;

/// Delete ALL user data on this device: every table row (log, projections,
/// registries, app_kv — which includes the sealed secrets), the blob files,
/// and the local encryption key. The schema survives; the device identity is
/// re-minted inside the same transaction so the very next write works. The
/// caller reloads the webview afterwards — in-memory JS state is stale by
/// definition once this returns.
#[tauri::command]
pub async fn wipe_all_data(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("wipe_all_data", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let mut conn = db.0.lock()?;
        crate::desktop_preferences::commit_entries(
            &app,
            &[(crate::desktop_preferences::GENERAL_KEY.to_string(), None)],
            || wipe_all_data_inner(&mut conn, &data_dir.0),
        )
    })
    .await
}
