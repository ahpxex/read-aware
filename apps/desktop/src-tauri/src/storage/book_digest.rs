//! A digest is committed against the classification and chapter observed before inference.
use super::{book_classification, events::commit_events_in_transaction, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "book_digest_tests.rs"]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDigestSnapshot {
    pub book_id: String,
    pub chapter_index: i64,
    pub flavor: String,
    pub revision: String,
}
type DigestRow = (
    Option<String>,
    String,
    String,
    String,
    i64,
    Option<String>,
    String,
);
fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid conditional chapter digest")
}
fn conflict() -> CommandError {
    CommandError::new(
        "memory/conflict",
        "Chapter digest or classification changed during generation",
    )
}
fn valid_target(id: &str, index: i64) -> bool {
    !id.trim().is_empty()
        && id.encode_utf16().count() <= 256
        && (0..=9_007_199_254_740_991).contains(&index)
}
fn read_digest(conn: &Connection, id: &str, index: i64) -> Result<Option<DigestRow>, CommandError> {
    Ok(conn.query_row("SELECT chapter_href,summary,characters_json,relations_json,digest_version,flavor,updated_at FROM chapter_digests WHERE book_id=?1 AND chapter_index=?2", params![id,index], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?)
}
fn snapshot(
    conn: &Connection,
    id: &str,
    index: i64,
) -> Result<Option<BookDigestSnapshot>, CommandError> {
    let Some(classification) = book_classification::read_snapshot(conn, id)? else {
        return Ok(None);
    };
    let row = read_digest(conn, id, index)?;
    let event: Option<String> = conn.query_row("SELECT id FROM domain_events WHERE aggregate_type='book' AND aggregate_id=?1 AND type='book.chapterDigested' AND json_extract(payload_json,'$.chapterIndex')=?2 ORDER BY rowid DESC LIMIT 1", params![id,index], |r| r.get(0)).optional()?;
    let bytes = serde_json::to_vec(&(id, index, &classification.revision, row, event))
        .map_err(|e| CommandError::internal(e.to_string()))?;
    Ok(Some(BookDigestSnapshot {
        book_id: id.into(),
        chapter_index: index,
        flavor: classification
            .narrativity
            .unwrap_or_else(|| "narrative".into()),
        revision: format!("bdg1:{:x}", Sha256::digest(bytes)),
    }))
}
pub(crate) fn book_digest_inspect_inner(
    conn: &mut Connection,
    id: &str,
    index: i64,
) -> Result<Option<BookDigestSnapshot>, CommandError> {
    if !valid_target(id, index) {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    let result = snapshot(&tx, id, index)?;
    tx.commit()?;
    Ok(result)
}
fn nonblank(value: &Value) -> bool {
    value.as_str().is_some_and(|s| !s.trim().is_empty())
}
fn valid_entities(value: &Value, relation: bool) -> bool {
    value.as_array().is_some_and(|items| {
        items.len() <= 12
            && items.iter().all(|item| {
                let Some(fields) = item.as_object() else {
                    return false;
                };
                let required: &[&str] = if relation {
                    &["from", "kind", "to"]
                } else {
                    &["name"]
                };
                required
                    .iter()
                    .all(|key| fields.get(*key).is_some_and(nonblank))
                    && fields.iter().all(|(key, value)| {
                        if required.contains(&key.as_str()) {
                            return true;
                        }
                        if key == "note" {
                            return value.is_string();
                        }
                        !relation
                            && key == "aliases"
                            && value
                                .as_array()
                                .is_some_and(|aliases| aliases.iter().all(nonblank))
                    })
            })
    })
}
pub(crate) fn book_digest_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
) -> Result<BookDigestSnapshot, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let id = p
        .get("bookId")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let index = p
        .get("chapterIndex")
        .and_then(Value::as_i64)
        .ok_or_else(invalid)?;
    let flavor = p
        .get("flavor")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if !valid_target(id, index)
        || !matches!(flavor, "narrative" | "expository")
        || event.id.is_empty()
        || event.event_type != "book.chapterDigested"
        || event.aggregate_type.as_deref() != Some("book")
        || event.aggregate_id.as_deref() != Some(id)
        || !p.get("summary").is_some_and(nonblank)
        || !p
            .get("characters")
            .is_some_and(|v| valid_entities(v, false))
        || !p.get("relations").is_some_and(|v| valid_entities(v, true))
        || !p
            .get("digestVersion")
            .and_then(Value::as_i64)
            .is_some_and(|n| (1..=9_007_199_254_740_991).contains(&n))
        || p.get("chapterHref").is_some_and(|v| !v.is_string())
        || p.keys().any(|k| {
            ![
                "bookId",
                "chapterIndex",
                "chapterHref",
                "summary",
                "characters",
                "relations",
                "digestVersion",
                "flavor",
            ]
            .contains(&k.as_str())
        })
        || !expected_revision.strip_prefix("bdg1:").is_some_and(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let before = snapshot(&tx, id, index)?
        .ok_or_else(|| CommandError::new("reader/book-not-found", "Book not found"))?;
    if before.revision != expected_revision || before.flavor != flavor {
        return Err(conflict());
    }
    // Local commit applies immediately, while rebuild orders by HLC. Reject a
    // stamp that would put this write before a relevant already-observed event.
    let out_of_order: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM domain_events WHERE aggregate_type='book' AND aggregate_id=?1 AND (type IN ('book.imported','book.narrativityClassified','book.merged','book.removed') OR (type='book.chapterDigested' AND json_extract(payload_json,'$.chapterIndex')=?2)) AND (hlc_wall_ms,hlc_counter,hlc_device)>=(?3,?4,?5))",
        params![id,index,event.hlc.wall_ms,event.hlc.counter,event.hlc.device_id], |r| r.get(0),
    )?;
    if out_of_order {
        return Err(conflict());
    }
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id=?1)",
        [&event.id],
        |r| r.get(0),
    )?;
    if exists {
        return Err(invalid());
    }
    let report = commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
    if report.appended != 1 || report.applied != 1 {
        return Err(CommandError::internal("Incomplete digest commit"));
    }
    let row = read_digest(&tx, id, index)?.ok_or_else(conflict)?;
    if row.0.as_deref() != p.get("chapterHref").and_then(Value::as_str)
        || Some(row.1.as_str()) != p.get("summary").and_then(Value::as_str)
        || row.2 != p["characters"].to_string()
        || row.3 != p["relations"].to_string()
        || Some(row.4) != p["digestVersion"].as_i64()
        || row.5.as_deref() != Some(flavor)
    {
        return Err(conflict());
    }
    let after = snapshot(&tx, id, index)?.ok_or_else(conflict)?;
    if after.flavor != flavor {
        return Err(conflict());
    }
    tx.commit()?;
    Ok(after)
}
#[tauri::command]
pub fn book_digest_inspect(
    id: String,
    chapter_index: i64,
    db: tauri::State<'_, Db>,
) -> Result<Option<BookDigestSnapshot>, CommandError> {
    let mut conn = db.0.lock()?;
    book_digest_inspect_inner(&mut conn, &id, chapter_index)
}
#[tauri::command]
pub fn book_digest_commit(
    event: EventRow,
    expected_revision: String,
    db: tauri::State<'_, Db>,
) -> Result<BookDigestSnapshot, CommandError> {
    let mut conn = db.0.lock()?;
    book_digest_commit_inner(&mut conn, &event, &expected_revision)
}
