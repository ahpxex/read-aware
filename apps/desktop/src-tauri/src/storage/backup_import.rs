//! Host-owned authenticated preparation, review, and one-shot restore execution.
//! The host supplies confirmed selections and staged program results, and owns
//! producer quiescence around the final native transaction.
use super::{
    backup_archive,
    backup_staging::BackupStaging,
    backup_tasks::{cancelled, missing, BackupTasks, Lease, Phase, PreparedBackup},
    DataDir, Db,
};
use crate::error::CommandError;
use age::secrecy::SecretString;
use std::{
    collections::BTreeMap,
    fs::File,
    path::Path,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportProgress {
    Decrypting,
    CheckingSource,
    ComparingEvents,
    ComparingRows,
    ComparingFiles,
    PreparingReview,
    Restoring,
}

/// Count-only host report. No source paths, event payloads, row keys, plugin
/// documents, credentials or private snapshot handles are serialized.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReceipt {
    task_id: String,
    format: u32,
    schema_version: i64,
    tables: BTreeMap<String, u64>,
    events: u64,
    blobs: u64,
    credentials: u64,
    plugin_programs: u64,
}
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonCounts {
    source_only: u64,
    target_only: u64,
    same: u64,
    different: u64,
    unavailable: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    source_rows: u64,
    target_rows: u64,
    comparisons: Option<ComparisonCounts>,
    generated_only: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanReceipt {
    task_id: String,
    new_events: u64,
    existing_events: u64,
    conflicting_events: u64,
    tables: BTreeMap<String, TableSummary>,
    files: ComparisonCounts,
    plugin_programs: usize,
}
struct Reporter<F> {
    send: F,
    phase: Option<ImportProgress>,
    last: Instant,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReceipt {
    task_id: String,
    format: u32,
    #[serde(flatten)]
    restored: backup_archive::RestoreReceipt,
}
fn execute_plan(
    tasks: &BackupTasks,
    owner: &str,
    task_id: String,
    conn: &mut rusqlite::Connection,
    data_dir: &Path,
    request: backup_archive::RestoreRequest,
    send: impl FnMut(ImportProgress) -> Result<(), CommandError>,
) -> Result<ImportReceipt, CommandError> {
    let (lease, prepared) = tasks.take(owner, &task_id, Phase::Plan)?;
    let PreparedBackup::Plan(plan) = prepared else {
        return Err(missing());
    };
    let mut progress = Reporter::new(send);
    let restored = plan.restore(conn, data_dir, request, || {
        progress.update(&lease, ImportProgress::Restoring)
    })?;
    Ok(ImportReceipt {
        task_id,
        format: 2,
        restored,
    })
}

#[tauri::command]
pub async fn backup_import_apply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    request: backup_archive::RestoreRequest,
    progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<ImportReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_apply", move || {
        // A full restore replaces rows, blob files, plugins and the secret
        // key; no other process may hold the library open meanwhile.
        app.state::<super::StoreLock>().with_exclusive(|| {
            let db = app.state::<Db>();
            let mut conn = db.0.lock()?;
            let data_dir = app.state::<DataDir>();
            execute_plan(
                &tasks,
                &owner,
                task_id,
                &mut conn,
                &data_dir.0,
                request,
                |phase| progress.send(phase).map_err(|_| cancelled()),
            )
        })
    })
    .await
}
#[tauri::command]
pub async fn backup_import_stage_program(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    request: backup_archive::ProgramStageRequest,
) -> Result<backup_archive::ProgramStageReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_stage_program", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let data_dir = app.state::<DataDir>();
        let tx = conn.transaction()?;
        tasks.with_plan(&owner, &task_id, |plan, lease| {
            plan.stage_program(&tx, &data_dir.0, request, || lease.check())
        })
    })
    .await
}
#[tauri::command]
pub async fn backup_import_stage_storage(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    token: String,
    query: backup_archive::ProgramStageQuery,
) -> Result<serde_json::Value, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_stage_storage", move || {
        tasks.with_plan(&owner, &task_id, |plan, lease| {
            plan.stage_storage(&token, query, || lease.check())
        })
    })
    .await
}
impl<F: FnMut(ImportProgress) -> Result<(), CommandError>> Reporter<F> {
    fn new(send: F) -> Self {
        Self {
            send,
            phase: None,
            last: Instant::now(),
        }
    }
    fn update(&mut self, lease: &Lease, phase: ImportProgress) -> Result<(), CommandError> {
        lease.check()?;
        if self.phase != Some(phase) || self.last.elapsed() >= Duration::from_millis(150) {
            (self.send)(phase)?;
            self.phase = Some(phase);
            self.last = Instant::now();
        }
        Ok(())
    }
}
fn open_source(
    lease: Lease,
    task_id: String,
    source: &Path,
    password: SecretString,
    staging: &BackupStaging,
    send: impl FnMut(ImportProgress) -> Result<(), CommandError>,
) -> Result<SourceReceipt, CommandError> {
    let mut progress = Reporter::new(send);
    progress.update(&lease, ImportProgress::Decrypting)?;
    if !source.is_absolute() || !std::fs::metadata(source)?.is_file() {
        return Err(CommandError::new(
            "backup/invalid-archive",
            "Backup source must be an absolute regular file",
        ));
    }
    let archive = backup_archive::read_archive(File::open(source)?, password, staging, || {
        progress.update(&lease, ImportProgress::Decrypting)
    })?;
    progress.update(&lease, ImportProgress::CheckingSource)?;
    let source = backup_archive::preflight(archive, lease.cancellation())?;
    let report = &source.report;
    let receipt = SourceReceipt {
        task_id,
        format: source.archive().manifest.format,
        schema_version: source.archive().manifest.schema_version,
        tables: report.tables.clone(),
        events: report.events,
        blobs: report.blobs,
        credentials: report.credentials,
        plugin_programs: report.plugin_programs,
    };
    lease.publish(PreparedBackup::Source(Box::new(source)))?;
    Ok(receipt)
}
fn summarize(
    task_id: String,
    plan: &backup_archive::FilePlan,
    lease: &Lease,
) -> Result<PlanReceipt, CommandError> {
    let rows = plan.rows();
    let events = &rows.events().report;
    let tables = rows
        .tables
        .iter()
        .map(|(name, table)| {
            (
                name.clone(),
                TableSummary {
                    source_rows: table.source_rows,
                    target_rows: table.target_rows,
                    comparisons: table.comparisons.as_ref().map(|counts| ComparisonCounts {
                        source_only: counts.source_only,
                        target_only: counts.target_only,
                        same: counts.same,
                        different: counts.different,
                        unavailable: 0,
                    }),
                    generated_only: table
                        .comparisons
                        .as_ref()
                        .map_or(0, |counts| counts.generated_only),
                },
            )
        })
        .collect();
    let mut files = ComparisonCounts::default();
    let mut cursor = String::new();
    loop {
        lease.check()?;
        let page = plan.page(&cursor, 100)?;
        for file in page.entries {
            match file.kind {
                backup_archive::FileMatchKind::Same => files.same += 1,
                backup_archive::FileMatchKind::Different => files.different += 1,
                backup_archive::FileMatchKind::SourceOnly => files.source_only += 1,
                backup_archive::FileMatchKind::TargetOnly => files.target_only += 1,
                backup_archive::FileMatchKind::Unavailable => files.unavailable += 1,
            }
        }
        match page.next_after {
            Some(next) => cursor = next,
            None => break,
        }
    }
    Ok(PlanReceipt {
        task_id,
        new_events: events.new_events,
        existing_events: events.existing_events,
        conflicting_events: events.conflicting_events,
        tables,
        files,
        plugin_programs: plan.programs.len(),
    })
}
/// The live installation a plan compares against, and where it stages.
struct PlanRoots<'a> {
    data_dir: &'a Path,
    bundled: crate::plugins::BundledPrograms,
    staging: &'a BackupStaging,
}
fn build_plan(
    tasks: &BackupTasks,
    owner: &str,
    task_id: String,
    conn: &mut rusqlite::Connection,
    roots: PlanRoots<'_>,
    send: impl FnMut(ImportProgress) -> Result<(), CommandError>,
) -> Result<PlanReceipt, CommandError> {
    let PlanRoots {
        data_dir,
        bundled,
        staging,
    } = roots;
    let (lease, prepared) = tasks.take(owner, &task_id, Phase::Source)?;
    let PreparedBackup::Source(source) = prepared else {
        return Err(missing());
    };
    let mut progress = Reporter::new(send);
    let events = backup_archive::plan_events(*source, conn, staging, || {
        progress.update(&lease, ImportProgress::ComparingEvents)
    })?;
    let rows = events.plan_rows(conn, || {
        progress.update(&lease, ImportProgress::ComparingRows)
    })?;
    let files = rows.plan_files(conn, data_dir, bundled, || {
        progress.update(&lease, ImportProgress::ComparingFiles)
    })?;
    {
        let target = conn.transaction()?;
        files.prepare_review(&target, data_dir, || {
            progress.update(&lease, ImportProgress::PreparingReview)
        })?;
    }
    let receipt = summarize(task_id, &files, &lease)?;
    lease.publish(PreparedBackup::Plan(Box::new(files)))?;
    Ok(receipt)
}

