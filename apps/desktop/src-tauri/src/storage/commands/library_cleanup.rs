//! IPC commands over `read_aware_store::storage::library_cleanup`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{DataDir, Db};

#[tauri::command]
pub async fn library_list_removal_cleanup(
    after: Option<String>,
    limit: i64,
    app: tauri::AppHandle,
) -> Result<BookRemovalCleanupPage, CommandError> {
    crate::storage::blocking("library_list_removal_cleanup", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        list_removal_cleanup_inner(&conn, after.as_deref(), limit)
    })
    .await
}

#[tauri::command]
pub async fn library_release_book_files(
    ids: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_release_book_files", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let mut conn = db.0.lock()?;
        release_book_files_inner(&mut conn, &data_dir.0, &ids)
    })
    .await
}
