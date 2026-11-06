//! IPC commands over `read_aware_store::storage::restored_credentials`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{DataDir, Db, EventRow};
use tauri::Manager;

#[tauri::command]
pub async fn restored_credentials_enqueue_current(
    app: tauri::AppHandle,
    only_unpublished: bool,
) -> Result<(), CommandError> {
    crate::storage::blocking("restored_credentials_enqueue_current", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        enqueue_current(&mut conn, only_unpublished)
    })
    .await
}

#[tauri::command]
pub async fn restored_credentials_pending(
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("restored_credentials_pending", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        pending(&conn)
    })
    .await
}

#[tauri::command]
pub async fn restored_credentials_publish(
    app: tauri::AppHandle,
    events: Vec<EventRow>,
) -> Result<PublicationReport, CommandError> {
    crate::storage::blocking("restored_credentials_publish", move || {
        let db = app.state::<Db>();
        let root = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        publish(&mut conn, &root.0, events)
    })
    .await
}
