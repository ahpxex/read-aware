//! Plugin-private document collections — structured data one tier above the
//! plugin KV, plus the one-time vocabulary handoff into the dictionary plugin.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;
use crate::error::CommandError;

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
    pub revision: String,
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

pub fn row_to_plugin_document(row: &rusqlite::Row) -> rusqlite::Result<PluginDocumentRow> {
    Ok(PluginDocumentRow {
        id: row.get("id")?,
        json: row.get("json")?,
        book_id: row.get("book_id")?,
        anchor: row.get("anchor")?,
        updated_at: row.get("updated_at")?,
        revision: row.get("revision")?,
    })
}

pub fn plugin_docs_put_inner(
    conn: &Connection,
    plugin_id: &str,
    collection: &str,
    id: &str,
    json: &str,
    book_id: Option<String>,
    anchor: Option<String>,
) -> Result<(), CommandError> {
    conn.execute(
        "INSERT INTO plugin_documents
        (plugin_id, collection, id, json, book_id, anchor, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
        json=excluded.json, book_id=excluded.book_id, anchor=excluded.anchor,
        updated_at=excluded.updated_at",
        params![plugin_id, collection, id, json, book_id, anchor],
    )?;
    Ok(())
}

pub fn plugin_docs_get_inner(
    conn: &Connection,
    plugin_id: &str,
    collection: &str,
    id: &str,
) -> Result<Option<PluginDocumentRow>, CommandError> {
    match conn.query_row(
        "SELECT id, json, book_id, anchor, updated_at, revision FROM plugin_documents
     WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
        row_to_plugin_document,
    ) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn plugin_docs_delete_inner(
    conn: &Connection,
    plugin_id: &str,
    collection: &str,
    id: &str,
) -> Result<(), CommandError> {
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
    )?;
    Ok(())
}

pub fn plugin_docs_list_inner(
    conn: &Connection,
    plugin_id: &str,
    collection: &str,
    book_id: Option<String>,
    limit: Option<i64>,
    oldest_first: Option<bool>,
) -> Result<Vec<PluginDocumentRow>, CommandError> {
    let order = if oldest_first.unwrap_or(false) {
        "ASC"
    } else {
        "DESC"
    };
    let sql = format!(
        "SELECT id, json, book_id, anchor, updated_at, revision FROM plugin_documents
     WHERE plugin_id = ?1 AND collection = ?2
       AND (?3 IS NULL OR book_id = ?3)
     ORDER BY updated_at {order}, id {order}
     LIMIT ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            params![plugin_id, collection, book_id, limit.unwrap_or(i64::MAX)],
            row_to_plugin_document,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn plugin_docs_snapshot_inner(
    conn: &Connection,
    plugin_id: &str,
) -> Result<Vec<PluginDocumentSnapshotRow>, CommandError> {
    let mut stmt = conn.prepare(
        "SELECT collection, id, json, book_id, anchor, updated_at
             FROM plugin_documents WHERE plugin_id = ?1
             ORDER BY collection, id",
    )?;
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
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn plugin_docs_restore_inner(
    conn: &mut Connection,
    plugin_id: &str,
    rows: Vec<PluginDocumentSnapshotRow>,
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    replace_plugin_documents(&tx, plugin_id, rows)?;
    Ok(tx.commit()?)
}

pub fn replace_plugin_documents(
    tx: &Transaction<'_>,
    plugin_id: &str,
    rows: Vec<PluginDocumentSnapshotRow>,
) -> Result<(), CommandError> {
    tx.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
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
        )?;
    }
    Ok(())
}
