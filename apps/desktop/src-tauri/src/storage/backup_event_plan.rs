//! Event identity planning only. No live writes, replay, conflict resolution or
//! restore approval. All other projection/private/file merge decisions follow.
use super::PreflightedBackup;
use crate::error::CommandError;
use rusqlite::{params, Connection, Transaction};

#[path = "backup_plan_events.rs"]
mod events;
#[path = "backup_plan_revision.rs"]
mod revision;
#[path = "backup_row_plan.rs"]
mod rows;
#[path = "backup_target_snapshot.rs"]
mod target_snapshot;
pub(crate) use rows::{FileMatchKind, FilePlan, ReviewPage, ReviewQuery, RowPlan};
pub(crate) use rows::{RestoreReceipt, RestoreRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EventMatchKind {
    New,
    Existing,
    IdConflict,
    ClockConflict,
    IdAndClockConflict,
}
impl EventMatchKind {
    fn code(self) -> i64 {
        match self {
            Self::New => 0,
            Self::Existing => 1,
            Self::IdConflict => 2,
            Self::ClockConflict => 3,
            Self::IdAndClockConflict => 4,
        }
    }
    fn from_code(code: i64) -> rusqlite::Result<Self> {
        match code {
            0 => Ok(Self::New),
            1 => Ok(Self::Existing),
            2 => Ok(Self::IdConflict),
            3 => Ok(Self::ClockConflict),
            4 => Ok(Self::IdAndClockConflict),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventMatch {
    pub source_id: String,
    pub kind: EventMatchKind,
    pub source_digest: String,
    pub id_target_digest: Option<String>,
    pub clock_target_id: Option<String>,
    pub clock_target_digest: Option<String>,
}
#[derive(Debug, Default)]
pub(crate) struct EventPlanReport {
    pub new_events: u64,
    pub existing_events: u64,
    /// An event may collide on both keys; this counts it only once.
    pub conflicting_events: u64,
    pub id_conflicts: u64,
    pub clock_conflicts: u64,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventMatchPage {
    pub entries: Vec<EventMatch>,
    pub next_after: Option<String>,
}

/// Connections close before their private directories are removed. No raw event
/// payload or secret value is copied into the index database, just ids and digests.
/// The separate private target snapshot preserves review values at this revision.
#[derive(Debug)]
pub(crate) struct EventPlan {
    entries: Connection,
    target_snapshot: Connection,
    source: PreflightedBackup,
    /// Owns the plan's private staging directory for the plan's lifetime.
    _directory: crate::storage::backup_staging::BackupDirectory,
    target_revision: String,
    pub report: EventPlanReport,
}
impl EventPlan {
    pub(crate) fn plan_rows(
        self,
        target: &mut Connection,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowPlan, CommandError> {
        rows::plan(self, target, check)
    }
    pub(crate) fn source(&self) -> &PreflightedBackup {
        &self.source
    }

    pub(crate) fn page(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<EventMatchPage, CommandError> {
        if !(1..=100).contains(&limit) || after.is_some_and(|value| value.len() > 4096) {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "invalid internal event plan page request",
            ));
        }
        let mut statement = self.entries.prepare("SELECT source_id,kind,source_digest,id_target_digest,clock_target_id,clock_target_digest FROM event_matches WHERE source_id>?1 ORDER BY source_id LIMIT ?2")?;
        let mut entries = statement
            .query_map(params![after.unwrap_or(""), limit as i64 + 1], |row| {
                Ok(EventMatch {
                    source_id: row.get(0)?,
                    kind: EventMatchKind::from_code(row.get(1)?)?,
                    source_digest: row.get(2)?,
                    id_target_digest: row.get(3)?,
                    clock_target_id: row.get(4)?,
                    clock_target_digest: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let next_after = if entries.len() > limit {
            entries.truncate(limit);
            entries.last().map(|entry| entry.source_id.clone())
        } else {
            None
        };
        Ok(EventMatchPage {
            entries,
            next_after,
        })
    }

    /// Check INSIDE the transaction that will own the eventual DB decision. An
    /// IMMEDIATE transaction is preferred; do not drop it between check and write.
    /// This guards database state only. Files, runtime drain and user approval
    /// need their own checks before complete restore is implemented.
    pub(crate) fn verify_target(
        &self,
        target: &Transaction<'_>,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        if revision::database(target, &mut check)? != self.target_revision {
            return Err(CommandError::new(
                "backup/changed",
                "target database changed after event merge planning",
            ));
        }
        Ok(())
    }
}

/// Caller holds the native Db mutex. A target read transaction fixes the full
/// database revision and every lookup to the same view, including concurrent WAL
/// writers. The source is already pinned by authenticated source preflight.
pub(crate) fn plan_events(
    source: PreflightedBackup,
    target: &mut Connection,
    staging_root: &crate::storage::backup_staging::BackupStaging,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<EventPlan, CommandError> {
    check()?;
    let target_tx = target.transaction()?;
    crate::storage::backup_reading::require_closed(&target_tx)?;
    let target_revision = revision::database(&target_tx, &mut check)?;
    let directory = crate::storage::backup_staging::BackupDirectory::new(staging_root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    }
    let target_snapshot = target_snapshot::capture(
        &target_tx,
        &directory.path().join("target.sqlite"),
        &mut check,
    )?;
    let mut entries = Connection::open(directory.path().join("event-plan.sqlite"))?;
    entries.execute_batch("CREATE TABLE event_matches (
        source_id TEXT PRIMARY KEY, kind INTEGER NOT NULL CHECK(kind BETWEEN 0 AND 4),
        source_digest TEXT NOT NULL, id_target_digest TEXT, clock_target_id TEXT, clock_target_digest TEXT
    );")?;
    let report = {
        let tx = entries.transaction()?;
        let report = events::compare(source.connection(), &target_tx, &tx, &mut check)?;
        check()?;
        tx.commit()?;
        report
    };
    target_tx.commit()?; // Read only: no target row or identity was changed.
    Ok(EventPlan {
        entries,
        target_snapshot,
        source,
        _directory: directory,
        target_revision,
        report,
    })
}

#[cfg(test)]
#[path = "backup_event_plan_tests.rs"]
mod tests;

pub(crate) use rows::{ProgramStageQuery, ProgramStageReceipt, ProgramStageRequest};
