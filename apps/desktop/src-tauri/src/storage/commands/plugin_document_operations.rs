//! IPC commands over `read_aware_store::storage::plugin_document_operations`.
use crate::storage::*;

#[tauri::command]
pub async fn plugin_docs_page(
    plugin_id: String,
    collection: String,
    query: PluginDocumentPageQuery,
    app: tauri::AppHandle,
) -> Result<PluginDocumentPageResult, CommandError> {
    crate::storage::blocking("plugin_docs_page", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        plugin_docs_page_inner(&mut conn, &plugin_id, &collection, query)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_apply(
    plugin_id: String,
    changes: Vec<PluginDocumentMutation>,
    app: tauri::AppHandle,
) -> Result<PluginDocumentCommitResult, CommandError> {
    crate::storage::blocking("plugin_docs_apply", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        plugin_docs_apply_inner(&mut conn, &plugin_id, changes)
    })
    .await
}
