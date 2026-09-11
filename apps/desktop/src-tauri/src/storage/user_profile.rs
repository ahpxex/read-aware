//! Conditional summary writes and retirement of the pre-event KV summary.
use super::{checkpoints, events, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "user_profile_tests.rs"]
mod tests;

const LEGACY_KEY: &str = "read-aware-agent-profile";
const SUMMARY_LIMIT: usize = 16_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    pub summary: Option<String>,
    pub revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMutationReceipt {
    pub changed: bool,
    pub revision: String,
    pub persistence: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInitializationReceipt {
    pub migrated: bool,
    pub snapshot: ProfileSnapshot,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid profile operation")
}

fn conflict(message: &str) -> CommandError {
    CommandError::new("memory/conflict", message)
}

fn require_fresh(conn: &Connection) -> Result<(), CommandError> {
    if events::projections_stale_conn(conn)? {
        return Err(conflict("Profile projection is awaiting replay"));
    }
    Ok(())
}

fn legacy_summary(conn: &Connection) -> Result<Option<String>, CommandError> {
    Ok(conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key=?1",
            [LEGACY_KEY],
            |row| row.get(0),
        )
        .optional()?)
}

fn require_initialized(conn: &Connection) -> Result<(), CommandError> {
    require_fresh(conn)?;
    let legacy: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM app_kv WHERE key=?1)",
        [LEGACY_KEY],
        |row| row.get(0),
    )?;
    if legacy {
        return Err(conflict("Legacy profile summary must be initialized first"));
    }
    Ok(())
}

fn read_snapshot(conn: &Connection) -> Result<ProfileSnapshot, CommandError> {
    let (summary, event): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT summary,updated_event_id FROM user_profile WHERE id='local'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .unwrap_or((None, None));
    // The projected event identity survives checkpoint bootstrap without its log tail.
    let bytes = serde_json::to_vec(&(&summary, event))?;
    Ok(ProfileSnapshot {
        summary,
        revision: format!("profile2:{:x}", Sha256::digest(bytes)),
    })
}

fn validate_envelope(event: &EventRow) -> Result<(), CommandError> {
    let valid_origin = event.origin.as_deref().is_some_and(|origin| {
        matches!(origin, "user" | "agent" | "system")
            || origin
                .strip_prefix("plugin:")
                .is_some_and(|id| !id.trim().is_empty())
    });
    if event.event_type != "profile.updated"
        || event.id.trim().is_empty()
        || event.id.encode_utf16().count() > 256
        || event.aggregate_type.is_some()
        || event.aggregate_id.is_some()
        || event.schema_version.is_some_and(|version| version != 1)
        || event
            .actor_id
            .as_deref()
            .is_some_and(|actor| actor != "local")
        || !valid_origin
        || !(0..=9_007_199_254_740_991).contains(&event.hlc.wall_ms)
        || !(0..=9_007_199_254_740_991).contains(&event.hlc.counter)
        || event.hlc.device_id.trim().is_empty()
    {
        return Err(invalid());
    }
    Ok(())
}

fn validate_new_event(conn: &Connection, event: &EventRow) -> Result<(), CommandError> {
    let device: Option<String> = conn
        .query_row("SELECT device_id FROM local_device WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()?;
    if device.as_deref() != Some(event.hlc.device_id.as_str()) {
        return Err(invalid());
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id=?1)",
        [&event.id],
        |row| row.get(0),
    )?;
    if exists {
        return Err(invalid());
    }
    let frontier: Option<checkpoints::HlcKey> = conn
        .query_row(
            "SELECT hlc_wall_ms,hlc_counter,hlc_device FROM (
            SELECT hlc_wall_ms,hlc_counter,hlc_device FROM domain_events
            UNION ALL
            SELECT hlc_wall_ms,hlc_counter,hlc_device FROM projection_checkpoints
         ) ORDER BY hlc_wall_ms DESC,hlc_counter DESC,hlc_device DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if frontier.is_some_and(|key| checkpoints::hlc_key_of(&event.hlc) <= key) {
        return Err(conflict(
            "Profile event clock must follow the current log and checkpoint",
        ));
    }
    Ok(())
}

