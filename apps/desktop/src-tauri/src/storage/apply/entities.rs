use crate::error::CommandError;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;
use std::collections::BTreeSet;

fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, CommandError> {
    p.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("memory/invalid-input", format!("Invalid entity {key}")))
}

fn root(tx: &Transaction<'_>, id: &str) -> Result<String, CommandError> {
    Ok(tx
        .query_row(
            "SELECT keep_id FROM entity_redirects WHERE merged_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_else(|| id.to_owned()))
}

pub(super) fn resolve(
    tx: &Transaction<'_>,
    p: &Value,
    at: &str,
    event_id: &str,
) -> Result<bool, CommandError> {
    let id = text(p, "entityId")?;
    let kind = text(p, "kind")?;
    let name = text(p, "canonicalName")?;
    let mut aliases = BTreeSet::from([name.to_owned()]);
    if let Some(value) = p.get("aliases") {
        let values = value.as_array().ok_or_else(|| {
            CommandError::new("memory/invalid-input", "Entity aliases must be an array")
        })?;
        for value in values {
            let alias = value
                .as_str()
                .filter(|alias| !alias.trim().is_empty())
                .ok_or_else(|| CommandError::new("memory/invalid-input", "Invalid entity alias"))?;
            aliases.insert(alias.to_owned());
        }
    }
    tx.execute("INSERT INTO entities (id,kind,canonical_name,created_at,updated_at,updated_event_id)
        VALUES (?1,?2,?3,?4,?4,?5) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,
        canonical_name=excluded.canonical_name,updated_at=excluded.updated_at,updated_event_id=excluded.updated_event_id",
        params![id, kind, name, at, event_id])?;
    for alias in aliases {
        tx.execute(
            "INSERT OR IGNORE INTO entity_aliases (entity_id,alias,created_at) VALUES (?1,?2,?3)",
            params![id, alias, at],
        )?;
    }
    Ok(true)
}

pub(super) fn merge(
    tx: &Transaction<'_>,
    p: &Value,
    at: &str,
    event_id: &str,
) -> Result<bool, CommandError> {
    let keep = root(tx, text(p, "keepId")?)?;
    let merged = root(tx, text(p, "mergedId")?)?;
    if keep == merged {
        return Ok(false);
    }
    // Redirect equivalence classes, not just the spelling used in this event.
    // Definitions stay with their original identity, including later resolutions.
    tx.execute(
        "UPDATE entity_redirects SET keep_id=?1,updated_at=?2,updated_event_id=?3 WHERE keep_id=?4",
        params![keep, at, event_id, merged],
    )?;
    tx.execute("INSERT INTO entity_redirects (merged_id,keep_id,updated_at,updated_event_id) VALUES (?1,?2,?3,?4)",
        params![merged, keep, at, event_id])?;
    Ok(true)
}
