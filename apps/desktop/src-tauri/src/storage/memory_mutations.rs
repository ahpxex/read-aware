//! User feedback changes only existing active memories, inside the event transaction.
use super::{events::commit_events_in_transaction, row_to_memory, Db, EventRow, Memory};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "memory_mutations_tests.rs"]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub memory: Memory,
    pub revision: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMutationReceipt {
    pub memory_id: String,
    pub revision: Option<String>,
}
fn invalid() -> CommandError {
    CommandError::new(
        "memory/invalid-input",
        "Invalid conditional memory operation",
    )
}
fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.encode_utf16().count() <= 256
}
pub(crate) fn read_snapshot(conn: &Connection, id: &str) -> Result<Option<MemorySnapshot>, CommandError> {
    let Some(memory) = conn
        .query_row(
            "SELECT * FROM memories WHERE id=?1 AND status='active'",
            [id],
            row_to_memory,
        )
        .optional()?
    else {
        return Ok(None);
    };
    // Event identity closes equal-timestamp ABA and changes with equal projected bytes.
    let event: Option<String> = conn.query_row(
        "SELECT id FROM domain_events WHERE aggregate_type='memory' AND aggregate_id=?1 ORDER BY rowid DESC LIMIT 1",
        [id], |row| row.get(0),
    ).optional()?;
    let bytes =
        serde_json::to_vec(&(&memory, event)).map_err(|e| CommandError::internal(e.to_string()))?;
    Ok(Some(MemorySnapshot {
        memory,
        revision: format!("mem1:{:x}", Sha256::digest(bytes)),
    }))
}
pub(crate) fn memory_inspect_inner(
    conn: &mut Connection,
    id: &str,
) -> Result<Option<MemorySnapshot>, CommandError> {
    if !valid_id(id) {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    let snapshot = read_snapshot(&tx, id)?;
    tx.commit()?;
    Ok(snapshot)
}
fn target(event: &EventRow) -> Result<&str, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let id = p
        .get("memoryId")
        .and_then(|v| v.as_str())
        .ok_or_else(invalid)?;
    if !valid_id(id)
        || event.aggregate_type.as_deref() != Some("memory")
        || event.aggregate_id.as_deref() != Some(id)
        || event.id.is_empty()
    {
        return Err(invalid());
    }
    let field = match event.event_type.as_str() {
        "memory.revised" => {
            if !p
                .get("content")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 16_000)
            {
                return Err(invalid());
            }
            "content"
        }
        "memory.feedback" => {
            if !p
                .get("signal")
                .and_then(|v| v.as_str())
                .is_some_and(|s| matches!(s, "pin" | "unpin"))
            {
                return Err(invalid());
            }
            "signal"
        }
        "memory.forgotten" => {
            if p.get("reason").and_then(|v| v.as_str()) != Some("user") {
                return Err(invalid());
            }
            "reason"
        }
        _ => return Err(invalid()),
    };
    if p.len() != 2 || p.keys().any(|key| key != "memoryId" && key != field) {
        return Err(invalid());
    }
    Ok(id)
}
pub(crate) fn memory_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
) -> Result<MemoryMutationReceipt, CommandError> {
    let id = target(event)?;
    if expected_revision.len() != 69
        || !expected_revision.starts_with("mem1:")
        || !expected_revision[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let snapshot = read_snapshot(&tx, id)?
        .ok_or_else(|| CommandError::new("memory/not-found", "Memory is no longer active"))?;
    if snapshot.revision != expected_revision {
        return Err(CommandError::new(
            "memory/conflict",
            "Memory changed since it was read",
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
        return Err(CommandError::internal("Incomplete memory feedback commit"));
    }
    let revision = read_snapshot(&tx, id)?.map(|snapshot| snapshot.revision);
    tx.commit()?;
    Ok(MemoryMutationReceipt {
        memory_id: id.into(),
        revision,
    })
}
#[tauri::command]
pub async fn memory_inspect(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memory_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_inspect_inner(&mut conn, &id)
    })
    .await
}
#[tauri::command]
pub async fn memory_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<MemoryMutationReceipt, CommandError> {
    crate::storage::blocking("memory_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
