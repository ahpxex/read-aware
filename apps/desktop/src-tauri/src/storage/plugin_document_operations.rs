//! Bounded, revision-aware operations over one plugin's local documents.
use super::*;
use super::plugin_docs::row_to_plugin_document;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::OptionalExtension;

const PAGE_BYTES: usize = 4 * 1024 * 1024;
const BATCH_BYTES: usize = 8 * 1024 * 1024;

fn invalid(message: &str) -> CommandError {
    CommandError::new("plugin/invalid-argument", message)
}

fn validate_key(value: &str, max: usize) -> Result<(), CommandError> {
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(invalid("Invalid document identifier"));
    }
    Ok(())
}

fn validate_collection(value: &str) -> Result<(), CommandError> {
    validate_key(value, 64)?;
    if !value.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
        || !value.as_bytes()[0].is_ascii_alphanumeric() {
        return Err(invalid("Invalid collection name"));
    }
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginDocumentPageQuery {
    pub book_id: Option<String>,
    pub limit: Option<usize>,
    pub oldest_first: Option<bool>,
    pub cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentCursor {
    version: u8,
    plugin_id: String,
    collection: String,
    book_id: Option<String>,
    oldest_first: bool,
    generation: String,
    updated_at: String,
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PluginDocumentPageResult {
    StaleCursor,
    Ready {
        items: Vec<PluginDocumentRow>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
}

#[tauri::command]
pub async fn plugin_docs_page(
    plugin_id: String, collection: String, query: PluginDocumentPageQuery, app: tauri::AppHandle,
) -> Result<PluginDocumentPageResult, CommandError> {
    crate::storage::blocking("plugin_docs_page", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        plugin_docs_page_inner(&mut conn, &plugin_id, &collection, query)
    }).await
}

pub(crate) fn plugin_docs_page_inner(
    conn: &mut Connection, plugin_id: &str, collection: &str, query: PluginDocumentPageQuery,
) -> Result<PluginDocumentPageResult, CommandError> {
    validate_key(plugin_id, 128)?;
    validate_collection(collection)?;
    if let Some(book_id) = &query.book_id { validate_key(book_id, 1024)?; }
    let limit = query.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) { return Err(invalid("Document page limit must be 1..200")); }
    let oldest = query.oldest_first.unwrap_or(false);
    let cursor: Option<DocumentCursor> = query.cursor.as_ref().map(|token| {
        if token.len() > 8192 { return Err(invalid("Document cursor is too large")); }
        let bytes = URL_SAFE_NO_PAD.decode(token).map_err(|_| invalid("Invalid document cursor"))?;
        serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid document cursor"))
    }).transpose()?;
    if let Some(cursor) = &cursor {
        if cursor.version != 1 || cursor.plugin_id != plugin_id || cursor.collection != collection
            || cursor.book_id != query.book_id || cursor.oldest_first != oldest {
            return Err(invalid("Document cursor belongs to a different query"));
        }
    }
    // The generation and page must see the same SQLite snapshot, even when
    // another connection commits while a page is being assembled.
    let tx = conn.transaction()?;
    let generation: Option<String> = tx.query_row(
        "SELECT generation FROM plugin_document_generations WHERE plugin_id=?1 AND collection=?2",
        params![plugin_id, collection], |row| row.get(0),
    ).optional()?;
    if cursor.as_ref().is_some_and(|c| generation.as_ref() != Some(&c.generation)) {
        return Ok(PluginDocumentPageResult::StaleCursor);
    }
    let order = if oldest { "ASC" } else { "DESC" };
    let comparison = if oldest { ">" } else { "<" };
    let book_filter = if query.book_id.is_some() { "AND book_id = :book" } else { "AND :book IS NULL" };
    let sql = format!("SELECT id, json, book_id, anchor, updated_at, revision FROM plugin_documents
        WHERE plugin_id=:plugin AND collection=:collection {book_filter}
        AND (:updated IS NULL OR (updated_at, id) {comparison} (:updated, :id))
        ORDER BY updated_at {order}, id {order} LIMIT :limit");
    let mut stmt = tx.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::named_params! {
        ":plugin": plugin_id, ":collection": collection, ":book": query.book_id,
        ":updated": cursor.as_ref().map(|c| &c.updated_at), ":id": cursor.as_ref().map(|c| &c.id),
        ":limit": (limit + 1) as i64,
    })?;
    let mut items = Vec::new();
    let mut bytes = 0;
    let mut more = false;
    while let Some(row) = rows.next()? {
        let doc = row_to_plugin_document(row)?;
        if items.len() == limit || bytes + doc.json.len() > PAGE_BYTES {
            if items.is_empty() {
                return Err(CommandError::new("plugin/quota-exceeded", "Document exceeds page byte budget"));
            }
            more = true;
            break;
        }
        bytes += doc.json.len();
        items.push(doc);
    }
    let next_cursor = if more {
        let last = items.last().expect("nonempty bounded page");
        Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&DocumentCursor {
            version: 1, plugin_id: plugin_id.into(), collection: collection.into(),
            book_id: query.book_id, oldest_first: oldest,
            generation: generation.ok_or_else(|| CommandError::new("db/error", "Missing document generation"))?,
            updated_at: last.updated_at.clone(), id: last.id.clone(),
        })?))
    } else { None };
    Ok(PluginDocumentPageResult::Ready { items, next_cursor })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDocumentMutation {
    pub collection: String,
    pub id: String,
    pub expected_revision: Option<String>,
    #[serde(flatten)]
    pub operation: PluginDocumentOperation,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PluginDocumentOperation {
    #[serde(rename_all = "camelCase")]
    Put { json: String, book_id: Option<String>, anchor: Option<String> },
    Delete,
    Check,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDocumentReceipt {
    collection: String,
    id: String,
    revision: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PluginDocumentCommitResult {
    Conflict { index: usize },
    Applied { documents: Vec<PluginDocumentReceipt> },
}

#[tauri::command]
pub async fn plugin_docs_apply(
    plugin_id: String, changes: Vec<PluginDocumentMutation>, app: tauri::AppHandle,
) -> Result<PluginDocumentCommitResult, CommandError> {
    crate::storage::blocking("plugin_docs_apply", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        plugin_docs_apply_inner(&mut conn, &plugin_id, changes)
    }).await
}

pub(crate) fn plugin_docs_apply_inner(
    conn: &mut Connection, plugin_id: &str, changes: Vec<PluginDocumentMutation>,
) -> Result<PluginDocumentCommitResult, CommandError> {
    validate_key(plugin_id, 128)?;
    if changes.is_empty() || changes.len() > 100 { return Err(invalid("Expected 1..100 document changes")); }
    let mut seen = std::collections::HashSet::new();
    let mut bytes = 0;
    for change in &changes {
        validate_collection(&change.collection)?;
        validate_key(&change.id, 1024)?;
        if !seen.insert((&change.collection, &change.id)) { return Err(invalid("Duplicate document change")); }
        if let Some(revision) = &change.expected_revision {
            if revision.len() != 32 || !revision.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err(invalid("Invalid expected document revision"));
            }
        }
        if let PluginDocumentOperation::Put { json, book_id, anchor } = &change.operation {
            if json.len() > PAGE_BYTES { return Err(CommandError::new("plugin/quota-exceeded", "Document exceeds 4 MiB")); }
            bytes += json.len();
            if bytes > BATCH_BYTES { return Err(CommandError::new("plugin/quota-exceeded", "Document batch exceeds 8 MiB")); }
            serde_json::from_str::<Value>(json).map_err(|_| invalid("Invalid document JSON"))?;
            if let Some(book_id) = book_id { validate_key(book_id, 1024)?; }
            if let Some(anchor) = anchor { validate_key(anchor, 16384)?; }
        }
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for (index, change) in changes.iter().enumerate() {
        let revision: Option<String> = tx.query_row(
            "SELECT revision FROM plugin_documents WHERE plugin_id=?1 AND collection=?2 AND id=?3",
            params![plugin_id, change.collection, change.id], |row| row.get(0),
        ).optional()?;
        if revision != change.expected_revision { return Ok(PluginDocumentCommitResult::Conflict { index }); }
    }
    let mut documents = Vec::with_capacity(changes.len());
    for change in changes {
        match change.operation {
            PluginDocumentOperation::Put { json, book_id, anchor } => {
                tx.execute("INSERT INTO plugin_documents (plugin_id, collection, id, json, book_id, anchor, updated_at)
                    VALUES (?1,?2,?3,?4,?5,?6,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
                    json=excluded.json, book_id=excluded.book_id, anchor=excluded.anchor, updated_at=excluded.updated_at",
                    params![plugin_id, change.collection, change.id, json, book_id, anchor])?;
            }
            PluginDocumentOperation::Delete => {
                tx.execute("DELETE FROM plugin_documents WHERE plugin_id=?1 AND collection=?2 AND id=?3",
                    params![plugin_id, change.collection, change.id])?;
            }
            PluginDocumentOperation::Check => {}
        }
        let revision = tx.query_row(
            "SELECT revision FROM plugin_documents WHERE plugin_id=?1 AND collection=?2 AND id=?3",
            params![plugin_id, change.collection, change.id], |row| row.get(0),
        ).optional()?;
        documents.push(PluginDocumentReceipt { collection: change.collection, id: change.id, revision });
    }
    tx.commit()?;
    Ok(PluginDocumentCommitResult::Applied { documents })
}

#[cfg(test)]
#[path = "plugin_document_operations_tests.rs"]
mod tests;
