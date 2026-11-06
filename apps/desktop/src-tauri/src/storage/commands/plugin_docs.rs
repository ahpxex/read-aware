//! IPC commands over `read_aware_store::storage::plugin_docs`.
use crate::error::CommandError;
use crate::storage::*;
use tauri::Manager;

#[tauri::command]
pub async fn plugin_docs_put(
    plugin_id: String,
    collection: String,
    id: String,
    json: String,
    book_id: Option<String>,
    anchor: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("plugin_docs_put", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        plugin_docs_put_inner(&conn, &plugin_id, &collection, &id, &json, book_id, anchor)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_get(
    plugin_id: String,
    collection: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<PluginDocumentRow>, CommandError> {
    crate::storage::blocking("plugin_docs_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        plugin_docs_get_inner(&conn, &plugin_id, &collection, &id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_delete(
    plugin_id: String,
    collection: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("plugin_docs_delete", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        plugin_docs_delete_inner(&conn, &plugin_id, &collection, &id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_list(
    plugin_id: String,
    collection: String,
    book_id: Option<String>,
    limit: Option<i64>,
    oldest_first: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Vec<PluginDocumentRow>, CommandError> {
    crate::storage::blocking("plugin_docs_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        plugin_docs_list_inner(&conn, &plugin_id, &collection, book_id, limit, oldest_first)
    })
    .await
}

/// Uninstall wipe — documents die with the plugin (their declared lifecycle).
#[tauri::command]
pub async fn plugin_docs_clear(
    plugin_id: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("plugin_docs_clear", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        crate::storage::plugin_assets::assert_mutable(&conn, &plugin_id)?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM plugin_documents WHERE plugin_id = ?1",
            params![plugin_id],
        )?;
        tx.execute(
            "DELETE FROM plugin_document_generations WHERE plugin_id=?1",
            params![plugin_id],
        )?;
        tx.execute(
            "DELETE FROM atomic_receipts WHERE owner=?1",
            params![format!("plugin:{plugin_id}")],
        )?;
        tx.execute(
            "DELETE FROM durable_jobs WHERE owner=?1",
            params![format!("plugin:{plugin_id}")],
        )?;
        tx.execute(
            "DELETE FROM capability_change_cursors WHERE owner=?1",
            params![format!("plugin:{plugin_id}")],
        )?;
        tx.execute(
            "DELETE FROM capability_changes WHERE plugin_id=?1",
            params![plugin_id],
        )?;
        tx.commit()?;
        let dir = app.state::<DataDir>();
        crate::storage::plugin_assets::reclaim(&conn, &dir.0, &plugin_id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_snapshot(
    plugin_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<PluginDocumentSnapshotRow>, CommandError> {
    crate::storage::blocking("plugin_docs_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        plugin_docs_snapshot_inner(&conn, &plugin_id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_docs_restore(
    plugin_id: String,
    rows: Vec<PluginDocumentSnapshotRow>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("plugin_docs_restore", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        plugin_docs_restore_inner(&mut conn, &plugin_id, rows)
    })
    .await
}

/// One-time migration: the retired core vocabulary projection moves into the
/// built-in dictionary plugin's document collection (dictionary/words), then
/// the source rows are deleted. Idempotent (second run finds no rows).
#[tauri::command]
pub async fn vocabulary_migrate_to_plugin_documents(
    app: tauri::AppHandle,
) -> Result<i64, CommandError> {
    crate::storage::blocking("vocabulary_migrate_to_plugin_documents", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let moved: i64;
        {
            let mut stmt = tx.prepare(
                "SELECT id, term, language, entry_json, context, book_id, book_title, added_at
                 FROM vocabulary_entries WHERE removed_at IS NULL",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            moved = rows.len() as i64;
            for (id, term, language, entry_json, context, book_id, book_title, added_at) in rows {
                let entry: Value = serde_json::from_str(&entry_json).unwrap_or(Value::Null);
                let doc = serde_json::json!({
                    "term": term,
                    "language": language,
                    "entry": entry,
                    "context": context,
                    "bookTitle": book_title,
                    "addedAt": added_at,
                });
                tx.execute(
                    "INSERT OR IGNORE INTO plugin_documents
                    (plugin_id, collection, id, json, book_id, anchor, updated_at)
                 VALUES ('dictionary', 'words', ?1, ?2, ?3, NULL, ?4)",
                    params![id, doc.to_string(), book_id, added_at],
                )?;
            }
        }
        tx.execute("DELETE FROM vocabulary_entries", [])?;
        tx.commit()?;
        Ok(moved)
    })
    .await
}
