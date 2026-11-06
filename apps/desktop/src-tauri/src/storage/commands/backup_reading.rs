//! IPC commands over `read_aware_store::storage::backup_reading`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};
use tauri::Manager;

#[tauri::command]
pub async fn backup_close_reading_sessions(
    app: tauri::AppHandle,
    events: Vec<EventRow>,
) -> Result<Vec<EventRow>, CommandError> {
    crate::storage::blocking("backup_close_reading_sessions", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        close(&mut conn, events)
    })
    .await
}
