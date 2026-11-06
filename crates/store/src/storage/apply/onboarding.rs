use super::super::{
    onboarding::{parse, retained},
    user_profile, EventRow,
};
use crate::error::CommandError;
use rusqlite::{params, Transaction};
use serde_json::json;
use sha2::{Digest, Sha256};

pub(super) fn apply(tx: &Transaction<'_>, event: &EventRow) -> Result<bool, CommandError> {
    let (input, owner, hash) = parse(event)?;
    // Sorted replay makes the first submission authoritative. A second device
    // cannot replay its duplicate into another profile overwrite or new seeds.
    if retained(tx, &input, &owner)?.is_some() {
        return Ok(false);
    }
    let mut derived = event.clone();
    derived.event_type = "profile.updated".into();
    derived.payload = json!({"summary": input.summary});
    super::apply_event(tx, &derived)?;
    let mut ids = Vec::new();
    for (index, seed) in input.seeds.iter().enumerate() {
        let id = format!(
            "onboarding:{:x}",
            Sha256::digest(format!("{}:{index}", event.id).as_bytes())
        );
        derived.event_type = "memory.promoted".into();
        derived.payload = json!({"memoryId": id, "scope": "user", "kind": seed.kind, "content": seed.content, "importance": 0.7});
        super::apply_event(tx, &derived)?;
        ids.push(id);
    }
    let revision = user_profile::read_snapshot(tx)?.revision;
    tx.execute("INSERT INTO onboarding_receipts(owner,submission_id,request_hash,revision,memory_ids_json) VALUES(?1,?2,?3,?4,?5)",
        params![owner, input.submission_id, hash, revision, serde_json::to_string(&ids)?])?;
    Ok(true)
}
