//! Internal background plans use the same row/event revisions as user feedback.
use super::{
    events::commit_events_in_transaction,
    memory_mutations::{read_snapshot, MemorySnapshot},
    Db, EventRow,
};
use crate::error::CommandError;
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use std::collections::HashSet;

#[cfg(test)]
#[path = "memory_maintenance_tests.rs"]
mod tests;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCondition {
    pub memory_id: String,
    pub revision: String,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid memory maintenance plan")
}
fn conflict() -> CommandError {
    CommandError::new("memory/conflict", "Memory maintenance read set changed")
}

pub(crate) fn snapshots_inner(conn: &mut Connection) -> Result<Vec<MemorySnapshot>, CommandError> {
    let tx = conn.transaction()?;
    let ids = tx
        .prepare("SELECT id FROM memories WHERE status='active' ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let snapshots = ids
        .iter()
        .map(|id| read_snapshot(&tx, id)?.ok_or_else(conflict))
        .collect::<Result<Vec<_>, _>>()?;
    tx.commit()?;
    Ok(snapshots)
}

pub(crate) fn commit_inner(
    conn: &mut Connection,
    conditions: &[MemoryCondition],
    events: &[EventRow],
) -> Result<Vec<MemorySnapshot>, CommandError> {
    if conditions.is_empty()
        || events.is_empty()
        || events.len() > conditions.len().saturating_mul(4)
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut ids = HashSet::new();
    for condition in conditions {
        if !ids.insert(condition.memory_id.as_str()) {
            return Err(invalid());
        }
        let snapshot = read_snapshot(&tx, &condition.memory_id)?.ok_or_else(conflict)?;
        if snapshot.revision != condition.revision {
            return Err(conflict());
        }
    }
    let mut event_ids = HashSet::new();
    for (index, event) in events.iter().enumerate() {
        let p = event.payload.as_object().ok_or_else(invalid)?;
        let id = p
            .get("memoryId")
            .and_then(|value| value.as_str())
            .ok_or_else(invalid)?;
        if !ids.contains(id)
            || event.origin.as_deref() != Some("agent")
            || event.aggregate_type.as_deref() != Some("memory")
            || event.aggregate_id.as_deref() != Some(id)
            || event.id.is_empty()
            || !event_ids.insert(&event.id)
        {
            return Err(invalid());
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id=?1)",
            [&event.id],
            |row| row.get(0),
        )?;
        if exists {
            return Err(invalid());
        }
        let current = read_snapshot(&tx, id)?.ok_or_else(conflict)?.memory;
        match event.event_type.as_str() {
            "memory.forgotten"
                if p.len() == 2
                    && p.get("reason").and_then(|v| v.as_str()) == Some("decay")
                    && !current.pinned => {}
            "memory.superseded" if p.len() == 2 && !current.pinned => {
                let winner = p
                    .get("bySupersedingId")
                    .and_then(|v| v.as_str())
                    .ok_or_else(invalid)?;
                if winner == id || !ids.contains(winner) || read_snapshot(&tx, winner)?.is_none() {
                    return Err(invalid());
                }
                let next = events.get(index + 1).ok_or_else(invalid)?;
                if next.event_type != "memory.revised"
                    || next.payload.get("memoryId").and_then(|v| v.as_str()) != Some(winner)
                    || next.payload.get("evidenceCount").is_none()
                {
                    return Err(invalid());
                }
            }
            "memory.revised" => {
                if let Some(scope) = p.get("scope").and_then(|v| v.as_str()) {
                    if p.len() != 2
                        || !matches!(scope, "user" | "global")
                        || !current.scope.starts_with("book:")
                        || current.evidence_count < 3
                    {
                        return Err(invalid());
                    }
                } else {
                    let importance = p
                        .get("importance")
                        .and_then(|v| v.as_f64())
                        .ok_or_else(invalid)?;
                    if !importance.is_finite() || !(0.0..=1.0).contains(&importance) {
                        return Err(invalid());
                    }
                    if let Some(evidence) = p.get("evidenceCount") {
                        let next_evidence =
                            current.evidence_count.checked_add(1).ok_or_else(invalid)?;
                        if p.len() != 3
                            || evidence.as_i64() != Some(next_evidence)
                            || ![0.1_f64, 0.15].iter().any(|delta| {
                                (importance - (current.importance + delta).min(1.0)).abs() < 1e-12
                            })
                        {
                            return Err(invalid());
                        }
                    } else if p.len() != 2 || current.pinned || importance >= current.importance {
                        return Err(invalid());
                    }
                }
            }
            _ => return Err(invalid()),
        }
        let report = commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
        if report.appended != 1 || report.applied != 1 {
            return Err(CommandError::internal(
                "Incomplete memory maintenance commit",
            ));
        }
    }
    // Only acknowledge records this plan actually read. Newly inserted rows must
    // remain visible as a change to the next maintenance pass.
    let committed = conditions
        .iter()
        .map(|condition| read_snapshot(&tx, &condition.memory_id))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect();
    tx.commit()?;
    Ok(committed)
}

#[tauri::command]
pub async fn memories_snapshot(
    app: tauri::AppHandle,
) -> Result<Vec<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memories_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        snapshots_inner(&mut conn)
    })
    .await
}
#[tauri::command]
pub async fn memory_maintenance_commit(
    conditions: Vec<MemoryCondition>,
    events: Vec<EventRow>,
    app: tauri::AppHandle,
) -> Result<Vec<MemorySnapshot>, CommandError> {
    crate::storage::blocking("memory_maintenance_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        commit_inner(&mut conn, &conditions, &events)
    })
    .await
}
