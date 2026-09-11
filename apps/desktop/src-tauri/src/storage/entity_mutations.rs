use super::{entity_registry as registry, events, local_event_guard, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{params, Connection, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityMutationReceipt {
    pub entity_id: String,
    pub canonical_id: String,
    pub changed: bool,
    pub revision: String,
}

fn invalid() -> CommandError {
    CommandError::new(
        "memory/invalid-input",
        "Invalid conditional entity decision",
    )
}

fn text<'a>(
    fields: &'a Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<&'a str, CommandError> {
    fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| registry::valid_text(s, max))
        .ok_or_else(invalid)
}

fn resolve_changes(
    conn: &Connection,
    id: &str,
    p: &Map<String, Value>,
) -> Result<bool, CommandError> {
    let expected = registry::EntityDefinition {
        kind: text(p, "kind", 64)?.into(),
        canonical_name: text(p, "canonicalName", 512)?.into(),
    };
    let aliases = p
        .get("aliases")
        .map(|v| v.as_array().ok_or_else(invalid))
        .transpose()?;
    if aliases.is_some_and(|a| a.len() > 32) {
        return Err(invalid());
    }
    let mut names = vec![expected.canonical_name.as_str()];
    for alias in aliases.into_iter().flatten() {
        names.push(
            alias
                .as_str()
                .filter(|s| registry::valid_text(s, 512))
                .ok_or_else(invalid)?,
        );
    }
    if registry::definition(conn, id)?.as_ref() != Some(&expected) {
        return Ok(true);
    }
    for name in names {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM entity_aliases WHERE entity_id=?1 AND alias=?2)",
            params![id, name],
            |r| r.get(0),
        )?;
        if !exists {
            return Ok(true);
        }
    }
    Ok(false)
}

fn target(event: &EventRow) -> Result<&str, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let id = match event.event_type.as_str() {
        "entity.resolved" => {
            if p.keys().any(|key| {
                !["entityId", "kind", "canonicalName", "aliases"].contains(&key.as_str())
            }) {
                return Err(invalid());
            }
            text(p, "entityId", 256)?
        }
        "entity.merged" => {
            if p.len() != 2 {
                return Err(invalid());
            }
            text(p, "mergedId", 256)?;
            text(p, "keepId", 256)?
        }
        _ => return Err(invalid()),
    };
    if event.aggregate_type.as_deref() != Some("entity")
        || event.aggregate_id.as_deref() != Some(id)
    {
        return Err(invalid());
    }
    Ok(id)
}

pub(super) fn apply_decision(tx: &Transaction<'_>, event: &EventRow) -> Result<bool, CommandError> {
    let id = target(event)?;
    let p = event.payload.as_object().ok_or_else(invalid)?;
    local_event_guard::validate_new_event(tx, event)?;
    let changed = if event.event_type == "entity.resolved" {
        resolve_changes(tx, id, p)?
    } else {
        let missing = || {
            CommandError::new(
                "memory/not-found",
                "Merge requires two known classes with resolved keepers",
            )
        };
        let keep = registry::root(tx, id)?.ok_or_else(missing)?;
        let merged = registry::root(tx, text(p, "mergedId", 256)?)?.ok_or_else(missing)?;
        if registry::definition(tx, &keep)?.is_none()
            || registry::definition(tx, &merged)?.is_none()
        {
            return Err(missing());
        }
        keep != merged
    };
    if changed {
        let report = events::commit_events_in_transaction(tx, std::slice::from_ref(event))?;
        if report.appended != 1 || report.applied != 1 {
            return Err(CommandError::internal("Incomplete entity decision commit"));
        }
    }
    Ok(changed)
}

pub(crate) fn entity_commit_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_revision: &str,
) -> Result<EntityMutationReceipt, CommandError> {
    let id = target(event)?;
    if !registry::valid_revision(expected_revision) {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    registry::require_fresh(&tx)?;
    if registry::revision(&tx)? != expected_revision {
        return Err(CommandError::new("memory/conflict", "Entity registry changed since the decision was prepared"));
    }
    let changed = apply_decision(&tx, event)?;
    let canonical_id = registry::root(&tx, id)?
        .ok_or_else(|| CommandError::internal("Entity decision did not produce an identity"))?;
    let revision = registry::revision(&tx)?;
    tx.commit()?;
    Ok(EntityMutationReceipt {
        entity_id: id.into(),
        canonical_id,
        changed,
        revision,
    })
}

#[tauri::command]
pub async fn entity_commit(
    event: EventRow,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<EntityMutationReceipt, CommandError> {
    super::blocking("entity_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        entity_commit_inner(&mut conn, &event, &expected_revision)
    })
    .await
}
