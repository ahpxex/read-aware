//! Classification is conditional state, not an unconditional late LLM write.
use super::{events::commit_events_in_transaction, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "book_classification_tests.rs"]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookClassificationSnapshot {
    pub book_id: String,
    pub narrativity: Option<String>,
    pub revision: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookClassificationReceipt {
    pub snapshot: BookClassificationSnapshot,
    pub changed: bool,
}
fn invalid() -> CommandError {
    CommandError::new(
        "memory/invalid-input",
        "Invalid conditional book classification",
    )
}
fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.encode_utf16().count() <= 256
}
pub(super) fn read_snapshot(
    conn: &Connection,
    id: &str,
) -> Result<Option<BookClassificationSnapshot>, CommandError> {
    let Some(narrativity) = conn
        .query_row("SELECT narrativity FROM books WHERE id=?1", [id], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()?
    else {
        return Ok(None);
    };
    if narrativity
        .as_deref()
        .is_some_and(|value| !matches!(value, "narrative" | "expository"))
    {
        return Err(CommandError::new(
            "db/error",
            "Invalid book classification projection",
        ));
    }
    // Ignore unrelated reading/metadata writes; include event identity to reject ABA.
    let event: Option<String> = conn.query_row(
        "SELECT id FROM domain_events WHERE aggregate_type='book' AND aggregate_id=?1 AND type IN ('book.imported','book.narrativityClassified','book.merged','book.removed') ORDER BY rowid DESC LIMIT 1",
        [id], |row| row.get(0),
    ).optional()?;
    let bytes = serde_json::to_vec(&(id, &narrativity, event))
        .map_err(|e| CommandError::internal(e.to_string()))?;
    Ok(Some(BookClassificationSnapshot {
        book_id: id.into(),
        narrativity,
        revision: format!("bcl1:{:x}", Sha256::digest(bytes)),
    }))
}
pub(crate) fn book_classification_inspect_inner(
    conn: &mut Connection,
    id: &str,
) -> Result<Option<BookClassificationSnapshot>, CommandError> {
    if !valid_id(id) {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    let result = read_snapshot(&tx, id)?;
    tx.commit()?;
    Ok(result)
}
pub(crate) fn book_classification_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: Option<&str>,
) -> Result<BookClassificationReceipt, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let id = p
        .get("bookId")
        .and_then(|v| v.as_str())
        .ok_or_else(invalid)?;
    let flavor = p
        .get("narrativity")
        .and_then(|v| v.as_str())
        .ok_or_else(invalid)?;
    let automatic = p.get("onlyIfUnclassified") == Some(&serde_json::Value::Bool(true));
    if !valid_id(id)
        || !matches!(flavor, "narrative" | "expository")
        || event.id.is_empty()
        || event.event_type != "book.narrativityClassified"
        || event.aggregate_type.as_deref() != Some("book")
        || event.aggregate_id.as_deref() != Some(id)
        || p.len() != if automatic { 3 } else { 2 }
        || p.keys().any(|key| {
            key != "bookId" && key != "narrativity" && !(automatic && key == "onlyIfUnclassified")
        })
    {
        return Err(invalid());
    }
    if automatic {
        if expected_revision.is_some() || event.origin.as_deref() != Some("agent") {
            return Err(invalid());
        }
    } else if !expected_revision
        .and_then(|value| value.strip_prefix("bcl1:"))
        .is_some_and(|token| {
            token.len() == 64
                && token
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let snapshot = read_snapshot(&tx, id)?
        .ok_or_else(|| CommandError::new("reader/book-not-found", "Book not found"))?;
    if automatic && snapshot.narrativity.is_some() {
        tx.commit()?;
        return Ok(BookClassificationReceipt {
            snapshot,
            changed: false,
        });
    }
    if !automatic && Some(snapshot.revision.as_str()) != expected_revision {
        return Err(CommandError::new(
            "memory/conflict",
            "Book classification changed since it was read",
        ));
    }
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id=?1)",
        [&event.id],
        |row| row.get(0),
    )?;
    if exists {
        return Err(invalid());
    }
    let report = commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
    if report.appended != 1 || report.applied != 1 {
        return Err(CommandError::internal("Incomplete classification commit"));
    }
    let snapshot = read_snapshot(&tx, id)?
        .ok_or_else(|| CommandError::internal("Classification target disappeared"))?;
    if snapshot.narrativity.as_deref() != Some(flavor) {
        return Err(CommandError::new(
            "memory/conflict",
            "Classification was superseded during ordered replay",
        ));
    }
    tx.commit()?;
    Ok(BookClassificationReceipt {
        snapshot,
        changed: true,
    })
}
#[tauri::command]
pub async fn book_classification_inspect(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<BookClassificationSnapshot>, CommandError> {
    crate::storage::blocking("book_classification_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_classification_inspect_inner(&mut conn, &id)
    })
    .await
}
#[tauri::command]
pub async fn book_classification_commit(
    event: EventRow,
    expected_revision: Option<String>,
    app: tauri::AppHandle,
) -> Result<BookClassificationReceipt, CommandError> {
    crate::storage::blocking("book_classification_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_classification_commit_inner(&mut conn, &event, expected_revision.as_deref())
    })
    .await
}
