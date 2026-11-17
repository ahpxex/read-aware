//! Authenticated files are still untrusted application data. This stage only
//! reads a private archive and returns an owned, pinned source for merge planning.
//! It neither replays away historical projection drift nor authorizes a restore.
use super::{invalid, AuthenticatedBackup};
use crate::{error::CommandError, storage};
use rusqlite::{config::DbConfig, limits::Limit, Connection, OpenFlags};
use std::{
    collections::BTreeMap,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

#[path = "backup_preflight_data.rs"]
mod data;
#[path = "backup_preflight_schema.rs"]
mod schema;

/// The archive was the first full-backup format, written at schema v41; an
/// older version number cannot belong to a genuine full backup.
const FIRST_BACKUP_SCHEMA: i64 = 41;
/// A newer build wrote this archive; this one cannot know its tables.
pub(crate) const CODE_NEWER_VERSION: &str = "backup/newer-version";

/// Only the user stops a preflight. A large archive on a slow disk takes as
/// long as it takes; a clock is not evidence that the file is damaged.
#[derive(Clone)]
struct Control {
    cancelled: Arc<AtomicBool>,
}
impl Control {
    fn check(&self) -> Result<(), CommandError> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(CommandError::new(
                storage::backup_snapshot::CODE_CANCELLED,
                "backup preflight cancelled",
            ));
        }
        Ok(())
    }
}

/// Internal facts only, never a recovery receipt or an Actor-visible data dump.
#[derive(Debug, Default)]
pub(crate) struct PreflightReport {
    pub tables: BTreeMap<String, u64>,
    pub events: u64,
    pub blobs: u64,
    pub credentials: u64,
    pub plugin_programs: u64,
}

/// Connection drops before the owned directory (also on Windows). The pinned
/// read transaction and read-only connection survive into merge planning.
#[derive(Debug)]
pub(crate) struct PreflightedBackup {
    connection: Connection,
    archive: AuthenticatedBackup,
    cancelled: Arc<AtomicBool>,
    pub report: PreflightReport,
}
impl PreflightedBackup {
    pub(crate) fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }
    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }
    pub(crate) fn archive(&self) -> &AuthenticatedBackup {
        &self.archive
    }
}

/// Bring an older archive to this build's schema on its private decrypted
/// copy, with the migrations the live store runs on upgrade. Only a database
/// just proven identical to this build's own migration output at its version
/// reaches this point, so nothing the archive supplied (a trigger, a view, a
/// function) can run. The copy stays a rollback-mode file, as `open_source`
/// requires.
fn migrate_private_copy(
    archive: &AuthenticatedBackup,
    control: &Control,
) -> Result<(), CommandError> {
    control.check()?;
    let path = archive.directory().join("database.sqlite");
    let mut conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    storage::register_sql_functions(&conn)?;
    let progress = control.clone();
    conn.progress_handler(1000, Some(move || progress.check().is_err()));
    storage::run_migrations(&mut conn)?;
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    if !mode.eq_ignore_ascii_case("delete") {
        return Err(invalid("migrated backup copy left rollback journal mode"));
    }
    Ok(())
}

fn open_source(
    archive: &AuthenticatedBackup,
    control: &Control,
) -> Result<Connection, CommandError> {
    control.check()?;
    let path = archive.directory().join("database.sqlite");
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() {
        return Err(invalid("backup database is not a regular file"));
    }
    let mut header = [0u8; 100];
    std::fs::File::open(&path)?.read_exact(&mut header)?;
    if &header[..16] != b"SQLite format 3\0" || header[18] != 1 || header[19] != 1 {
        return Err(invalid(
            "backup database must be a self-contained rollback-mode SQLite file",
        ));
    }
    // Never invoke the live-store initializer, load extensions or register app
    // functions on this connection. Configuration precedes schema evaluation.
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_VIEW, false)?;
    // Extension loading remains SQLite's disabled default; the rusqlite
    // load_extension feature is not enabled and no loader is called here.
    for (limit, value) in [
        (Limit::SQLITE_LIMIT_LENGTH, 64 * 1024 * 1024),
        (Limit::SQLITE_LIMIT_SQL_LENGTH, 256 * 1024),
        (Limit::SQLITE_LIMIT_COLUMN, 128),
        (Limit::SQLITE_LIMIT_EXPR_DEPTH, 64),
        (Limit::SQLITE_LIMIT_COMPOUND_SELECT, 16),
        (Limit::SQLITE_LIMIT_VDBE_OP, 1_000_000),
        (Limit::SQLITE_LIMIT_ATTACHED, 0),
        (Limit::SQLITE_LIMIT_WORKER_THREADS, 0),
    ] {
        conn.set_limit(limit, value);
    }
    let progress = control.clone();
    conn.progress_handler(1000, Some(move || progress.check().is_err()));
    conn.execute_batch("PRAGMA query_only=ON; PRAGMA mmap_size=0; PRAGMA cell_size_check=ON; PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY; BEGIN;")?;
    // Full integrity_check also validates index entries and declared constraints.
    // The progress hook can interrupt a large or malicious file within SQL.
    let result: String = conn.query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(invalid("backup SQLite integrity check failed"));
    }
    Ok(conn)
}

pub(crate) fn preflight(
    archive: AuthenticatedBackup,
    cancelled: Arc<AtomicBool>,
) -> Result<PreflightedBackup, CommandError> {
    let control = Control { cancelled };
    let written = archive.manifest.schema_version;
    if written > storage::SCHEMA_VERSION {
        return Err(CommandError::new(
            CODE_NEWER_VERSION,
            format!(
                "backup schema v{written} is newer than this build supports (v{})",
                storage::SCHEMA_VERSION
            ),
        ));
    }
    let result = (|| {
        if written < FIRST_BACKUP_SCHEMA {
            return Err(invalid("backup schema predates full backups"));
        }
        let mut conn = open_source(&archive, &control)?;
        if storage::schema_version(&conn)? != written {
            return Err(invalid("backup schema differs from its manifest"));
        }
        // Verify the archive exactly as it was written before touching it.
        let mut tables =
            schema::validate(&conn, written, Some(&archive.manifest.tables), &control)?;
        if written < storage::SCHEMA_VERSION {
            drop(conn);
            migrate_private_copy(&archive, &control)?;
            conn = open_source(&archive, &control)?;
            tables = schema::validate(&conn, storage::SCHEMA_VERSION, None, &control)?;
        }
        let mut report = PreflightReport {
            tables,
            ..Default::default()
        };
        data::validate(&conn, &archive, &control, &mut report)?;
        control.check()?;
        // The next operation installs its own cancellation/deadline. Do not make
        // a preview expire merely because this stage's processing timer elapsed.
        conn.progress_handler(0, None::<fn() -> bool>);
        Ok(PreflightedBackup {
            connection: conn,
            archive,
            cancelled: control.cancelled.clone(),
            report,
        })
    })();
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            control.check()?; // Preserve cancellation rather than SQLite INTERRUPT.
                              // Local filesystem/lock failures do not prove that the user's
                              // archive is invalid. Keep their existing localized fix/retry code.
            if error.code.starts_with("fs/") || error.code == "db/locked" {
                return Err(error);
            }
            Err(CommandError::context_coded(
                super::CODE_INVALID,
                "backup preflight rejected",
                error,
            ))
        }
    }
}

#[cfg(test)]
#[path = "backup_preflight_tests.rs"]
mod tests;
