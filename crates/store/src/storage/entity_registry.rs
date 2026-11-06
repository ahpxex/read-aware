//! Shared identity membership and projection-derived revision for registry decisions.
use super::events;
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "entity_registry_tests.rs"]
mod tests;

pub(super) const MEMBERSHIP: &str = "WITH known(id) AS (
    SELECT id FROM entities UNION SELECT merged_id FROM entity_redirects UNION SELECT keep_id FROM entity_redirects
), membership(id,root_id) AS (
    SELECT k.id,COALESCE(r.keep_id,k.id) FROM known k LEFT JOIN entity_redirects r ON r.merged_id=k.id
), roots(id) AS (SELECT DISTINCT root_id FROM membership)";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntityDefinition {
    pub kind: String,
    pub canonical_name: String,
}

pub(super) fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.encode_utf16().count() <= max
}

pub(super) fn require_fresh(conn: &Connection) -> Result<(), CommandError> {
    if events::projections_stale_conn(conn)? {
        return Err(CommandError::new(
            "memory/conflict",
            "Entity projection is awaiting replay",
        ));
    }
    Ok(())
}

pub(super) fn valid_revision(value: &str) -> bool {
    value.strip_prefix("entities1:").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

pub(super) fn revision(conn: &Connection) -> Result<String, CommandError> {
    let mut hash = Sha256::new();
    for (table, query) in [
        ("entities", "SELECT json_array(id,kind,canonical_name,updated_event_id) FROM entities ORDER BY id"),
        ("aliases", "SELECT json_array(entity_id,alias) FROM entity_aliases ORDER BY entity_id,alias"),
        ("redirects", "SELECT json_array(merged_id,keep_id,updated_event_id) FROM entity_redirects ORDER BY merged_id"),
    ] {
        hash.update([0]);
        hash.update(table.as_bytes());
        let mut stmt = conn.prepare(query)?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let value: String = row.get(0)?;
            hash.update([1]);
            hash.update((value.len() as u64).to_be_bytes());
            hash.update(value.as_bytes());
        }
    }
    Ok(format!("entities1:{:x}", hash.finalize()))
}

pub(super) fn root(conn: &Connection, id: &str) -> Result<Option<String>, CommandError> {
    Ok(conn
        .query_row(
            &format!("{MEMBERSHIP} SELECT root_id FROM membership WHERE id=?1"),
            [id],
            |row| row.get(0),
        )
        .optional()?)
}

pub(super) fn definition(
    conn: &Connection,
    id: &str,
) -> Result<Option<EntityDefinition>, CommandError> {
    Ok(conn
        .query_row(
            "SELECT kind,canonical_name FROM entities WHERE id=?1",
            [id],
            |row| {
                Ok(EntityDefinition {
                    kind: row.get(0)?,
                    canonical_name: row.get(1)?,
                })
            },
        )
        .optional()?)
}
