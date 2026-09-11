//! Complete native read set and device-local completion state for identity synthesis.
use super::{entity_registry, memory_mutations, user_profile, Db};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "identity_consolidation_tests.rs"]
mod tests;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentitySource {
    pub memory_id: String,
    pub revision: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityEvidence {
    pub event_id: String,
    pub memory_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsolidatedProfile {
    pub version: u8,
    pub summary: String,
    pub sources: Vec<IdentitySource>,
    /// Proposed event IDs, including no-ops; the commit receipt names emitted IDs.
    pub entity_evidence: Vec<EntityEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityConsolidationSnapshot {
    pub revision: String,
    pub profile: user_profile::ProfileSnapshot,
    pub derived: Option<Value>,
    pub entities_revision: String,
    pub sources: Vec<memory_mutations::MemorySnapshot>,
    pub settled: bool,
}

pub(super) fn source_conditions(
    sources: &[memory_mutations::MemorySnapshot],
) -> Vec<IdentitySource> {
    sources
        .iter()
        .map(|source| IdentitySource {
            memory_id: source.memory.id.clone(),
            revision: source.revision.clone(),
        })
        .collect()
}

pub(super) fn read_derived(conn: &Connection) -> Result<Option<Value>, CommandError> {
    let traits: Option<String> = conn
        .query_row(
            "SELECT traits_json FROM user_profile WHERE id='local'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let traits: Value = serde_json::from_str(traits.as_deref().unwrap_or("{}"))?;
    Ok(traits.get("consolidated").cloned())
}

pub(super) fn read_snapshot(
    conn: &Connection,
) -> Result<IdentityConsolidationSnapshot, CommandError> {
    user_profile::require_initialized(conn)?;
    let profile = user_profile::read_snapshot(conn)?;
    let entities_revision = entity_registry::revision(conn)?;
    let sources = read_sources(conn)?;
    let bytes = serde_json::to_vec(&(
        &profile.revision,
        &entities_revision,
        source_conditions(&sources),
    ))?;
    let revision = format!("icg1:{:x}", Sha256::digest(bytes));
    let settled = conn
        .query_row(
            "SELECT revision FROM identity_consolidation_checkpoint WHERE id=1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|value| value == revision);
    Ok(IdentityConsolidationSnapshot {
        revision,
        profile,
        derived: read_derived(conn)?,
        entities_revision,
        sources,
        settled,
    })
}

pub(super) fn read_sources(
    conn: &Connection,
) -> Result<Vec<memory_mutations::MemorySnapshot>, CommandError> {
    let ids = conn.prepare("SELECT id FROM memories WHERE status='active' AND scope IN ('user','global') AND (evidence_count>=3 OR pinned=1) ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|id| {
            memory_mutations::read_snapshot(conn, id)?.ok_or_else(|| {
                CommandError::internal("Identity source disappeared inside its snapshot")
            })
        })
        .collect::<Result<Vec<_>, _>>()
}

pub(crate) fn identity_snapshot_inner(
    conn: &mut Connection,
) -> Result<IdentityConsolidationSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let snapshot = read_snapshot(&tx)?;
    tx.commit()?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn identity_consolidation_snapshot(
    app: tauri::AppHandle,
) -> Result<IdentityConsolidationSnapshot, CommandError> {
    super::blocking("identity_consolidation_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_snapshot_inner(&mut conn)
    })
    .await
}
