//! Durable local plugin update decisions. Acceptance and the final preference
//! events commit together; a restart never has to guess from a file's version.
use super::*;
use rusqlite::OptionalExtension;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdateJournal {
    pub update_id: String,
    pub plugin_id: String,
    pub candidate_token: Option<String>,
    pub had_previous: Option<bool>,
    pub baseline: PluginDataSnapshot,
    pub phase: String,
    pub accepted: Option<PluginDataSnapshot>,
}

pub(crate) fn read_plugin_update(
    conn: &Connection,
    update_id: &str,
) -> Result<Option<PluginUpdateJournal>, CommandError> {
    let row = conn.query_row("SELECT plugin_id,candidate_token,had_previous,baseline_json,phase,accepted_json FROM plugin_update_journal WHERE update_id=?1", [update_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<bool>>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?))
    }).optional()?;
    row.map(
        |(plugin_id, candidate_token, had_previous, baseline, phase, accepted)| {
            Ok(PluginUpdateJournal {
                update_id: update_id.into(),
                plugin_id,
                candidate_token,
                had_previous,
                baseline: serde_json::from_str(&baseline)?,
                phase,
                accepted: accepted
                    .map(|value| serde_json::from_str(&value))
                    .transpose()?,
            })
        },
    )
    .transpose()
}

pub(crate) fn list_plugin_updates(
    conn: &Connection,
) -> Result<Vec<PluginUpdateJournal>, CommandError> {
    let mut stmt =
        conn.prepare("SELECT update_id FROM plugin_update_journal ORDER BY update_id")?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|id| {
            read_plugin_update(conn, id)?
                .ok_or_else(|| CommandError::internal("plugin update disappeared"))
        })
        .collect()
}

pub(crate) fn begin_plugin_update(
    conn: &mut Connection,
    update_id: &str,
    plugin_id: &str,
    candidate_token: Option<String>,
    had_previous: Option<bool>,
) -> Result<PluginUpdateJournal, CommandError> {
    if uuid::Uuid::parse_str(update_id).is_err()
        || candidate_token
            .as_ref()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
        || candidate_token.is_some() != had_previous.is_some()
    {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "invalid plugin update identity",
        ));
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM plugin_update_journal WHERE plugin_id=?1)",
        [plugin_id],
        |row| row.get(0),
    )?;
    if exists {
        return Err(CommandError::new(
            "plugin/recovery-required",
            "plugin update already pending",
        ));
    }
    let baseline = plugin_data_snapshot_tx(&tx, plugin_id)?;
    tx.execute("INSERT INTO plugin_update_journal (update_id,plugin_id,candidate_token,had_previous,baseline_json,phase) VALUES (?1,?2,?3,?4,?5,'prepared')",
        params![update_id,plugin_id,candidate_token,had_previous,serde_json::to_string(&baseline)?])?;
    tx.commit()?;
    Ok(PluginUpdateJournal {
        update_id: update_id.into(),
        plugin_id: plugin_id.into(),
        candidate_token,
        had_previous,
        baseline,
        phase: "prepared".into(),
        accepted: None,
    })
}

/// Native recomputation prevents a caller from publishing another namespace,
/// partial candidate values, non-preference events or invented payloads.
pub(crate) fn plugin_preference_changes(
    before: &PluginDataSnapshot,
    after: &PluginDataSnapshot,
) -> BTreeMap<String, Value> {
    let keys: BTreeSet<_> = before.kv.keys().chain(after.kv.keys()).collect();
    keys.into_iter()
        .filter_map(|key| {
            if matches!(key.as_str(), "schedule-state" | "schedule-runs")
                || before.kv.get(key) == after.kv.get(key)
            {
                return None;
            }
            let value = match after.kv.get(key) {
                Some(raw) => serde_json::from_str::<Value>(raw).ok()?,
                None => Value::Null,
            };
            Some((
                format!("read-aware-plugin.{}.{key}", after.plugin_id),
                value,
            ))
        })
        .collect()
}

pub(crate) fn accept_plugin_update(
    conn: &mut Connection,
    update_id: &str,
    expected_kv: BTreeMap<String, String>,
    expected_schema: Option<String>,
    events: &[EventRow],
) -> Result<PluginUpdateJournal, CommandError> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut journal = read_plugin_update(&tx, update_id)?.ok_or_else(|| {
        CommandError::new(
            "plugin/recovery-required",
            "plugin update baseline is missing",
        )
    })?;
    if journal.phase == "accepted" {
        return Ok(journal);
    } // Lost reply: never append twice or roll back acceptance.
    let current = plugin_data_snapshot_tx(&tx, &journal.plugin_id)?;
    if current.kv != expected_kv || current.schema != expected_schema {
        return Err(CommandError::new(
            "plugin/data-busy",
            "plugin data changed before acceptance",
        ));
    }
    let mut changes = plugin_preference_changes(&journal.baseline, &current);
    if events.len() != changes.len() {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "incomplete plugin preference publication",
        ));
    }
    for event in events {
        local_event_guard::validate_new_event(&tx, event).map_err(|error| {
            CommandError::new(
                if error.code == "memory/conflict" {
                    "plugin/data-busy"
                } else {
                    "plugin/invalid-argument"
                },
                error.message,
            )
        })?;
        let key = event
            .payload
            .get("key")
            .and_then(Value::as_str)
            .unwrap_or("");
        let expected = changes.remove(key);
        if expected.is_none()
            || event.payload.get("value") != expected.as_ref()
            || uuid::Uuid::parse_str(&event.id).is_err()
            || event.event_type != "preference.changed"
            || event.aggregate_type.as_deref() != Some("preference")
            || event.aggregate_id.as_deref() != Some(key)
            || event.payload.as_object().map(|o| o.len()) != Some(2)
        {
            return Err(CommandError::new(
                "plugin/invalid-argument",
                "invalid plugin preference publication",
            ));
        }
    }
    let report = events::commit_events_in_transaction(&tx, events)?;
    if report.appended != events.len() || report.applied != events.len() {
        return Err(CommandError::new(
            "plugin/data-busy",
            "plugin preferences could not be accepted as the current values",
        ));
    }
    tx.execute(
        "UPDATE plugin_update_journal SET phase='accepted',accepted_json=?2 WHERE update_id=?1",
        params![update_id, serde_json::to_string(&current)?],
    )?;
    tx.commit()?;
    journal.phase = "accepted".into();
    journal.accepted = Some(current);
    Ok(journal)
}

/// Files have already been restored from their retained immutable copy. The
/// baseline and journal deletion are one SQLite transaction, safe to repeat.
pub(crate) fn rollback_plugin_update(
    conn: &mut Connection,
    update_id: &str,
) -> Result<(), CommandError> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let journal = read_plugin_update(&tx, update_id)?.ok_or_else(|| {
        CommandError::new(
            "plugin/recovery-required",
            "plugin update baseline is missing",
        )
    })?;
    if journal.phase != "prepared" {
        return Err(CommandError::new(
            "plugin/recovery-required",
            "accepted plugin update cannot be rolled back",
        ));
    }
    plugin_data_restore_tx(&tx, &journal.plugin_id, journal.baseline)?;
    tx.execute(
        "DELETE FROM plugin_update_journal WHERE update_id=?1",
        [update_id],
    )?;
    Ok(tx.commit()?)
}

pub(crate) fn finish_plugin_update(conn: &Connection, update_id: &str) -> Result<(), CommandError> {
    conn.execute(
        "DELETE FROM plugin_update_journal WHERE update_id=?1 AND phase='accepted'",
        [update_id],
    )?;
    Ok(())
}