#[tauri::command]
pub async fn backup_import_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    source: String,
    password: String,
    progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<SourceReceipt, CommandError> {
    let password = SecretString::from(password);
    let tasks = app.state::<BackupTasks>().inner().clone();
    let lease = tasks.begin(window.label(), &task_id)?;
    super::blocking("backup_import_open", move || {
        open_source(
            lease,
            task_id,
            Path::new(&source),
            password,
            &app.state::<BackupStaging>(),
            |update| progress.send(update).map_err(|_| cancelled()),
        )
    })
    .await
}
#[tauri::command]
pub async fn backup_import_plan(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<PlanReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_plan", move || {
        let bundled = crate::plugins::backup_programs(&app)?;
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        build_plan(
            &tasks,
            &owner,
            task_id,
            &mut conn,
            PlanRoots {
                data_dir: &app.state::<DataDir>().0,
                bundled,
                staging: &app.state::<BackupStaging>(),
            },
            |update| progress.send(update).map_err(|_| cancelled()),
        )
    })
    .await
}
#[tauri::command]
pub async fn backup_import_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
) -> Result<(), CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_cancel", move || {
        tasks.cancel(&owner, Some(&task_id))
    })
    .await
}

#[tauri::command]
pub async fn backup_import_review(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    query: backup_archive::ReviewQuery,
) -> Result<backup_archive::ReviewPage, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_review", move || {
        tasks.with_plan(&owner, &task_id, |plan, lease| {
            plan.review_page(query, || lease.check())
        })
    })
    .await
}

#[cfg(test)]
#[path = "backup_import_tests.rs"]
mod tests;

#[tauri::command]
pub async fn backup_import_choose_rows(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    request: backup_archive::RowChoiceRequest,
) -> Result<backup_archive::RowChoiceReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_choose_rows", move || {
        tasks.with_plan(&owner, &task_id, |plan, lease| {
            plan.choose_rows(request, || lease.check())
        })
    })
    .await
}

#[tauri::command]
pub async fn backup_import_check_rows(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    expected_revision: String,
) -> Result<backup_archive::RowStructureReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_import_check_rows", move || {
        tasks.with_plan(&owner, &task_id, |plan, lease| {
            plan.check_rows(expected_revision, || lease.check())
        })
    })
    .await
}
