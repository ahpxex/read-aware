//! Host-owned export task. Only an opaque ID and progress cross IPC; the
//! plaintext snapshot stays native between capture and encrypted publication.
use super::backup_tasks::{cancelled, missing, BackupTasks, Phase, PreparedBackup};
use super::{backup_archive, backup_snapshot, backup_staging::BackupStaging, DataDir, Db};
use crate::error::CommandError;
use crate::save_targets::{self, Delivery, SaveIo, SaveTarget, SaveTargets};
use age::secrecy::SecretString;
use std::path::Path;
use tauri::Manager;
use tauri_plugin_dialog::FilePath;

#[derive(Clone, serde::Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportProgress {
    Preparing,
    Database {
        remaining_pages: i32,
        total_pages: i32,
    },
    Files {
        copied_bytes: u64,
    },
    VerifyingPrograms,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReceipt {
    task_id: String,
    format: u32,
}

fn missing_sources(
    conn: &rusqlite::Connection,
    data_dir: &Path,
) -> Result<Vec<String>, CommandError> {
    let mut statement = conn.prepare("SELECT key,storage_uri FROM blob_objects WHERE deleted_at IS NULL ORDER BY key LIMIT 100001")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    let mut missing = Vec::new();
    for (index, row) in rows.enumerate() {
        if index >= 100_000 {
            return Err(CommandError::new(
                "backup/incomplete",
                "Backup blob catalog exceeds its bound",
            ));
        }
        let (key, uri) = row?;
        let expected = format!("blobs/{}", super::blob_file_name(&key));
        if let Some(uri) = uri {
            if uri != expected {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Invalid registered blob location",
                ));
            }
        } else {
            missing.push(key);
            continue;
        }
        match std::fs::symlink_metadata(data_dir.join(expected)) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Registered blob is not a regular file",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing.push(key),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(missing)
}
/// Source preparation may download these through the current sync scope before
/// the final write fence. Capture independently rechecks the complete catalog.
#[tauri::command]
pub async fn backup_export_sources(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    super::blocking("backup_export_sources", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        missing_sources(&conn, &app.state::<DataDir>().0)
    })
    .await
}

#[tauri::command]
pub async fn backup_export_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    progress: tauri::ipc::Channel<ExportProgress>,
) -> Result<CaptureReceipt, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    // Reserve before blocking work starts. The host retries cancellation on
    // progress/receipt if its first IPC arrived before this command was polled.
    let lease = tasks.begin(window.label(), &task_id)?;
    super::blocking("backup_export_capture", move || {
        let bundled = crate::plugins::backup_programs(&app)?;
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let snapshot = backup_snapshot::capture(
            &mut conn,
            &app.state::<DataDir>().0,
            &app.state::<BackupStaging>(),
            &bundled,
            |update| {
                lease.check()?;
                let update = match update {
                    backup_snapshot::CaptureProgress::Preparing => ExportProgress::Preparing,
                    backup_snapshot::CaptureProgress::Database {
                        remaining_pages,
                        total_pages,
                    } => ExportProgress::Database {
                        remaining_pages,
                        total_pages,
                    },
                    backup_snapshot::CaptureProgress::Files { copied_bytes } => {
                        ExportProgress::Files { copied_bytes }
                    }
                    backup_snapshot::CaptureProgress::VerifyingPrograms => {
                        ExportProgress::VerifyingPrograms
                    }
                };
                progress.send(update).map_err(|_| cancelled())
            },
        )?;
        drop(conn);
        lease.publish(snapshot)?;
        Ok(CaptureReceipt {
            task_id,
            format: backup_snapshot::FORMAT,
        })
    })
    .await
}

/// The archive's destination comes only from the save dialog the host opened
/// for this task: the webview never names a path. The grant is bound to the
/// window and task rather than a clock, because source preparation and capture
/// of a large library can take arbitrarily long; write and cancel consume it.
#[tauri::command]
pub async fn backup_export_choose_destination(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
) -> Result<Option<String>, CommandError> {
    uuid::Uuid::parse_str(&task_id)
        .map_err(|_| CommandError::new("backup/invalid-archive", "Invalid backup task ID"))?;
    let filter = Some(("AGE".to_owned(), "age".to_owned()));
    let picked = save_targets::choose(&app, "readaware-backup.age".to_owned(), filter).await?;
    let Some(target) = picked else {
        return Ok(None);
    };
    // For display only; no command accepts it back as a destination. On iOS
    // the real choice happens later in the export picker; show the filename.
    let location = match &target {
        SaveTarget::Picked(path) => path.to_string(),
        SaveTarget::Export { filename } => filename.clone(),
    };
    app.state::<SaveTargets>()
        .bind_session(window.label(), &task_id, target)?;
    Ok(Some(location))
}

fn write(
    tasks: &BackupTasks,
    targets: &SaveTargets,
    owner: &str,
    id: &str,
    password: SecretString,
    io: &impl SaveIo,
    data_dir: &Path,
) -> Result<bool, CommandError> {
    // Any write attempt spends the task's destination grant.
    let target = targets.redeem_session(owner, id);
    let (lease, prepared) = tasks.take(owner, id, Phase::Export)?;
    let PreparedBackup::Export(snapshot) = prepared else {
        return Err(missing());
    };
    let result = (|| {
        lease.check()?;
        let target = target?;
        if let SaveTarget::Picked(FilePath::Path(destination)) = &target {
            if !destination.is_absolute() {
                return Err(CommandError::new(
                    "backup/invalid-archive",
                    "Backup destination must be absolute",
                ));
            }
            let parent = destination.parent().ok_or_else(missing)?.canonicalize()?;
            if parent.starts_with(data_dir.canonicalize()?) {
                return Err(CommandError::new(
                    "backup/invalid-archive",
                    "Backup destination overlaps managed application data",
                ));
            }
        }
        io.publish(
            target,
            Box::new(|out| {
                backup_archive::encrypt_archive(&snapshot, password, out, || lease.check())
            }),
        )
    })();
    drop(snapshot); // Retain admission until private files are actually released.
    drop(lease);
    match result {
        Err(error) => Err(error),
        Ok(Delivery::Done) => Ok(true),
        // iOS only: present the export picker after the lease and snapshot are
        // gone. `false` = the user cancelled at the picker.
        Ok(Delivery::Export(staged)) => staged.present(io),
    }
}
#[tauri::command]
pub async fn backup_export_write(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    password: String,
) -> Result<bool, CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    let password = SecretString::from(password);
    super::blocking("backup_export_write", move || {
        write(
            &tasks,
            &app.state::<SaveTargets>(),
            &owner,
            &task_id,
            password,
            &app,
            &app.state::<DataDir>().0,
        )
    })
    .await
}
#[tauri::command]
pub async fn backup_export_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
) -> Result<(), CommandError> {
    let tasks = app.state::<BackupTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_export_cancel", move || {
        app.state::<SaveTargets>()
            .release_session(&owner, &task_id)?;
        tasks.cancel(&owner, Some(&task_id))
    })
    .await
}

#[cfg(test)]
#[path = "backup_export_tests.rs"]
mod tests;