fn append(tx: &Transaction<'_>, event: &EventRow) -> Result<(), CommandError> {
    let report = events::commit_events_in_transaction(tx, std::slice::from_ref(event))?;
    if report.appended != 1 || report.applied != 1 {
        return Err(CommandError::internal("Incomplete profile commit"));
    }
    Ok(())
}

pub(crate) fn profile_inspect_inner(
    conn: &mut Connection,
) -> Result<ProfileSnapshot, CommandError> {
    let tx = conn.transaction()?;
    require_initialized(&tx)?;
    let snapshot = read_snapshot(&tx)?;
    tx.commit()?;
    Ok(snapshot)
}

pub(crate) fn profile_initialize_inner(
    conn: &mut Connection,
    envelope: &EventRow,
) -> Result<ProfileInitializationReceipt, CommandError> {
    validate_envelope(envelope)?;
    if envelope.origin.as_deref() != Some("system")
        || !envelope.payload.as_object().is_some_and(|p| p.is_empty())
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_fresh(&tx)?;
    let mut migrated = false;
    if let Some(summary) = legacy_summary(&tx)? {
        if !checkpoints::log_complete(&tx)? {
            return Err(CommandError::new(
                checkpoints::CODE_SYNC_LOG_INCOMPLETE,
                "Profile migration requires complete summary history",
            ));
        }
        // A null summary event is an explicit clear, not an absent decision.
        let decided: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_events
                WHERE type='profile.updated' AND json_type(payload_json,'$.summary') IS NOT NULL)",
            [],
            |row| row.get(0),
        )?;
        if !decided {
            validate_new_event(&tx, envelope)?;
            let mut event = envelope.clone();
            event.payload = serde_json::json!({"summary": summary});
            append(&tx, &event)?;
            migrated = true;
        }
        tx.execute("DELETE FROM app_kv WHERE key=?1", [LEGACY_KEY])?;
    }
    let snapshot = read_snapshot(&tx)?;
    tx.commit()?;
    Ok(ProfileInitializationReceipt { migrated, snapshot })
}

fn commit_summary(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
    limit: Option<usize>,
) -> Result<ProfileMutationReceipt, CommandError> {
    validate_envelope(event)?;
    let payload = event.payload.as_object().ok_or_else(invalid)?;
    let summary = payload
        .get("summary")
        .and_then(|v| v.as_str())
        .ok_or_else(invalid)?;
    if payload.len() != 1 || limit.is_some_and(|max| summary.encode_utf16().count() > max) {
        return Err(invalid());
    }
    let hash = expected_revision
        .strip_prefix("profile2:")
        .ok_or_else(invalid)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_initialized(&tx)?;
    let previous = read_snapshot(&tx)?;
    if previous.revision != expected_revision {
        return Err(conflict("Profile changed since it was read"));
    }
    validate_new_event(&tx, event)?;
    let changed = previous.summary.as_deref() != Some(summary);
    if changed {
        append(&tx, event)?;
    }
    let revision = read_snapshot(&tx)?.revision;
    tx.commit()?;
    Ok(ProfileMutationReceipt {
        changed,
        revision,
        persistence: "event-log",
    })
}

pub(crate) fn profile_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
) -> Result<ProfileMutationReceipt, CommandError> {
    commit_summary(conn, event, expected_revision, Some(SUMMARY_LIMIT))
}

pub(crate) fn profile_restore_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
) -> Result<ProfileMutationReceipt, CommandError> {
    // Archive compatibility is a separate host entry, never an actor override flag.
    if event.origin.as_deref() != Some("user") {
        return Err(invalid());
    }
    commit_summary(conn, event, expected_revision, None)
}

#[tauri::command]
pub async fn profile_inspect(app: tauri::AppHandle) -> Result<ProfileSnapshot, CommandError> {
    super::blocking("profile_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_inspect_inner(&mut conn)
    })
    .await
}

#[tauri::command]
pub async fn profile_initialize(
    event: EventRow,
    app: tauri::AppHandle,
) -> Result<ProfileInitializationReceipt, CommandError> {
    super::blocking("profile_initialize", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_initialize_inner(&mut conn, &event)
    })
    .await
}

#[tauri::command]
pub async fn profile_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<ProfileMutationReceipt, CommandError> {
    super::blocking("profile_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}

#[tauri::command]
pub async fn profile_restore(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<ProfileMutationReceipt, CommandError> {
    super::blocking("profile_restore", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_restore_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
