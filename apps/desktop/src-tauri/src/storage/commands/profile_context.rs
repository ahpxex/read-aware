//! IPC commands over `read_aware_store::storage::profile_context`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;

#[tauri::command]
pub async fn profile_context(
    app: tauri::AppHandle,
) -> Result<ProfileContextSnapshot, CommandError> {
    crate::storage::blocking("profile_context", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_context_inner(&mut conn)
    })
    .await
}
