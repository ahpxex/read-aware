//! Transactional execution of the reviewed row choices. Files, plugin namespaces
//! and credential keys are installed by the enclosing full-restore operation.
use super::{
    identity::{decode_key, BoundCell},
    scan, RowPlan, RowPolicy,
};
use crate::{
    error::CommandError,
    storage::{self, events},
};
use rusqlite::{params_from_iter, Connection, Transaction};

impl RowPlan {
    /// The caller MUST roll back its entire transaction if this returns an
    /// error. Keep the same transaction until the file journal is accepted.
    pub(crate) fn restore_rows(
        &self,
        tx: &Transaction<'_>,
        expected: &str,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<storage::backup_restore_events::RestoreFacts, CommandError> {
        let _cancel = super::sql_cancel::Guard::new(tx, self.events.source.cancellation());
        self.events.verify_target(tx, &mut check)?;
        if self.events.report.conflicting_events != 0 {
            return Err(CommandError::new(
                "backup/incomplete",
                "Conflicting immutable event identities must be resolved before restore",
            ));
        }
        let evidence = self.check_rows(expected.into(), &mut check)?;
        if !evidence.constraints_passed {
            return Err(CommandError::new(
                "backup/incomplete",
                "Selected restore rows violate structural constraints",
            ));
        }
        let (candidate, _, complete) = self.candidate(&mut check, &mut |_, _| {
            Err(CommandError::new(
                "backup/changed",
                "Selected restore rows no longer form a valid candidate",
            ))
        })?;
        if !complete {
            return Err(CommandError::new(
                "backup/incomplete",
                "Incomplete restore candidate",
            ));
        }
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
        while let Some(row) = rows.next()? {
            check()?;
            let id: String = row.get(0)?;
            let event = source.query_row([id], events::row_to_event)?;
            // A source event the target already holds, or one whose stamp a
            // different target event took, both mean the source moved on.
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
        }
        drop(rows);
        drop(statement);
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        check()?;
        events::replay_into(tx)?;
        check()?;
        let receipt =
            storage::backup_restore_events::reconcile(tx, &candidate.connection, &mut check)?;
        self.restore_local_rows(tx, &candidate.connection, &mut check)?;
        restore_presentation(tx, &candidate.connection, &mut check)?;
        // Existing checkpoints describe the pre-restore projections. Keeping
        // them would permit a later accelerated rebuild to skip restore facts.
        tx.execute("DELETE FROM projection_checkpoints", [])?;
        check()?;
        Ok(receipt)
    }
    fn restore_local_rows(
        &self,
        tx: &Transaction<'_>,
        candidate: &Connection,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let mut statement = self.events.entries.prepare("SELECT table_name,row_key,policy FROM row_matches WHERE choice='source' ORDER BY entry_id")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            if !matches!(
                RowPolicy::from_name(&row.get::<_, String>(2)?)?,
                RowPolicy::LegacyData | RowPolicy::ReviewSettings | RowPolicy::VirtualBindings
            ) {
                continue;
            }
            let table: String = row.get(0)?;
            let key: Vec<u8> = row.get(1)?;
            let columns = scan::columns(candidate, &table)?;
            let mut primary: Vec<_> = columns.iter().filter(|c| c.primary > 0).collect();
            primary.sort_by_key(|c| c.primary);
            let keys = decode_key(&key, primary.len())?;
            let predicate = primary
                .iter()
                .enumerate()
                .map(|(i, c)| format!("{} IS ?{}", scan::quoted(&c.name), i + 1))
                .collect::<Vec<_>>()
                .join(" AND ");
            let mut source = candidate.prepare(&format!(
                "SELECT * FROM {} WHERE {predicate}",
                scan::quoted(&table)
            ))?;
            let mut source_rows =
                source.query(params_from_iter(keys.iter().copied().map(BoundCell)))?;
            let source_row = source_rows.next()?.ok_or_else(|| {
                CommandError::new("backup/changed", "Missing selected local restore row")
            })?;
            let values = (0..columns.len())
                .map(|i| source_row.get_ref(i).map(BoundCell))
                .collect::<Result<Vec<_>, _>>()?;
            let names = columns
                .iter()
                .map(|c| scan::quoted(&c.name))
                .collect::<Vec<_>>();
            let slots = (1..=columns.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(",");
            let conflict = primary
                .iter()
                .map(|c| scan::quoted(&c.name))
                .collect::<Vec<_>>()
                .join(",");
            let updates = names
                .iter()
                .map(|n| format!("{n}=excluded.{n}"))
                .collect::<Vec<_>>()
                .join(",");
            tx.execute(&format!("INSERT INTO {} ({}) VALUES ({slots}) ON CONFLICT ({conflict}) DO UPDATE SET {updates}",scan::quoted(&table),names.join(",")),params_from_iter(values))?;
        }
        Ok(())
    }
}
fn restore_presentation(
    tx: &Transaction<'_>,
    candidate: &Connection,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    // Presentation is local, including failed message stubs. It is deliberately
    // restored after facts, so neither parts nor errors enter the sync stream.
    let mut statement =
        candidate.prepare("SELECT id,created_at,updated_at,cleared_at FROM ai_conversations")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        tx.execute(
            "UPDATE ai_conversations SET updated_at=?2 WHERE id=?1",
            params_from_iter([BoundCell(row.get_ref(0)?), BoundCell(row.get_ref(2)?)]),
        )?;
    }
    let columns = scan::columns(candidate, "ai_messages")?;
    let names = columns
        .iter()
        .map(|c| scan::quoted(&c.name))
        .collect::<Vec<_>>();
    let slots = (1..=columns.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "INSERT INTO ai_messages ({}) VALUES ({slots})",
        names.join(",")
    );
    let mut statement = candidate.prepare("SELECT * FROM ai_messages")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        if matches!(row.get_ref("error")?, rusqlite::types::ValueRef::Null) {
            if tx.execute(
                "UPDATE ai_messages SET parts_json=?2,error=NULL,seq=?3 WHERE id=?1",
                params_from_iter([
                    BoundCell(row.get_ref("id")?),
                    BoundCell(row.get_ref("parts_json")?),
                    BoundCell(row.get_ref("seq")?),
                ]),
            )? != 1
            {
                return Err(CommandError::internal("Restored message fact is missing"));
            }
            continue;
        }
        // Failed stubs have no domain fact, so only these whole rows are local.
        let values = (0..columns.len())
            .map(|i| row.get_ref(i).map(BoundCell))
            .collect::<Result<Vec<_>, _>>()?;
        tx.execute(&sql, params_from_iter(values))?;
    }
    Ok(())
}
