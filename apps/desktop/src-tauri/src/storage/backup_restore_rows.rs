//! The database half of a full restore: a merge, the same way sync merges
//! another device's history. The archive's domain events join the local log
//! under their original identities and the projections are replayed from the
//! combined log with the shared rules (`apply.rs`). State the log does not
//! carry is merged by one rule, "keep what this device has, fill what it
//! lacks": the presentation layer on replayed rows (`DIFF_SPECS` local
//! columns and local-only rows) and local settings, virtual bindings and
//! legacy rows. Nothing is written as a restore fact of its own, so nothing
//! new enters the sync stream except the archive's genuine events. Files,
//! plugin namespaces and credential keys are installed by the enclosing
//! full-restore operation.
use super::{scan, RowPlan, RowPolicy};
use crate::{
    error::CommandError,
    storage::{self, apply::DIFF_SPECS, events},
};
use rusqlite::{params_from_iter, Connection, Transaction};

pub(crate) struct RestoreFacts {
    pub restore_id: String,
    /// Archive events added to the local log.
    pub rows: u64,
}

impl RowPlan {
    /// The caller MUST roll back its entire transaction if this returns an
    /// error. Keep the same transaction until the file journal is accepted.
    pub(crate) fn restore_rows(
        &self,
        tx: &Transaction<'_>,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RestoreFacts, CommandError> {
        let _cancel = super::sql_cancel::Guard::new(tx, self.events.source.cancellation());
        self.events.verify_target(tx, &mut check)?;
        if self.events.report.conflicting_events != 0 {
            return Err(CommandError::new(
                "backup/conflict",
                "The backup and this library hold different events under the same identity",
            ));
        }
        let source = self.events.source.connection();
        let layers = keep_local_layers(tx)?;
        let added = self.insert_new_events(tx, &mut check)?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        check()?;
        events::replay_into(tx)?;
        check()?;
        restore_local_layers(tx, source, &layers, &mut check)?;
        fill_missing_local_state(tx, source, &mut check)?;
        // Existing checkpoints describe the pre-restore projections.
        tx.execute("DELETE FROM projection_checkpoints", [])?;
        check()?;
        Ok(RestoreFacts {
            restore_id: uuid::Uuid::new_v4().to_string(),
            rows: added,
        })
    }

    /// Archive events this library lacks, under their original identities;
    /// they are queued for upload like any local event this device never sent.
    fn insert_new_events(
        &self,
        tx: &Transaction<'_>,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<u64, CommandError> {
        let mut statement = self
            .events
            .entries
            .prepare("SELECT source_id FROM event_matches WHERE kind=0 ORDER BY source_id")?;
        let mut rows = statement.query([])?;
        let mut source = self
            .events
            .source
            .connection()
            .prepare("SELECT * FROM domain_events WHERE id=?1")?;
        let mut added = 0;
        while let Some(row) = rows.next()? {
            check()?;
            let id: String = row.get(0)?;
            let event = source.query_row([id], events::row_to_event)?;
            // A source event the target already holds, or one whose stamp a
            // different target event took, both mean the library moved on.
            let inserted = match events::insert_event_row(tx, &event, events::EventSource::Local) {
                Err(error) if error.code == crate::error::CODE_EVENT_HLC_CONFLICT => false,
                result => result?,
            };
            if !inserted {
                return Err(CommandError::new(
                    "backup/changed",
                    "Source event identity changed during restore",
                ));
            }
            added += 1;
        }
        Ok(added)
    }
}

/// One table's local layer saved across the replay.
struct KeptLayer {
    /// Position in DIFF_SPECS, naming its temp tables.
    index: usize,
    table: &'static str,
    primary: Vec<String>,
    local_columns: &'static [&'static str],
    /// Domain-row filter: rows outside it are local-only (e.g. error stubs).
    domain_rows: Option<&'static str>,
}
const KEEP_COLUMNS: &str = "temp.backup_keep_columns_";
const KEEP_ROWS: &str = "temp.backup_keep_rows_";

fn keep_local_layers(tx: &Transaction<'_>) -> Result<Vec<KeptLayer>, CommandError> {
    let mut layers = Vec::new();
    for (index, spec) in DIFF_SPECS.iter().enumerate() {
        if spec.local_columns.is_empty() && spec.domain_rows.is_none() {
            continue;
        }
        let mut primary: Vec<_> = scan::columns(tx, spec.table)?
            .into_iter()
            .filter(|c| c.primary > 0)
            .collect();
        primary.sort_by_key(|c| c.primary);
        let primary: Vec<String> = primary.into_iter().map(|c| scan::quoted(&c.name)).collect();
        let filter = spec.domain_rows.unwrap_or("1");
        if !spec.local_columns.is_empty() {
            let kept = primary
                .iter()
                .cloned()
                .chain(spec.local_columns.iter().map(|c| scan::quoted(c)))
                .collect::<Vec<_>>()
                .join(",");
            tx.execute_batch(&format!(
                "DROP TABLE IF EXISTS {KEEP_COLUMNS}{index};
                 CREATE TEMP TABLE backup_keep_columns_{index} AS SELECT {kept} FROM {} WHERE {filter};",
                scan::quoted(spec.table)
            ))?;
        }
        if let Some(filter) = spec.domain_rows {
            tx.execute_batch(&format!(
                "DROP TABLE IF EXISTS {KEEP_ROWS}{index};
                 CREATE TEMP TABLE backup_keep_rows_{index} AS SELECT * FROM {} WHERE NOT ({filter});",
                scan::quoted(spec.table)
            ))?;
        }
        layers.push(KeptLayer {
            index,
            table: spec.table,
            primary,
            local_columns: spec.local_columns,
            domain_rows: spec.domain_rows,
        });
    }
    Ok(layers)
}

