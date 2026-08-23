//! Plugin-private document collections — structured data one tier above the
//! plugin KV, plus the one-time vocabulary handoff into the dictionary plugin.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;

// --- Plugin documents (migration v10) ---

/// One plugin document; mirrors the web `PluginDocumentRow` wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDocumentRow {
    pub id: String,
    pub json: String,
    #[serde(default)]
    pub book_id: Option<String>,
    #[serde(default)]
    pub anchor: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDocumentSnapshotRow {
    pub collection: String,
    pub id: String,
    pub json: String,
    #[serde(default)]
    pub book_id: Option<String>,
    #[serde(default)]
    pub anchor: Option<String>,
    pub updated_at: String,
}

pub(crate) fn row_to_plugin_document(row: &rusqlite::Row) -> rusqlite::Result<PluginDocumentRow> {
    Ok(PluginDocumentRow {
        id: row.get("id")?,
        json: row.get("json")?,
        book_id: row.get("book_id")?,
        anchor: row.get("anchor")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn plugin_docs_put(
    plugin_id: String,
    collection: String,
    id: String,
    json: String,
    book_id: Option<String>,
    anchor: Option<String>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO plugin_documents
            (plugin_id, collection, id, json, book_id, anchor, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
            json=excluded.json, book_id=excluded.book_id, anchor=excluded.anchor,
            updated_at=excluded.updated_at",
        params![plugin_id, collection, id, json, book_id, anchor],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_docs_get(
    plugin_id: String,
    collection: String,
    id: String,
    db: State<'_, Db>,
) -> Result<Option<PluginDocumentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT id, json, book_id, anchor, updated_at FROM plugin_documents
         WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
        row_to_plugin_document,
    ) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn plugin_docs_delete(
    plugin_id: String,
    collection: String,
    id: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_docs_list(
    plugin_id: String,
    collection: String,
    book_id: Option<String>,
    limit: Option<i64>,
    oldest_first: Option<bool>,
    db: State<'_, Db>,
) -> Result<Vec<PluginDocumentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let order = if oldest_first.unwrap_or(false) {
        "ASC"
    } else {
        "DESC"
    };
    let sql = format!(
        "SELECT id, json, book_id, anchor, updated_at FROM plugin_documents
         WHERE plugin_id = ?1 AND collection = ?2
           AND (?3 IS NULL OR book_id = ?3)
         ORDER BY updated_at {order}
         LIMIT ?4"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![plugin_id, collection, book_id, limit.unwrap_or(i64::MAX)],
            row_to_plugin_document,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Uninstall wipe — documents die with the plugin (their declared lifecycle).
#[tauri::command]
pub fn plugin_docs_clear(plugin_id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1",
        params![plugin_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_docs_snapshot(
    plugin_id: String,
    db: State<'_, Db>,
) -> Result<Vec<PluginDocumentSnapshotRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    plugin_docs_snapshot_inner(&conn, &plugin_id)
}

pub(crate) fn plugin_docs_snapshot_inner(
    conn: &Connection,
    plugin_id: &str,
) -> Result<Vec<PluginDocumentSnapshotRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT collection, id, json, book_id, anchor, updated_at
             FROM plugin_documents WHERE plugin_id = ?1
             ORDER BY collection, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![plugin_id], |row| {
            Ok(PluginDocumentSnapshotRow {
                collection: row.get(0)?,
                id: row.get(1)?,
                json: row.get(2)?,
                book_id: row.get(3)?,
                anchor: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn plugin_docs_restore(
    plugin_id: String,
    rows: Vec<PluginDocumentSnapshotRow>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    plugin_docs_restore_inner(&mut conn, &plugin_id, rows)
}

pub(crate) fn plugin_docs_restore_inner(
    conn: &mut Connection,
    plugin_id: &str,
    rows: Vec<PluginDocumentSnapshotRow>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1",
        params![plugin_id],
    )
    .map_err(|e| e.to_string())?;
    for row in rows {
        tx.execute(
            "INSERT INTO plugin_documents
                (plugin_id, collection, id, json, book_id, anchor, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                plugin_id,
                row.collection,
                row.id,
                row.json,
                row.book_id,
                row.anchor,
                row.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// One-time migration: the retired core vocabulary projection moves into the
/// built-in dictionary plugin's document collection (dictionary/words), then
/// the source rows are deleted. Idempotent (second run finds no rows).
#[tauri::command]
pub fn vocabulary_migrate_to_plugin_documents(db: State<'_, Db>) -> Result<i64, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let moved: i64;
    {
        let mut stmt = tx
            .prepare(
                "SELECT id, term, language, entry_json, context, book_id, book_title, added_at
                 FROM vocabulary_entries WHERE removed_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
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
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
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
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute("DELETE FROM vocabulary_entries", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(moved)
}
