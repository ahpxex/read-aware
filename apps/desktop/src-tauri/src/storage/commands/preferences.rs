//! IPC commands over `read_aware_store::storage::preferences`.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn preferences_load_all(
    app: tauri::AppHandle,
) -> Result<Vec<PreferenceRow>, CommandError> {
    crate::storage::blocking("preferences_load_all", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        preferences_load_all_inner(&conn)
    })
    .await
}
