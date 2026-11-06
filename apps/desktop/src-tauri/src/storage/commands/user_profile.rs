//! IPC commands over `read_aware_store::storage::user_profile`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn profile_inspect(app: tauri::AppHandle) -> Result<ProfileSnapshot, CommandError> {
    crate::storage::blocking("profile_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_inspect_inner(&mut conn)
    })
    .await
}

#[tauri::command]
pub async fn profile_initialize(
    event: EventRow,
    app: tauri::AppHandle,
) -> Result<ProfileInitializationReceipt, CommandError> {
    crate::storage::blocking("profile_initialize", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_initialize_inner(&mut conn, &event)
    })
    .await
}

#[tauri::command]
pub async fn profile_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<ProfileMutationReceipt, CommandError> {
    crate::storage::blocking("profile_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
