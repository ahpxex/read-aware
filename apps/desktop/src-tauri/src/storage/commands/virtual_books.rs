//! IPC commands over `read_aware_store::storage::virtual_books`.
use crate::storage::*;
use read_aware_store::storage::virtual_books::*;

#[tauri::command]
pub async fn virtual_book_create(
    events: Vec<EventRow>,
    book_id: String,
    binding: VirtualBinding,
    expected_registry: Option<String>,
    replacement_registry: String,
    app: tauri::AppHandle,
) -> Result<CommitReport, CommandError> {
    blocking("virtual_book_create", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        create_inner(
            &mut conn,
            &events,
            &book_id,
            &binding,
            expected_registry.as_deref(),
            &replacement_registry,
        )
    })
    .await
}

#[tauri::command]
pub async fn virtual_book_prune(
    book_ids: Vec<String>,
    expected_registry: Option<String>,
    replacement_registry: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    blocking("virtual_book_prune", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        prune_inner(
            &mut conn,
            &book_ids,
            expected_registry.as_deref(),
            &replacement_registry,
        )
    })
    .await
}
