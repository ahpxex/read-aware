//! One replayable decision owns the confirmed profile, seed memories and retry receipt.
use super::{events, local_event_guard, user_profile, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "onboarding_tests.rs"]
mod tests;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Seed {
    pub(super) kind: String,
    pub(super) content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Change {
    pub(super) submission_id: String,
    pub(super) expected_revision: String,
    pub(super) summary: String,
    pub(super) seeds: Vec<Seed>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingReceipt {
    status: &'static str,
    submission_id: String,
    revision: String,
    memory_ids: Vec<String>,
    persistence: &'static str,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid onboarding submission")
}
fn conflict() -> CommandError {
    CommandError::new(
        "memory/conflict",
        "Onboarding submission or profile changed",
    )
}

pub(super) fn parse(event: &EventRow) -> Result<(Change, String, String), CommandError> {
    let input: Change = serde_json::from_value(event.payload.clone()).map_err(|_| invalid())?;
    let owner = event.origin.as_deref().ok_or_else(invalid)?;
    let revision = input
        .expected_revision
        .strip_prefix("profile2:")
        .ok_or_else(invalid)?;
    if event.event_type != "profile.onboarded"
        || event.aggregate_type.is_some()
        || event.aggregate_id.is_some()
        || !(matches!(owner, "user" | "agent")
            || owner
                .strip_prefix("plugin:")
                .is_some_and(|id| !id.is_empty() && id.len() <= 64))
        || input.submission_id.is_empty()
        || input.submission_id.len() > 64
        || !input
            .submission_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || revision.len() != 64
        || !revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || input.summary.trim().is_empty()
        || input.summary.encode_utf16().count() > 16_000
        || input.seeds.len() > 4
        || input.seeds.iter().any(|s| {
            !matches!(s.kind.as_str(), "fact" | "preference")
                || s.content.trim().is_empty()
                || s.content.encode_utf16().count() > 4000
        })
        || input
            .seeds
            .iter()
            .map(|s| &s.content)
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.seeds.len()
    {
        return Err(invalid());
    }
    let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&input)?));
    Ok((input, owner.to_owned(), hash))
}

pub(super) fn retained(
    conn: &Connection,
    input: &Change,
    owner: &str,
) -> Result<Option<(String, OnboardingReceipt)>, CommandError> {
    let row: Option<(String, String, String)> = conn.query_row(
        "SELECT request_hash,revision,memory_ids_json FROM onboarding_receipts WHERE owner=?1 AND submission_id=?2",
        params![owner, input.submission_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).optional()?;
    row.map(|(hash, revision, ids)| {
        Ok((
            hash,
            OnboardingReceipt {
                status: "already-completed",
                submission_id: input.submission_id.clone(),
                revision,
                memory_ids: serde_json::from_str(&ids)?,
                persistence: "event-log",
            },
        ))
    })
    .transpose()
}

pub(crate) fn onboarding_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
) -> Result<OnboardingReceipt, CommandError> {
    local_event_guard::validate_envelope(event)?;
    let (input, owner, hash) = parse(event)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    user_profile::require_initialized(&tx)?;
    if let Some((previous, receipt)) = retained(&tx, &input, &owner)? {
        if previous != hash {
            return Err(conflict());
        }
        tx.commit()?;
        return Ok(receipt);
    }
    if user_profile::read_snapshot(&tx)?.revision != input.expected_revision {
        return Err(conflict());
    }
    local_event_guard::validate_new_event(&tx, event)?;
    let report = events::commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
    if report.appended != 1 || report.applied != 1 {
        return Err(CommandError::internal("Incomplete onboarding commit"));
    }
    let (_, mut receipt) = retained(&tx, &input, &owner)?
        .ok_or_else(|| CommandError::internal("Missing onboarding receipt"))?;
    receipt.status = "completed";
    tx.commit()?;
    Ok(receipt)
}

#[tauri::command]
pub async fn onboarding_commit(
    event: EventRow,
    app: tauri::AppHandle,
) -> Result<OnboardingReceipt, CommandError> {
    super::blocking("onboarding_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        onboarding_commit_inner(&mut conn, &event)
    })
    .await
}
