//! IPC commands over `read_aware_store::storage::annotation_pages`.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn annotations_page(
    input: AnnotationPageQuery,
    app: tauri::AppHandle,
) -> Result<AnnotationPage, CommandError> {
    crate::storage::blocking("annotations_page", move || {
        let db = tauri::Manager::state::<crate::storage::Db>(&app);
        let conn = db.0.lock()?;
        annotations_page_inner(&conn, input)
    })
    .await
}
