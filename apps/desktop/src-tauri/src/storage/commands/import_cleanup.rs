//! IPC commands over `read_aware_store::storage::import_cleanup`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{DataDir, Db};
use tauri::Manager;

#[tauri::command]
pub async fn library_begin_import(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_begin_import", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        begin_inner(
            &conn,
            &app.state::<DataDir>().0,
            &book_id,
            &app.state::<ImportSession>().0,
        )
    })
    .await
}

#[tauri::command]
pub async fn library_finish_import(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_finish_import", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        finish_inner(
            &mut conn,
            &app.state::<DataDir>().0,
            &book_id,
            &app.state::<ImportSession>().0,
        )
    })
    .await
}
