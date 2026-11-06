//! IPC commands over `read_aware_store::storage::identity_work`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;

#[tauri::command]
pub async fn identity_work_read(
    expected_revision: String,
    index: i64,
    app: tauri::AppHandle,
) -> Result<IdentityWorkPage, CommandError> {
    crate::storage::blocking("identity_work_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_read_inner(&mut conn, &expected_revision, index)
    })
    .await
}

#[tauri::command]
pub async fn identity_work_append(
    expected_revision: String,
    index: i64,
    json: String,
    app: tauri::AppHandle,
) -> Result<IdentityWorkReceipt, CommandError> {
    crate::storage::blocking("identity_work_append", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_append_inner(&mut conn, &expected_revision, index, &json)
    })
    .await
}

#[tauri::command]
pub async fn identity_work_compact(
    expected_revision: String,
    expected_page_count: i64,
    json: String,
    app: tauri::AppHandle,
) -> Result<IdentityWorkReceipt, CommandError> {
    crate::storage::blocking("identity_work_compact", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_compact_inner(&mut conn, &expected_revision, expected_page_count, &json)
    })
    .await
}
