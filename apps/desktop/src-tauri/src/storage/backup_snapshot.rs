//! Private, native preparation for the full-backup pipeline. This is deliberately
//! not an IPC/export API: the directory contains the credential key and must only
//! leave the host through the authenticated encrypted archive writer.
//! It preserves the actual DB (including legacy projection drift), not just replay.
use super::*;
use rusqlite::backup::{Backup, StepResult};
use std::collections::BTreeMap;
#[cfg(test)]
use tempfile::TempDir;

#[path = "backup_snapshot_files.rs"]
pub(super) mod files;
use files::FileCollector;

// v2 requires pending reading facts to be closed into identified events first.
pub(crate) const FORMAT: u32 = 2;
pub(crate) const CODE_INCOMPLETE: &str = "backup/incomplete";
pub(crate) const CODE_CHANGED: &str = "backup/changed";
pub(crate) const CODE_CANCELLED: &str = "backup/cancelled";

#[derive(Clone, Copy, Debug)]
pub(crate) enum CaptureProgress {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CapturedFile {
    pub path: String,
    pub byte_size: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupManifest {
    pub format: u32,
    pub schema_version: i64,
    /// All actual tables, including private/local state and FTS shadow tables.
    pub tables: BTreeMap<String, u64>,
    pub files: Vec<CapturedFile>,
    /// No silent inclusion of logs, temporary resource handles or old candidates.
    pub excluded: Vec<String>,
}

/// Owning this value owns the private staging lifetime. No raw path is serialized
/// over IPC and no partial preparation is published. Drop cleans failures/results.
#[derive(Debug)]
pub(crate) struct BackupSnapshot {
    directory: super::backup_staging::BackupDirectory,
    pub manifest: BackupManifest,
}
impl BackupSnapshot {
    pub fn directory(&self) -> &Path {
        self.directory.path()
    }
}

fn table_counts(conn: &Connection) -> Result<BTreeMap<String, u64>, CommandError> {
    let names = {
        let mut statement = conn.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    names
        .into_iter()
        .map(|name| {
            let quoted = name.replace('"', "\"\"");
            let count =
                conn.query_row(&format!("SELECT count(*) FROM \"{quoted}\""), [], |row| {
                    row.get::<_, i64>(0)
                })?;
            Ok((name, count as u64))
        })
        .collect()
}

fn program_inventory(
    data_dir: &Path,
    bundled: &crate::plugins::BundledPrograms,
    progress: &mut impl FnMut(CaptureProgress) -> Result<(), CommandError>,
) -> Result<Vec<CapturedFile>, CommandError> {
    let mut check = |_| progress(CaptureProgress::VerifyingPrograms);
    let mut collector = FileCollector::inspect(data_dir, &mut check).with_bundled(bundled);
    collector.plugins("plugins")?;
    collector.plugins("bundled-plugins")?;
    Ok(collector.finish())
}

/// Caller must hold the native Db mutex for this call, in addition to the host
/// backup admission window. A pinned SQLite read transaction fixes DB identity;
/// registered blob hashes reject filesystem drift even from another connection.
/// Ordinary KV/docs writes cannot make a multi-table mixture in this snapshot.
pub(crate) fn capture(
    conn: &mut Connection,
    data_dir: &Path,
    staging_root: &super::backup_staging::BackupStaging,
    bundled: &crate::plugins::BundledPrograms,
    mut progress: impl FnMut(CaptureProgress) -> Result<(), CommandError>,
) -> Result<BackupSnapshot, CommandError> {
    progress(CaptureProgress::Preparing)?;
    let tx = conn.transaction()?;
    super::backup_reading::require_closed(&tx)?;
    let version: i64 = tx.query_row("SELECT max(version) FROM schema_migrations", [], |row| {
        row.get(0)
    })?;
    if version != SCHEMA_VERSION {
        return Err(CommandError::new(
            CODE_INCOMPLETE,
            "unsupported source database schema",
        ));
    }
    if !list_plugin_updates(&tx)?.is_empty() {
        return Err(CommandError::new(
            "plugin/recovery-required",
            "plugin update must finish before full backup",
        ));
    }
    let directory = super::backup_staging::BackupDirectory::new(staging_root)?;
    // tempfile directories are private on Unix; make the confidentiality
    // requirement explicit because the prepared snapshot includes secret.key.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    }
    let db_path = directory.path().join("database.sqlite");
    let mut copied = Connection::open(&db_path)?;
    {
        let backup = Backup::new(&tx, &mut copied)?;
        loop {
            let result = backup.step(256)?;
            let status = backup.progress();
            progress(CaptureProgress::Database {
                remaining_pages: status.remaining,
                total_pages: status.pagecount,
            })?;
            match result {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    return Err(CommandError::new("db/locked", "backup snapshot is locked"))
                }
                _ => {
                    return Err(CommandError::new(
                        CODE_INCOMPLETE,
                        "unexpected SQLite backup state",
                    ))
                }
            }
        }
    }
    // Materialize all pages into the one archive member, not a WAL sidecar.
    copied.query_row("PRAGMA journal_mode=DELETE", [], |row| {
        row.get::<_, String>(0)
    })?;
    let integrity: String = copied.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(CommandError::new(
            CODE_INCOMPLETE,
            "database integrity check failed",
        ));
    }
    let tables = table_counts(&copied)?;
    let programs_before = program_inventory(data_dir, bundled, &mut progress)?;
    let mut collector =
        FileCollector::new(data_dir, directory.path(), &mut progress).with_bundled(bundled);
    collector.record_created("database.sqlite")?;
    {
        let mut rows = copied.prepare("SELECT key,storage_uri,byte_size,sha256 FROM blob_objects WHERE deleted_at IS NULL ORDER BY key")?;
        let mut query = rows.query([])?;
        while let Some(row) = query.next()? {
            let key: String = row.get(0)?;
            let uri: Option<String> = row.get(1)?;
            let size: Option<i64> = row.get(2)?;
            let hash: Option<String> = row.get(3)?;
            let expected = format!("blobs/{}", blob_file_name(&key));
            if uri.as_deref() != Some(&expected) || size.is_some_and(|value| value < 0) {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "registered blob is unavailable or has an invalid path/size",
                ));
            }
            collector.copy(&expected, size.map(|value| value as u64), hash.as_deref())?;
        }
    }
    // Map the actual runtime bundled trees into portable paths. Staging, rollback, logs
    // and application-reconstructible caches never enter the portable image.
    collector.plugins("plugins")?;
    collector.plugins("bundled-plugins")?;
    let secret_count: i64 = copied.query_row("SELECT count(*) FROM app_kv WHERE substr(key,1,length('read-aware-secret:'))='read-aware-secret:'", [], |row| row.get(0))?;
    if data_dir.join("secret.key").try_exists()? {
        collector.copy("secret.key", Some(32), None)?;
        // Detect an already-invalid source credential store, without generating
        // a replacement key or persisting anything in the live database.
        let mut statement = copied.prepare("SELECT value_json FROM app_kv WHERE substr(key,1,length('read-aware-secret:'))='read-aware-secret:'")?;
        for row in statement.query_map([], |row| row.get::<_, String>(0))? {
            crate::secrets::decrypt_existing(directory.path(), &row?)?;
        }
    } else if secret_count != 0 {
        return Err(CommandError::new(
            "secrets/unavailable",
            "backup cannot preserve credentials without their existing key",
        ));
    }
    let files = collector.finish();
    let copied_programs: Vec<_> = files
        .iter()
        .filter(|file| {
            file.path.starts_with("plugins/") || file.path.starts_with("bundled-plugins/")
        })
        .cloned()
        .collect();
    if copied_programs != programs_before
        || program_inventory(data_dir, bundled, &mut progress)? != programs_before
    {
        return Err(CommandError::new(
            CODE_CHANGED,
            "runtime programs changed during backup capture",
        ));
    }
    let manifest = BackupManifest {
        format: FORMAT,
        schema_version: version,
        tables,
        files,
        excluded: [
            "logs",
            "caches",
            "temporary-resources",
            "private-backup-staging",
            "staged-plugin-candidates",
            "plugin-update-backups",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
    };
    drop(copied);
    // End the pinned view only after every referenced file was copied/verified.
    tx.commit()?;
    let manifest_path = directory.path().join("manifest.json");
    let mut manifest_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(manifest_path)?;
    use std::io::Write;
    serde_json::to_writer(&mut manifest_file, &manifest)?;
    manifest_file.flush()?;
    manifest_file.sync_all()?;
    let snapshot = BackupSnapshot {
        directory,
        manifest,
    };
    Ok(snapshot)
}

#[cfg(test)]
#[path = "backup_snapshot_plugin_assets_tests.rs"]
mod plugin_assets_tests;
#[cfg(test)]
#[path = "backup_snapshot_reading_tests.rs"]
mod reading_tests;
#[cfg(test)]
#[path = "backup_snapshot_tests.rs"]
mod tests;

#[cfg(test)]
pub(crate) fn capture_fixture(
    conn: &mut Connection,
    data_dir: &Path,
    staging_root: &Path,
    progress: impl FnMut(CaptureProgress) -> Result<(), CommandError>,
) -> Result<BackupSnapshot, CommandError> {
    capture(
        conn,
        data_dir,
        &super::backup_staging::BackupStaging::fixture(staging_root),
        &crate::plugins::BundledPrograms::fixture(data_dir),
        progress,
    )
}
