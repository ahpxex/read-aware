//! The table inventory a restore merges: every table on either side must have
//! a known restore rule (fail closed), and same-named tables the same shape.
use super::EventPlan;
use crate::error::CommandError;
use rusqlite::Connection;
use std::collections::{BTreeMap, BTreeSet};

#[path = "backup_row_policy.rs"]
mod policy;
pub(crate) use policy::RowPolicy;
#[path = "backup_file_plan.rs"]
mod files;
#[path = "backup_restore_rows.rs"]
mod restore;
#[path = "backup_row_scan.rs"]
mod scan;
#[path = "backup_sql_cancel.rs"]
mod sql_cancel;
pub(crate) use files::{FileMatchKind, FilePlan, ReviewPage, ReviewQuery};
pub(crate) use files::{RestoreReceipt, RestoreRequest};

#[derive(Debug)]
pub(crate) struct TablePlan {
    pub source_rows: u64,
    pub target_rows: u64,
}
#[derive(Debug)]
pub(crate) struct RowPlan {
    events: EventPlan,
    pub tables: BTreeMap<String, TablePlan>,
}
impl RowPlan {
    pub(crate) fn plan_files(
        self,
        target: &mut Connection,
        data_dir: &std::path::Path,
        bundled: crate::plugins::BundledPrograms,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<FilePlan, CommandError> {
        files::plan(self, target, data_dir, bundled, check)
    }
    #[cfg(test)]
    pub(crate) fn plan_fixture_files(
        self,
        target: &mut Connection,
        data_dir: &std::path::Path,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<FilePlan, CommandError> {
        self.plan_files(
            target,
            data_dir,
            crate::plugins::BundledPrograms::fixture(data_dir),
            check,
        )
    }
    pub(crate) fn events(&self) -> &EventPlan {
        &self.events
    }
}

fn inventory(conn: &Connection) -> Result<BTreeSet<String>, CommandError> {
    let mut statement = conn.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND name!='sqlite_schema' AND type IN ('table','virtual','shadow') ORDER BY name")?;
    let rows = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}
fn count(
    conn: &Connection,
    table: &str,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<u64, CommandError> {
    let mut statement = conn.prepare(&format!("SELECT 1 FROM {}", scan::quoted(table)))?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while rows.next()?.is_some() {
        check()?;
        count += 1;
    }
    Ok(count)
}
pub(super) fn plan(
    events: EventPlan,
    target: &mut Connection,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<RowPlan, CommandError> {
    let target = target.transaction()?;
    events.verify_target(&target, &mut check)?;
    let source = events.source.connection();
    let source_tables = inventory(source)?;
    let target_tables = inventory(&target)?;
    let names: BTreeSet<_> = source_tables.union(&target_tables).cloned().collect();
    // Resolve every table before creating any partial row decisions.
    for table in &names {
        policy::table(table)?;
    }
    let mut tables = BTreeMap::new();
    for name in names {
        check()?;
        let policy = policy::table(&name)?;
        let source_exists = source_tables.contains(&name);
        let target_exists = target_tables.contains(&name);
        let source_rows = if source_exists {
            count(source, &name, &mut check)?
        } else {
            0
        };
        let target_rows = if target_exists {
            count(&target, &name, &mut check)?
        } else {
            0
        };
        if policy == RowPolicy::PluginJournal && (source_rows > 0 || target_rows > 0) {
            return Err(CommandError::new(
                "plugin/recovery-required",
                "plugin update must settle before restore row planning",
            ));
        }
        if name == "blobs" && (source_rows > 0 || target_rows > 0) {
            return Err(CommandError::new(
                "backup/incomplete",
                "inline blobs must be migrated before row planning",
            ));
        }
        // Same-named tables must have the same shape after migration.
        if source_exists
            && target_exists
            && scan::columns(source, &name)? != scan::columns(&target, &name)?
        {
            return Err(CommandError::new(
                "backup/incomplete",
                "source and target row shapes differ",
            ));
        }
        tables.insert(
            name,
            TablePlan {
                source_rows,
                target_rows,
            },
        );
    }
    check()?;
    target.commit()?;
    Ok(RowPlan { events, tables })
}

#[cfg(test)]
#[path = "backup_row_plan_tests.rs"]
mod tests;

pub(crate) use files::{ProgramStageQuery, ProgramStageReceipt, ProgramStageRequest};
