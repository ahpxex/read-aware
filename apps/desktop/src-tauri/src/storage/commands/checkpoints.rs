//! IPC commands over `read_aware_store::storage::checkpoints`.
use crate::error::CommandError;
use crate::storage::*;
use tauri::Manager;

/// The schema version this build cuts and accepts checkpoints under.
#[tauri::command]
pub fn checkpoint_schema_version() -> i64 {
    SCHEMA_VERSION
}

/// Cut a local checkpoint if enough happened since the last one (see
/// `maintain_checkpoints`). Off the main thread: it copies every derived table.
#[tauri::command]
pub async fn checkpoint_maintain(app: AppHandle) -> Result<Option<CheckpointInfo>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        maintain_checkpoints(&mut conn, &data_dir.0)
    })
    .await
    .map_err(|e| format!("checkpoint_maintain task failed: {e}"))?
}

#[tauri::command]
pub async fn checkpoint_prepare_publish(app: AppHandle) -> Result<CheckpointInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        let info = create_publish_checkpoint(&mut conn, &data_dir.0)?;
        prune_checkpoints(&conn, &data_dir.0)?;
        Ok(info)
    })
    .await
    .map_err(|e| format!("checkpoint_prepare_publish task failed: {e}"))?
}

#[tauri::command]
pub async fn checkpoint_mark_published(id: i64, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("checkpoint_mark_published", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        mark_checkpoint_published(&conn, id)
    })
    .await
}

#[tauri::command]
pub async fn checkpoint_restore_bootstrap(
    blob_key: String,
    app: AppHandle,
) -> Result<CheckpointInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        restore_bootstrap_checkpoint(&mut conn, &data_dir.0, &blob_key)
    })
    .await
    .map_err(|e| format!("checkpoint_restore_bootstrap task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_backfill_status(
    app: tauri::AppHandle,
) -> Result<Option<BackfillStatus>, CommandError> {
    crate::storage::blocking("sync_backfill_status", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        backfill_status(&conn)
    })
    .await
}

#[tauri::command]
pub async fn sync_backfill_events(
    events: Vec<EventRow>,
    seqs: Vec<i64>,
    app: AppHandle,
) -> Result<BackfillReport, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        backfill_remote_events(&mut conn, &data_dir.0, &events, &seqs)
    })
    .await
    .map_err(|e| format!("sync_backfill_events task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_backfill_settle(app: AppHandle) -> Result<Option<BackfillStatus>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        settle_backfill(&mut conn, &data_dir.0)
    })
    .await
    .map_err(|e| format!("sync_backfill_settle task failed: {e}"))?
}
