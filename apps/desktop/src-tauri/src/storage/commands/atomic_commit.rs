//! IPC commands over `read_aware_store::storage::atomic_commit`.
use crate::storage::*;

#[tauri::command]
pub async fn atomic_commit(
    input: AtomicCommitInput,
    app: tauri::AppHandle,
) -> Result<AtomicCommitResult, CommandError> {
    crate::storage::blocking("atomic_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        atomic_commit_inner(&mut conn, input)
    })
    .await
}

#[tauri::command]
pub async fn atomic_aggregate_revisions(
    aggregates: Vec<(String, String)>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("atomic_aggregate_revisions", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        atomic_aggregate_revisions_inner(&mut conn, &aggregates)
    })
    .await
}

#[tauri::command]
pub async fn atomic_receipt_get(
    owner: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<Value>, CommandError> {
    crate::storage::blocking("atomic_receipt_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        atomic_receipt_get_inner(&conn, &owner, &id)
    })
    .await
}
