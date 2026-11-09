//! IPC commands over `read_aware_store::storage::bookmarks`. Writes go through
//! `commit_events` (`bookmark.*` events); this is the read side.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn bookmarks_list(
    book_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<BookmarkRow>, CommandError> {
    crate::storage::blocking("bookmarks_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        bookmarks_list_inner(&conn, book_id.as_deref())
    })
    .await
}

/// One-transaction move of a plugin's private bookmark documents into the
/// library (see `adopt_plugin_documents_inner`).
#[tauri::command]
pub async fn bookmarks_adopt_plugin_documents(
    plugin_id: String,
    collection: String,
    adoptions: Vec<BookmarkAdoption>,
    app: tauri::AppHandle,
) -> Result<usize, CommandError> {
    crate::storage::blocking("bookmarks_adopt_plugin_documents", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        adopt_plugin_documents_inner(&mut conn, &plugin_id, &collection, &adoptions)
    })
    .await
}