fn restore_local_layers(
    tx: &Transaction<'_>,
    source: &Connection,
    layers: &[KeptLayer],
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    for layer in layers {
        let index = layer.index;
        let table = scan::quoted(layer.table);
        let key_match = |alias: &str| {
            layer
                .primary
                .iter()
                .map(|key| format!("{alias}.{key} IS {table}.{key}"))
                .collect::<Vec<_>>()
                .join(" AND ")
        };
        if !layer.local_columns.is_empty() {
            // This device's own presentation wins where it has a row.
            let keep = format!("{KEEP_COLUMNS}{index}");
            let assignments = layer
                .local_columns
                .iter()
                .map(|column| {
                    let column = scan::quoted(column);
                    format!(
                        "{column}=(SELECT k.{column} FROM {keep} k WHERE {})",
                        key_match("k")
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            tx.execute(
                &format!(
                    "UPDATE {table} SET {assignments} WHERE EXISTS (SELECT 1 FROM {keep} k WHERE {})",
                    key_match("k")
                ),
                [],
            )?;
            // The archive fills it in for rows only the archive knew.
            let selected = layer
                .primary
                .iter()
                .cloned()
                .chain(layer.local_columns.iter().map(|c| scan::quoted(c)))
                .collect::<Vec<_>>()
                .join(",");
            let mut rows = source.prepare(&format!(
                "SELECT {selected} FROM {table} WHERE {}",
                layer.domain_rows.unwrap_or("1")
            ))?;
            let keys = layer.primary.len();
            let assignments = layer
                .local_columns
                .iter()
                .enumerate()
                .map(|(i, column)| format!("{}=?{}", scan::quoted(column), keys + i + 1))
                .collect::<Vec<_>>()
                .join(",");
            let predicate = layer
                .primary
                .iter()
                .enumerate()
                .map(|(i, key)| format!("{key} IS ?{}", i + 1))
                .collect::<Vec<_>>()
                .join(" AND ");
            let kept = layer
                .primary
                .iter()
                .enumerate()
                .map(|(i, key)| format!("k.{key} IS ?{}", i + 1))
                .collect::<Vec<_>>()
                .join(" AND ");
            let mut update = tx.prepare(&format!(
                "UPDATE {table} SET {assignments} WHERE {predicate} AND NOT EXISTS (SELECT 1 FROM {keep} k WHERE {kept})"
            ))?;
            let mut source_rows = rows.query([])?;
            while let Some(row) = source_rows.next()? {
                check()?;
                let values = (0..keys + layer.local_columns.len())
                    .map(|i| row.get_ref(i).map(scan::BoundCell))
                    .collect::<Result<Vec<_>, _>>()?;
                update.execute(params_from_iter(values))?;
            }
        }
        if layer.domain_rows.is_some() {
            // Local-only rows (failed-turn stubs) are this device's transient
            // UI; the archive's are not carried over.
            tx.execute(
                &format!("INSERT OR IGNORE INTO {table} SELECT * FROM {KEEP_ROWS}{index}"),
                [],
            )?;
        }
        tx.execute_batch(&format!(
            "DROP TABLE IF EXISTS {KEEP_COLUMNS}{index}; DROP TABLE IF EXISTS {KEEP_ROWS}{index};"
        ))?;
    }
    Ok(())
}

/// Local settings, virtual bindings and legacy rows the log does not carry:
/// the archive adds what this device lacks and never replaces what it has.
fn fill_missing_local_state(
    tx: &Transaction<'_>,
    source: &Connection,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let mut tables = source.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names = tables
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for name in names {
        let policy = super::policy::table(&name)?;
        let keyed = name == "app_kv";
        if !keyed && policy != RowPolicy::LegacyData {
            continue;
        }
        let columns = scan::columns(source, &name)?;
        let names = columns
            .iter()
            .map(|c| scan::quoted(&c.name))
            .collect::<Vec<_>>();
        let slots = (1..=columns.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",");
        let mut insert = tx.prepare(&format!(
            "INSERT OR IGNORE INTO {} ({}) VALUES ({slots})",
            scan::quoted(&name),
            names.join(",")
        ))?;
        let mut rows = source.prepare(&format!("SELECT * FROM {}", scan::quoted(&name)))?;
        let mut rows = rows.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            if keyed {
                let key: String = row.get("key")?;
                match super::policy::keyed(&name, &key) {
                    RowPolicy::ReviewSettings => {}
                    // A registry the app could not read would break every
                    // virtual book; such a value is not carried over.
                    RowPolicy::VirtualBindings => {
                        let raw: String = row.get("value_json")?;
                        if !storage::virtual_books::valid_registry(&raw) {
                            log::warn!("Backup restore skipped an invalid virtual book registry");
                            continue;
                        }
                    }
                    _ => continue,
                }
            }
            let values = (0..columns.len())
                .map(|i| row.get_ref(i).map(scan::BoundCell))
                .collect::<Result<Vec<_>, _>>()?;
            insert.execute(params_from_iter(values))?;
        }
    }
    Ok(())
}
