//! Apply derived profile/entity decisions and idle completion in one transaction.
use super::{
    entity_mutations, events, identity_consolidation as identity, local_event_guard, Db, EventRow,
};
use crate::error::CommandError;
use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityConsolidationReceipt {
    pub revision: String,
    pub emitted_event_ids: Vec<String>,
    pub settled: bool,
}

fn invalid() -> CommandError {
    CommandError::new(
        "memory/invalid-input",
        "Invalid identity consolidation plan",
    )
}

fn validate_profile<'a>(
    event: &'a EventRow,
    snapshot: &identity::IdentityConsolidationSnapshot,
    entities: &[EventRow],
) -> Result<&'a serde_json::Value, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let traits = p
        .get("traits")
        .and_then(|v| v.as_object())
        .ok_or_else(invalid)?;
    if event.event_type != "profile.updated"
        || event.aggregate_type.is_some()
        || event.aggregate_id.is_some()
        || event.origin.as_deref() != Some("agent")
        || p.len() != 1
        || traits.len() != 1
    {
        return Err(invalid());
    }
    let block = traits.get("consolidated").ok_or_else(invalid)?;
    let derived: identity::ConsolidatedProfile =
        serde_json::from_value(block.clone()).map_err(|_| invalid())?;
    if derived.version != 1
        || derived.summary.encode_utf16().count() > 16_000
        || derived.sources != identity::source_conditions(&snapshot.sources)
        || derived.entity_evidence.len() != entities.len()
        || snapshot.sources.is_empty() && (!derived.summary.is_empty() || !entities.is_empty())
    {
        return Err(invalid());
    }
    let sources: HashSet<&str> = derived
        .sources
        .iter()
        .map(|source| source.memory_id.as_str())
        .collect();
    let mut ids = HashSet::from([event.id.as_str()]);
    let mut previous = None;
    for (entity, evidence) in entities.iter().zip(&derived.entity_evidence) {
        let key = super::checkpoints::hlc_key_of(&entity.hlc);
        if entity.origin.as_deref() != Some("agent")
            || evidence.event_id != entity.id
            || !ids.insert(&entity.id)
            || evidence.memory_ids.is_empty()
            || evidence.memory_ids.len() > sources.len()
            || previous.as_ref().is_some_and(|prev| prev >= &key)
        {
            return Err(invalid());
        }
        previous = Some(key);
        let mut used = HashSet::new();
        if evidence
            .memory_ids
            .iter()
            .any(|id| !sources.contains(id.as_str()) || !used.insert(id))
        {
            return Err(invalid());
        }
    }
    if previous.is_some_and(|key| key >= super::checkpoints::hlc_key_of(&event.hlc)) {
        return Err(invalid());
    }
    Ok(block)
}

pub(crate) fn identity_commit_inner(
    conn: &mut Connection,
    expected_revision: &str,
    profile_event: &EventRow,
    entity_events: &[EventRow],
    complete: bool,
) -> Result<IdentityConsolidationReceipt, CommandError> {
    if entity_events.len() > 32
        || expected_revision.len() != 69
        || !expected_revision.starts_with("icg1:")
        || !expected_revision[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let before = identity::read_snapshot(&tx)?;
    if before.revision != expected_revision {
        return Err(CommandError::new(
            "memory/conflict",
            "Identity consolidation source set changed",
        ));
    }
    let block = validate_profile(profile_event, &before, entity_events)?;
    let mut emitted_event_ids = Vec::new();
    for event in entity_events {
        if entity_mutations::apply_decision(&tx, event)? {
            emitted_event_ids.push(event.id.clone());
        }
    }
    local_event_guard::validate_new_event(&tx, profile_event)?;
    if before.derived.as_ref() != Some(block) {
        let report =
            events::commit_events_in_transaction(&tx, std::slice::from_ref(profile_event))?;
        if report.appended != 1 || report.applied != 1 {
            return Err(CommandError::internal("Incomplete derived profile commit"));
        }
        emitted_event_ids.push(profile_event.id.clone());
    }
    // Re-read within the write transaction: no unseen memory can be acknowledged.
    let after = identity::read_snapshot(&tx)?;
    if complete {
        tx.execute("INSERT INTO identity_consolidation_checkpoint (id,revision) VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision", [&after.revision])?;
    } else {
        tx.execute(
            "DELETE FROM identity_consolidation_checkpoint WHERE id=1",
            [],
        )?;
    }
    tx.commit()?;
    Ok(IdentityConsolidationReceipt {
        revision: after.revision,
        emitted_event_ids,
        settled: complete,
    })
}

#[tauri::command]
pub async fn identity_consolidation_commit(
    expected_revision: String,
    profile_event: EventRow,
    entity_events: Vec<EventRow>,
    complete: bool,
    app: tauri::AppHandle,
) -> Result<IdentityConsolidationReceipt, CommandError> {
    super::blocking("identity_consolidation_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_commit_inner(
            &mut conn,
            &expected_revision,
            &profile_event,
            &entity_events,
            complete,
        )
    })
    .await
}
