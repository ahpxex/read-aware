//! Conditional annotation writes share the event log's transaction and outbox.
use super::{events::commit_events_in_transaction, row_to_annotation, Annotation, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[cfg(test)]
#[path = "annotation_mutations_tests.rs"]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSnapshot {
    pub annotation: Annotation,
    pub revision: String,
}

// Call under a SQLite transaction: both the row and the log belong to one observation.
fn read_snapshot(conn: &Connection, id: &str) -> Result<Option<AnnotationSnapshot>, CommandError> {
    let Some(annotation) = conn
        .query_row(
            "SELECT * FROM annotations WHERE id=?1",
            [id],
            row_to_annotation,
        )
        .optional()?
    else {
        return Ok(None);
    };
    snapshot_for_annotation(conn, annotation).map(Some)
}

pub(crate) fn snapshot_for_annotation(
    conn: &Connection,
    annotation: Annotation,
) -> Result<AnnotationSnapshot, CommandError> {
    // A state hash alone misses ABA when equal-millisecond writes restore the old
    // bytes. Include the newest locally appended annotation event identity. Tokens
    // deliberately need not survive log replacement or transfer between devices.
    let event: Option<String> = conn.query_row(
        "SELECT id FROM domain_events WHERE aggregate_id=?1 AND aggregate_type IN ('note','highlight','ask') ORDER BY rowid DESC LIMIT 1",
        [&annotation.id], |row| row.get(0)).optional()?;
    let bytes = serde_json::to_vec(&(&annotation, event))
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let revision = format!("ann1:{:x}", Sha256::digest(bytes));
    Ok(AnnotationSnapshot {
        annotation,
        revision,
    })
}

pub(crate) fn annotation_inspect_inner(
    conn: &mut Connection,
    id: &str,
) -> Result<Option<AnnotationSnapshot>, CommandError> {
    if id.trim().is_empty() || id.encode_utf16().count() > 512 {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    let snapshot = read_snapshot(&tx, id)?;
    tx.commit()?;
    Ok(snapshot)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationCondition {
    pub annotation_id: String,
    pub expected_revision: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationChangeReceipt {
    pub annotation_id: String,
    pub revision: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationCommitResult {
    pub atomic: bool,
    pub changes: Vec<AnnotationChangeReceipt>,
}
fn invalid() -> CommandError {
    CommandError::new(
        "annotations/invalid-input",
        "Invalid annotation mutation batch",
    )
}

fn target(event: &EventRow) -> Result<(&str, &str), CommandError> {
    let (kind, key, fields) = match event.event_type.as_str() {
        "note.updated" => ("note", "noteId", &["noteId", "body"][..]),
        "highlight.recolored" => (
            "highlight",
            "highlightId",
            &["highlightId", "color", "style"][..],
        ),
        "note.removed" => ("note", "noteId", &["noteId"][..]),
        "highlight.removed" => ("highlight", "highlightId", &["highlightId"][..]),
        "ask.removed" => ("ask", "askId", &["askId"][..]),
        _ => return Err(invalid()),
    };
    let payload = event.payload.as_object().ok_or_else(invalid)?;
    if payload.keys().any(|key| !fields.contains(&key.as_str())) {
        return Err(invalid());
    }
    let id = payload
        .get(key)
        .and_then(|value| value.as_str())
        .ok_or_else(invalid)?;
    if id.trim().is_empty()
        || id.encode_utf16().count() > 512
        || event.aggregate_type.as_deref() != Some(kind)
        || event.aggregate_id.as_deref() != Some(id)
    {
        return Err(invalid());
    }
    if event.event_type == "note.updated" {
        if !payload
            .get("body")
            .and_then(|v| v.as_str())
            .is_some_and(|v| v.encode_utf16().count() <= 100_000)
        {
            return Err(invalid());
        }
    } else if event.event_type == "highlight.recolored" {
        if !payload
            .get("color")
            .and_then(|v| v.as_str())
            .is_some_and(|v| ["yellow", "green", "blue", "pink"].contains(&v))
        {
            return Err(invalid());
        }
        if payload.get("style").is_some_and(|v| {
            !v.as_str()
                .is_some_and(|v| ["highlight", "underline"].contains(&v))
        }) {
            return Err(invalid());
        }
    }
    Ok((kind, id))
}

pub(crate) fn annotations_commit_inner(
    conn: &mut Connection,
    events: &[EventRow],
    conditions: &[AnnotationCondition],
) -> Result<AnnotationCommitResult, CommandError> {
    if events.is_empty()
        || events.len() > 100
        || events.len() != conditions.len()
        || serde_json::to_vec(events).map_err(|_| invalid())?.len() > 1_048_576
    {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut event_ids = HashSet::new();
    for (event, condition) in events.iter().zip(conditions) {
        let (_, id) = target(event)?;
        let token = &condition.expected_revision;
        if condition.annotation_id != id
            || !ids.insert(id)
            || !event_ids.insert(&event.id)
            || event.id.is_empty()
            || token.len() != 69
            || !token.starts_with("ann1:")
            || !token[5..]
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (event, condition) in events.iter().zip(conditions) {
        let (kind, id) = target(event)?;
        let snapshot = read_snapshot(&tx, id)?.ok_or_else(|| {
            CommandError::new("annotations/not-found", "Annotation no longer exists")
        })?;
        if snapshot.annotation.kind != kind {
            return Err(CommandError::new(
                "annotations/not-found",
                "Annotation kind no longer matches",
            ));
        }
        if snapshot.revision != condition.expected_revision {
            return Err(CommandError::new(
                "annotations/conflict",
                "Annotation changed since it was read",
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
    }
    let report = commit_events_in_transaction(&tx, events)?;
    if report.appended != events.len() || report.applied != events.len() {
        return Err(CommandError::internal("Incomplete annotation commit"));
    }
    let mut changes = Vec::with_capacity(events.len());
    for condition in conditions {
        changes.push(AnnotationChangeReceipt {
            annotation_id: condition.annotation_id.clone(),
            revision: read_snapshot(&tx, &condition.annotation_id)?
                .map(|snapshot| snapshot.revision),
        });
    }
    tx.commit()?;
    Ok(AnnotationCommitResult {
        atomic: true,
        changes,
    })
}

#[tauri::command]
pub async fn annotation_inspect(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<AnnotationSnapshot>, CommandError> {
    crate::storage::blocking("annotation_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        annotation_inspect_inner(&mut conn, &id)
    })
    .await
}
#[tauri::command]
pub async fn annotations_commit(
    events: Vec<EventRow>,
    conditions: Vec<AnnotationCondition>,
    app: tauri::AppHandle,
) -> Result<AnnotationCommitResult, CommandError> {
    crate::storage::blocking("annotations_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        annotations_commit_inner(&mut conn, &events, &conditions)
    })
    .await
}
