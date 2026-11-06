//! IPC commands over `read_aware_store::storage::reading_snapshot`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;

#[tauri::command]
pub async fn reading_time_snapshot(
    query: ReadingTimeQuery,
    app: tauri::AppHandle,
) -> Result<ReadingTimeSnapshot, CommandError> {
    crate::storage::blocking("reading_time_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_time_snapshot_inner(&mut conn, query)
    })
    .await
}
