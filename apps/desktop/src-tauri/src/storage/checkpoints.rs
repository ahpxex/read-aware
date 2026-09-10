//! Projection checkpoints: the replay accelerator and the bootstrap unit.
//!
//! A checkpoint is every derived table (`apply::DERIVED_TABLES`) at one point
//! of the log — an HLC frontier, plus the relay `server_seq` the log was
//! complete up to — written as a standalone SQLite file and registered as a
//! `snapshot:` blob (device-local, never auto-pushed). Two things use it:
//!
//! - **Replay.** Rebuilding the projections used to mean "wipe and apply the
//!   whole log in HLC order", O(log) per out-of-order merge. Now it means
//!   "restore the newest checkpoint older than the events being merged, then
//!   apply the tail" — O(events since the checkpoint). A merged event that
//!   sorts BEFORE a checkpoint's frontier invalidates that checkpoint (it was
//!   computed without an event it should contain); the chain of older
//!   checkpoints, and finally the empty base, keeps replay correct.
//! - **Bootstrap.** A device that has verified the passphrase can restore the
//!   account's published checkpoint instead of pulling the whole mailbox:
//!   the shelf is complete after one blob download, the tail after the
//!   frontier syncs normally, and the pre-frontier log backfills in the
//!   background (`log_complete = 0` until it does). Only a device whose log is
//!   complete may publish, and only when every local event is confirmed in
//!   the mailbox at or below the frontier — the file must equal exactly what
//!   replaying `mailbox[1..=frontier]` produces, or a bootstrapped device
//!   would double-apply (accumulating projections) or miss events.
//!
//! The file format is deliberately boring: the derived tables copied verbatim
//! (`CREATE TABLE ... AS SELECT`-shaped, no constraints), a `blob_manifest`
//! of the synced blob keys the projections reference (so a bootstrapped
//! device knows which blobs exist remotely before any bytes arrive — the same
//! contract replay's `ensure_blob_manifest` upholds), and a `checkpoint_meta`
//! key/value table. Restoring demands an exact `SCHEMA_VERSION` match; a
//! checkpoint from another build is simply not used and the log wins.
use crate::error::CommandError;
use super::*;

use rusqlite::types::Value as SqlValue;
use rusqlite::OpenFlags;
use std::path::Path;

/// The checkpoint file's own format version (independent of the schema).
pub(crate) const CHECKPOINT_FORMAT: i64 = 1;
/// Applied events past the newest checkpoint before a fresh local one is cut.
pub(crate) const CHECKPOINT_EVERY_EVENTS: i64 = 2_000;
/// Local checkpoints kept per device (newest first); older ones are pruned.
pub(crate) const CHECKPOINTS_KEPT: i64 = 3;
/// Events read per replay page — bounds memory at any log size.
pub(crate) const REPLAY_PAGE: usize = 2_000;

/// Error codes this module raises (mirrored in @read-aware/core errors.ts).
pub const CODE_SYNC_LOG_INCOMPLETE: &str = "sync/log-incomplete";
pub const CODE_SYNC_CHECKPOINT_MISMATCH: &str = "sync/checkpoint-mismatch";
pub const CODE_SYNC_CHECKPOINT_PRECONDITION: &str = "sync/checkpoint-precondition";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInfo {
    pub id: i64,
    pub blob_key: String,
    pub schema_version: i64,
    /// The log's newest stamp when the checkpoint was cut: every event at or
    /// below it is reflected in the tables.
    pub hlc: Hlc,
    /// Every mailbox event with `server_seq <= remote_seq` was in the log when
    /// the checkpoint was cut (None: the device had no relay cursor).
    pub remote_seq: Option<i64>,
    pub event_count: i64,
    pub byte_size: i64,
    /// `local` (replay accelerator), `publish` (cut to upload), `bootstrap`
    /// (restored from the relay on a new device).
    pub origin: String,
    pub published: bool,
    pub created_at: String,
}

pub(crate) type HlcKey = (i64, i64, String);

pub(crate) fn hlc_key_of(h: &Hlc) -> HlcKey {
    (h.wall_ms, h.counter, h.device_id.clone())
}

fn row_to_info(row: &rusqlite::Row) -> rusqlite::Result<CheckpointInfo> {
    Ok(CheckpointInfo {
        id: row.get("id")?,
        blob_key: row.get("blob_key")?,
        schema_version: row.get("schema_version")?,
        hlc: Hlc {
            wall_ms: row.get("hlc_wall_ms")?,
            counter: row.get("hlc_counter")?,
            device_id: row.get("hlc_device")?,
        },
        remote_seq: row.get("remote_seq")?,
        event_count: row.get("event_count")?,
        byte_size: row.get("byte_size")?,
        origin: row.get("origin")?,
        published: row.get::<_, i64>("published")? != 0,
        created_at: row.get("created_at")?,
    })
}

pub(crate) fn list_checkpoints(conn: &Connection) -> Result<Vec<CheckpointInfo>, CommandError> {
    let mut stmt = conn.prepare(
        "SELECT * FROM projection_checkpoints
         ORDER BY hlc_wall_ms DESC, hlc_counter DESC, hlc_device DESC, id DESC",
    )?;
    let rows = stmt
        .query_map([], row_to_info)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// The newest usable checkpoint: matching schema, newest frontier.
pub(crate) fn newest_checkpoint(conn: &Connection) -> Result<Option<CheckpointInfo>, CommandError> {
    conn.query_row(
        "SELECT * FROM projection_checkpoints
          WHERE schema_version = ?1
          ORDER BY hlc_wall_ms DESC, hlc_counter DESC, hlc_device DESC, id DESC
          LIMIT 1",
        params![SCHEMA_VERSION],
        row_to_info,
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

// ─── Log completeness (sync_profile.log_complete) ────────────────────────────

pub(crate) fn log_complete(conn: &Connection) -> Result<bool, CommandError> {
    conn.query_row(
        "SELECT log_complete FROM sync_profile WHERE id = 1",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(true),
        other => Err(other.into()),
    })
}

pub(crate) fn set_log_complete(conn: &Connection, complete: bool) -> Result<(), CommandError> {
    conn.execute(
        "INSERT INTO sync_profile (id, log_complete, updated_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            log_complete = excluded.log_complete,
            updated_at = excluded.updated_at",
        params![complete as i64],
    )?;
    Ok(())
}

/// The backfill's finish line lives on the profile, not on the bootstrap
/// checkpoint row: a straggler may invalidate (delete) that checkpoint while
/// the backfill it opened is still owed.
fn set_backfill_frontier(conn: &Connection, frontier_seq: Option<i64>) -> Result<(), CommandError> {
    conn.execute(
        "INSERT INTO sync_profile (id, backfill_frontier_seq, updated_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            backfill_frontier_seq = excluded.backfill_frontier_seq,
            updated_at = excluded.updated_at",
        params![frontier_seq],
    )?;
    Ok(())
}

fn backfill_frontier(conn: &Connection) -> Result<Option<i64>, CommandError> {
    conn.query_row(
        "SELECT backfill_frontier_seq FROM sync_profile WHERE id = 1",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

// ─── Invalidation ────────────────────────────────────────────────────────────

/// An event with stamp `key` entered the log. Every checkpoint whose frontier
/// is newer than that stamp claimed to contain it and did not — unless the
/// event's `server_seq` is at or below the checkpoint's `remote_seq`, which
/// proves it WAS in the log when the checkpoint was cut (the backfill behind a
/// bootstrap re-inserts exactly such events). Invalid checkpoints are deleted,
/// file and row; replay falls through to the next older one.
pub(crate) fn invalidate_checkpoints_behind(
    conn: &Connection,
    data_dir: &Path,
    key: &HlcKey,
    seq: Option<i64>,
) -> Result<usize, CommandError> {
    let stale: Vec<(i64, String, Option<i64>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, blob_key, remote_seq FROM projection_checkpoints
              WHERE (hlc_wall_ms, hlc_counter, hlc_device) > (?1, ?2, ?3)",
        )?;
        let rows = stmt
            .query_map(params![key.0, key.1, key.2], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let mut removed = 0usize;
    for (id, blob_key, remote_seq) in stale {
        if let (Some(seq), Some(covered)) = (seq, remote_seq) {
            if seq <= covered {
                continue;
            }
        }
        delete_checkpoint(conn, data_dir, id, &blob_key)?;
        removed += 1;
    }
    Ok(removed)
}

pub(crate) fn delete_checkpoint(
    conn: &Connection,
    data_dir: &Path,
    id: i64,
    blob_key: &str,
) -> Result<(), CommandError> {
    delete_blob_inner(conn, data_dir, blob_key)?;
    conn.execute("DELETE FROM projection_checkpoints WHERE id = ?1", params![id])?;
    Ok(())
}

// ─── File format ─────────────────────────────────────────────────────────────

const META_TABLE: &str = "checkpoint_meta";
const MANIFEST_TABLE: &str = "blob_manifest";

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, CommandError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(cols)
}

fn quoted(cols: &[String]) -> String {
    cols.iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

fn placeholders(n: usize) -> String {
    (1..=n).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ")
}

/// Copy every row of `main.<table>` into `out.<table>` (created here with the
/// same column names, untyped — the file is a transport, not a schema).
fn copy_table_out(
    main: &Connection,
    out: &Connection,
    table: &str,
    select_sql: &str,
) -> Result<i64, CommandError> {
    let mut select = main.prepare(select_sql)?;
    let cols: Vec<String> = select.column_names().iter().map(|c| c.to_string()).collect();
    out.execute(
        &format!("CREATE TABLE \"{table}\" ({})", quoted(&cols)),
        [],
    )?;
    let mut insert = out.prepare(&format!(
        "INSERT INTO \"{table}\" ({}) VALUES ({})",
        quoted(&cols),
        placeholders(cols.len())
    ))?;
    let mut rows = select.query([])?;
    let mut n = 0i64;
    while let Some(row) = rows.next()? {
        let values: Vec<SqlValue> = (0..cols.len())
            .map(|i| row.get_ref(i).map(|v| v.into()))
            .collect::<Result<_, _>>()?;
        insert.execute(rusqlite::params_from_iter(values.iter()))?;
        n += 1;
    }
    Ok(n)
}

/// Write the checkpoint file: derived tables, blob manifest, meta. The file
/// lands complete-or-absent (temp path + rename by the caller).
fn write_checkpoint_file(
    main: &Connection,
    path: &Path,
    meta: &[(&str, String)],
) -> Result<(), CommandError> {
    let out = Connection::open(path)?;
    // A throwaway file: durability comes from the rename, not the journal.
    out.execute_batch(
        "PRAGMA journal_mode = OFF;
         PRAGMA synchronous = OFF;",
    )?;
    out.execute_batch("BEGIN")?;
    for table in apply::DERIVED_TABLES {
        copy_table_out(main, &out, table, &format!("SELECT * FROM \"{table}\""))?;
    }
    copy_table_out(
        main,
        &out,
        MANIFEST_TABLE,
        "SELECT key, kind, mime_type, byte_size, sha256, created_at FROM blob_objects
          WHERE deleted_at IS NULL AND sync_required = 1",
    )?;
    out.execute(
        &format!("CREATE TABLE \"{META_TABLE}\" (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
        [],
    )?;
    for (key, value) in meta {
        out.execute(
            &format!("INSERT INTO \"{META_TABLE}\" (key, value) VALUES (?1, ?2)"),
            params![key, value],
        )?;
    }
    out.execute_batch("COMMIT")?;
    out.execute_batch("VACUUM")?;
    out.close().map_err(|(_, e)| CommandError::from(e))?;
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct CheckpointFileMeta {
    pub format: i64,
    pub schema_version: i64,
    pub hlc: Hlc,
    pub remote_seq: Option<i64>,
    pub event_count: i64,
    pub device_id: String,
    pub created_at: String,
}

fn open_checkpoint_file(path: &Path) -> Result<Connection, CommandError> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

pub(crate) fn read_checkpoint_meta(file: &Connection) -> Result<CheckpointFileMeta, CommandError> {
    let mut stmt = file.prepare(&format!("SELECT key, value FROM \"{META_TABLE}\""))?;
    let pairs: std::collections::BTreeMap<String, String> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let get = |k: &str| -> Result<String, CommandError> {
        pairs
            .get(k)
            .cloned()
            .ok_or_else(|| CommandError::new(CODE_SYNC_CHECKPOINT_MISMATCH, format!("checkpoint meta lacks `{k}`")))
    };
    let int = |k: &str| -> Result<i64, CommandError> {
        get(k)?
            .parse::<i64>()
            .map_err(|_| CommandError::new(CODE_SYNC_CHECKPOINT_MISMATCH, format!("checkpoint meta `{k}` is not an integer")))
    };
    let remote_seq = match pairs.get("remote_seq") {
        Some(v) if !v.is_empty() => Some(v.parse::<i64>().map_err(|_| {
            CommandError::new(CODE_SYNC_CHECKPOINT_MISMATCH, "checkpoint meta `remote_seq` is not an integer")
        })?),
        _ => None,
    };
    Ok(CheckpointFileMeta {
        format: int("format")?,
        schema_version: int("schema_version")?,
        hlc: Hlc {
            wall_ms: int("hlc_wall_ms")?,
            counter: int("hlc_counter")?,
            device_id: get("hlc_device")?,
        },
        remote_seq,
        event_count: int("event_count")?,
        device_id: get("device_id")?,
        created_at: get("created_at")?,
    })
}

/// Replace the derived tables with the file's copies and upsert its blob
/// manifest. Runs inside the caller's transaction; the file is read through
/// its own read-only connection so no ATTACH has to happen mid-transaction.
fn restore_tables_from_file(tx: &Transaction<'_>, file: &Connection) -> Result<(), CommandError> {
    for table in apply::DERIVED_TABLES {
        let live_cols = table_columns(tx, table)?;
        let file_cols = table_columns(file, table)?;
        if live_cols != file_cols {
            return Err(CommandError::new(
                CODE_SYNC_CHECKPOINT_MISMATCH,
                format!("checkpoint table `{table}` has a different shape than this build"),
            ));
        }
        tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
        let mut select = file.prepare(&format!("SELECT {} FROM \"{table}\"", quoted(&file_cols)))?;
        let mut insert = tx.prepare(&format!(
            "INSERT INTO \"{table}\" ({}) VALUES ({})",
            quoted(&live_cols),
            placeholders(live_cols.len())
        ))?;
        let mut rows = select.query([])?;
        while let Some(row) = rows.next()? {
            let values: Vec<SqlValue> = (0..live_cols.len())
                .map(|i| row.get_ref(i).map(|v| v.into()))
                .collect::<Result<_, _>>()?;
            insert.execute(rusqlite::params_from_iter(values.iter()))?;
        }
    }
    // Manifest rows: "known remotely, not fetched". INSERT OR IGNORE — a
    // device that holds the bytes keeps its real registry row.
    let mut select = file.prepare(&format!(
        "SELECT key, kind, mime_type, byte_size, sha256, created_at FROM \"{MANIFEST_TABLE}\""
    ))?;
    let mut rows = select.query([])?;
    while let Some(row) = rows.next()? {
        let key: String = row.get(0)?;
        let (kind, sync_required) = blob_kind(&key);
        tx.execute(
            "INSERT OR IGNORE INTO blob_objects
                (key, kind, mime_type, byte_size, sha256, storage_uri, sync_required, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
            params![
                key,
                kind,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<String>>(4)?,
                sync_required as i64,
                row.get::<_, String>(5)?,
            ],
        )?;
    }
    Ok(())
}

/// Restore a registered checkpoint's tables into the live projection. The
/// caller replays the tail after `info.hlc` afterwards.
pub(crate) fn restore_checkpoint(
    tx: &Transaction<'_>,
    data_dir: &Path,
    info: &CheckpointInfo,
) -> Result<(), CommandError> {
    let Some((path, _)) = get_blob_record_inner(tx, data_dir, &info.blob_key)? else {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_MISMATCH,
            format!("checkpoint blob `{}` has no local bytes", info.blob_key),
        ));
    };
    let file = open_checkpoint_file(&path)?;
    let meta = read_checkpoint_meta(&file)?;
    if meta.format != CHECKPOINT_FORMAT || meta.schema_version != SCHEMA_VERSION {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_MISMATCH,
            format!(
                "checkpoint format {}/schema {} does not match this build ({}/{})",
                meta.format, meta.schema_version, CHECKPOINT_FORMAT, SCHEMA_VERSION
            ),
        ));
    }
    restore_tables_from_file(tx, &file)
}

// ─── Creation ────────────────────────────────────────────────────────────────

fn max_log_key(conn: &Connection) -> Result<Option<(HlcKey, i64)>, CommandError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM domain_events", [], |r| r.get(0))?;
    if count == 0 {
        return Ok(None);
    }
    let key = conn.query_row(
        "SELECT hlc_wall_ms, hlc_counter, hlc_device FROM domain_events
         ORDER BY hlc_wall_ms DESC, hlc_counter DESC, hlc_device DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok(Some((key, count)))
}

fn events_cursor_seq(conn: &Connection) -> Result<Option<i64>, CommandError> {
    let cursor = sync_cursor_get_inner(conn, "events")?;
    Ok(cursor
        .and_then(|c| c.remote_cursor)
        .and_then(|s| s.parse::<i64>().ok()))
}

/// Cut a checkpoint of the live projections at the log's current frontier.
/// `remote_seq` is the caller's claim about mailbox coverage (see
/// `CheckpointInfo::remote_seq`); the file, the blob row and the registry row
/// land together or not at all.
pub(crate) fn create_checkpoint(
    conn: &mut Connection,
    data_dir: &Path,
    origin: &str,
    remote_seq: Option<i64>,
) -> Result<CheckpointInfo, CommandError> {
    let device_id = ensure_local_device(conn)?;
    let Some((frontier, event_count)) = max_log_key(conn)? else {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_PRECONDITION,
            "the log is empty; nothing to checkpoint",
        ));
    };
    let created_at = now_iso();
    let blob_key = format!(
        "snapshot:v{SCHEMA_VERSION}:{device_id}:{}-{}",
        frontier.0, frontier.1
    );
    let blobs_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir)?;
    let file_name = blob_file_name(&blob_key);
    let tmp_path = blobs_dir.join(format!("{file_name}.tmp"));
    let final_path = blobs_dir.join(&file_name);
    let _ = std::fs::remove_file(&tmp_path);
    let meta = [
        ("format", CHECKPOINT_FORMAT.to_string()),
        ("schema_version", SCHEMA_VERSION.to_string()),
        ("hlc_wall_ms", frontier.0.to_string()),
        ("hlc_counter", frontier.1.to_string()),
        ("hlc_device", frontier.2.clone()),
        ("remote_seq", remote_seq.map(|s| s.to_string()).unwrap_or_default()),
        ("event_count", event_count.to_string()),
        ("device_id", device_id.clone()),
        ("created_at", created_at.clone()),
    ];
    if let Err(e) = write_checkpoint_file(conn, &tmp_path, &meta) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }
    let data = std::fs::read(&tmp_path)?;
    let sha256 = format!("{:x}", Sha256::digest(&data));
    let byte_size = data.len() as i64;
    drop(data);
    std::fs::rename(&tmp_path, &final_path)?;

    let tx = conn.transaction()?;
    register_blob_inner(&tx, &blob_key, Some("application/vnd.sqlite3"), byte_size, sha256, file_name)?;
    tx.execute(
        "INSERT INTO projection_checkpoints
            (blob_key, schema_version, hlc_wall_ms, hlc_counter, hlc_device, remote_seq,
             event_count, byte_size, origin, published, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)
         ON CONFLICT(blob_key) DO UPDATE SET
            remote_seq = excluded.remote_seq,
            event_count = excluded.event_count,
            byte_size = excluded.byte_size,
            origin = excluded.origin,
            created_at = excluded.created_at",
        params![
            blob_key,
            SCHEMA_VERSION,
            frontier.0,
            frontier.1,
            frontier.2,
            remote_seq,
            event_count,
            byte_size,
            origin,
            created_at,
        ],
    )?;
    let info = tx.query_row(
        "SELECT * FROM projection_checkpoints WHERE blob_key = ?1",
        params![blob_key],
        row_to_info,
    )?;
    tx.commit()?;
    Ok(info)
}

/// Cut a local checkpoint when enough has happened since the last one, and
/// prune the oldest beyond `CHECKPOINTS_KEPT`. Skipped while the projections
/// are stale (a checkpoint of a half-merged state would be wrong by
/// construction). Returns the checkpoint cut, if any.
pub(crate) fn maintain_checkpoints(
    conn: &mut Connection,
    data_dir: &Path,
) -> Result<Option<CheckpointInfo>, CommandError> {
    if events::projections_stale_conn(conn)? {
        return Ok(None);
    }
    let newest = newest_checkpoint(conn)?;
    let since: i64 = match &newest {
        Some(c) => conn.query_row(
            "SELECT COUNT(*) FROM domain_events
              WHERE (hlc_wall_ms, hlc_counter, hlc_device) > (?1, ?2, ?3)",
            params![c.hlc.wall_ms, c.hlc.counter, c.hlc.device_id],
            |r| r.get(0),
        )?,
        None => conn.query_row("SELECT COUNT(*) FROM domain_events", [], |r| r.get(0))?,
    };
    if since < CHECKPOINT_EVERY_EVENTS {
        return Ok(None);
    }
    let cursor = events_cursor_seq(conn)?;
    let created = create_checkpoint(conn, data_dir, "local", cursor)?;
    prune_checkpoints(conn, data_dir)?;
    Ok(Some(created))
}

/// Keep the `CHECKPOINTS_KEPT` newest checkpoints; the bootstrap checkpoint
/// is kept as long as the log behind it is incomplete (it is the only valid
/// replay base until then).
pub(crate) fn prune_checkpoints(conn: &Connection, data_dir: &Path) -> Result<usize, CommandError> {
    let complete = log_complete(conn)?;
    let all = list_checkpoints(conn)?;
    let mut removed = 0usize;
    for (index, info) in all.iter().enumerate() {
        if (index as i64) < CHECKPOINTS_KEPT {
            continue;
        }
        if !complete && info.origin == "bootstrap" {
            continue;
        }
        delete_checkpoint(conn, data_dir, info.id, &info.blob_key)?;
        removed += 1;
    }
    Ok(removed)
}

/// Cut a checkpoint fit to publish: the log must be complete, every event
/// confirmed in the mailbox (`synced`), nothing staged, and the highest
/// confirmed seq at or below the pull cursor — then the file equals exactly
/// `replay(mailbox[1..=cursor])`, which is what a bootstrapping device will
/// assume. `frontier_seq` comes back as `remote_seq`.
pub(crate) fn create_publish_checkpoint(
    conn: &mut Connection,
    data_dir: &Path,
) -> Result<CheckpointInfo, CommandError> {
    let precondition = |ok: bool, why: &str| -> Result<(), CommandError> {
        if ok {
            Ok(())
        } else {
            Err(CommandError::new(CODE_SYNC_CHECKPOINT_PRECONDITION, why))
        }
    };
    precondition(log_complete(conn)?, "the log is still backfilling")?;
    precondition(!events::projections_stale_conn(conn)?, "projections are stale")?;
    let unconfirmed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM event_sync_state WHERE push_state != 'synced'",
        [],
        |r| r.get(0),
    )?;
    precondition(unconfirmed == 0, "some events are not confirmed in the mailbox")?;
    let Some(cursor) = events_cursor_seq(conn)? else {
        return Err(CommandError::new(CODE_SYNC_CHECKPOINT_PRECONDITION, "no pull cursor yet"));
    };
    let max_confirmed: Option<i64> = conn.query_row(
        "SELECT MAX(CAST(remote_id AS INTEGER)) FROM event_sync_state WHERE remote_id IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    precondition(
        max_confirmed.unwrap_or(0) <= cursor,
        "events were pushed after the last pull; pull again first",
    )?;
    create_checkpoint(conn, data_dir, "publish", Some(cursor))
}

pub(crate) fn mark_checkpoint_published(conn: &Connection, id: i64) -> Result<(), CommandError> {
    conn.execute(
        "UPDATE projection_checkpoints SET published = 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

// ─── Bootstrap restore ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillStatus {
    /// The bootstrap checkpoint's frontier seq — the backfill's finish line.
    pub frontier_seq: i64,
    /// Highest seq backfilled so far (0 = nothing yet).
    pub cursor: i64,
    pub complete: bool,
}

const BACKFILL_FEED: &str = "events-backfill";

/// Adopt a downloaded `snapshot:` blob as this device's projections.
///
/// Allowed only when every event in the local log is UNCONFIRMED (`pending` /
/// `failed` — never acknowledged by any mailbox): a fresh device always holds
/// a few of those by the time it connects (a preference, a first open), and
/// they are provably absent from the checkpoint, so applying them on top of
/// the restored tables (in HLC order, past the frontier) reproduces exactly
/// `f(mailbox[..=frontier] ∪ local)`. A log with confirmed or unverified rows
/// may overlap the checkpoint and would double-apply accumulating
/// projections — that device replays the mailbox instead. A local event whose
/// stamp sorts BEFORE the frontier (a lagging clock) invalidates the
/// checkpoint like any straggler; the projections then wait, stale, for the
/// backfill to complete and replay from empty.
///
/// Sets the pull cursor to the checkpoint's frontier, registers it as the
/// replay base, and opens the backfill (`log_complete = 0`).
pub(crate) fn restore_bootstrap_checkpoint(
    conn: &mut Connection,
    data_dir: &Path,
    blob_key: &str,
) -> Result<CheckpointInfo, CommandError> {
    let confirmed_or_unknown: i64 = conn.query_row(
        "SELECT COUNT(*) FROM domain_events d
           LEFT JOIN event_sync_state s ON s.event_id = d.id
          WHERE s.push_state IS NULL OR s.push_state NOT IN ('pending', 'failed')",
        [],
        |r| r.get(0),
    )?;
    if confirmed_or_unknown > 0 {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_PRECONDITION,
            "the local log holds confirmed history; bootstrap replays the mailbox instead",
        ));
    }
    let Some((path, record)) = get_blob_record_inner(conn, data_dir, blob_key)? else {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_MISMATCH,
            format!("snapshot blob `{blob_key}` has no local bytes"),
        ));
    };
    let file = open_checkpoint_file(&path)?;
    let meta = read_checkpoint_meta(&file)?;
    if meta.format != CHECKPOINT_FORMAT || meta.schema_version != SCHEMA_VERSION {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_MISMATCH,
            format!(
                "snapshot format {}/schema {} does not match this build ({}/{})",
                meta.format, meta.schema_version, CHECKPOINT_FORMAT, SCHEMA_VERSION
            ),
        ));
    }
    let Some(frontier_seq) = meta.remote_seq else {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_MISMATCH,
            "snapshot carries no mailbox frontier",
        ));
    };

    let tx = conn.transaction()?;
    restore_tables_from_file(&tx, &file)?;
    sync_cursor_set_inner(
        &tx,
        &SyncCursor {
            feed_name: "events".into(),
            remote_cursor: Some(frontier_seq.to_string()),
            hlc: Some(meta.hlc.clone()),
        },
    )?;
    sync_cursor_set_inner(
        &tx,
        &SyncCursor {
            feed_name: BACKFILL_FEED.into(),
            remote_cursor: Some("0".into()),
            hlc: None,
        },
    )?;
    tx.execute(
        "INSERT INTO projection_checkpoints
            (blob_key, schema_version, hlc_wall_ms, hlc_counter, hlc_device, remote_seq,
             event_count, byte_size, origin, published, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'bootstrap', 1, ?9)
         ON CONFLICT(blob_key) DO UPDATE SET origin = 'bootstrap', published = 1",
        params![
            blob_key,
            SCHEMA_VERSION,
            meta.hlc.wall_ms,
            meta.hlc.counter,
            meta.hlc.device_id,
            frontier_seq,
            meta.event_count,
            record.byte_size as i64,
            meta.created_at,
        ],
    )?;
    set_log_complete(&tx, false)?;
    set_backfill_frontier(&tx, Some(frontier_seq))?;
    events::set_projections_stale_conn(&tx, false)?;
    let info = tx.query_row(
        "SELECT * FROM projection_checkpoints WHERE blob_key = ?1",
        params![blob_key],
        row_to_info,
    )?;
    // The unconfirmed local events: those past the frontier apply on top in
    // HLC order; any behind it invalidates the checkpoint we just registered
    // (the tables then wait for the backfill).
    let frontier = hlc_key_of(&info.hlc);
    let local_min: Option<HlcKey> = tx
        .query_row(
            "SELECT hlc_wall_ms, hlc_counter, hlc_device FROM domain_events
             ORDER BY hlc_wall_ms, hlc_counter, hlc_device LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(CommandError::from(other)),
        })?;
    if let Some(min) = local_min {
        if min <= frontier {
            invalidate_checkpoints_behind(&tx, data_dir, &min, None)?;
            events::set_projections_stale_conn(&tx, true)?;
        } else {
            events::for_each_event_after(&tx, Some(&frontier), |ev| {
                apply::apply_event(&tx, ev)?;
                Ok(())
            })?;
        }
    }
    tx.commit()?;
    Ok(info)
}

pub(crate) fn backfill_status(conn: &Connection) -> Result<Option<BackfillStatus>, CommandError> {
    if log_complete(conn)? {
        return Ok(None);
    }
    let Some(frontier_seq) = backfill_frontier(conn)? else {
        // Incomplete without a frontier cannot happen through this module's
        // writes; report it as nothing-to-do rather than wedging the caller.
        return Ok(None);
    };
    let cursor = sync_cursor_get_inner(conn, BACKFILL_FEED)?
        .and_then(|c| c.remote_cursor)
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    Ok(Some(BackfillStatus {
        frontier_seq,
        cursor,
        complete: cursor >= frontier_seq,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillReport {
    pub appended: usize,
    pub cursor: i64,
    pub complete: bool,
    /// Projections had been left stale (a straggler arrived while the log
    /// was incomplete) and were replayed now that it is complete.
    pub replayed: bool,
}

/// Insert pre-frontier mailbox events behind a bootstrap restore. They are
/// already reflected in the projections (that is what the checkpoint IS), so
/// nothing is applied and no checkpoint is invalidated; each row is marked
/// confirmed at its seq. Reaching the frontier completes the log and settles
/// any replay a straggler had deferred.
pub(crate) fn backfill_remote_events(
    conn: &mut Connection,
    data_dir: &Path,
    events_in: &[EventRow],
    seqs: &[i64],
) -> Result<BackfillReport, CommandError> {
    if events_in.len() != seqs.len() {
        return Err(CommandError::internal("backfill: events and seqs differ in length"));
    }
    let Some(status) = backfill_status(conn)? else {
        return Err(CommandError::new(
            CODE_SYNC_CHECKPOINT_PRECONDITION,
            "no backfill is open on this device",
        ));
    };
    let tx = conn.transaction()?;
    let mut appended = 0usize;
    let mut cursor = status.cursor;
    for (ev, seq) in events_in.iter().zip(seqs) {
        if *seq > status.frontier_seq {
            return Err(CommandError::new(
                CODE_SYNC_CHECKPOINT_PRECONDITION,
                format!("backfill received seq {seq} past the frontier {}", status.frontier_seq),
            ));
        }
        if events::insert_event_row_with_seq(&tx, ev, events::EventSource::Remote, Some(*seq))? {
            appended += 1;
        }
        cursor = cursor.max(*seq);
    }
    sync_cursor_set_inner(
        &tx,
        &SyncCursor {
            feed_name: BACKFILL_FEED.into(),
            remote_cursor: Some(cursor.to_string()),
            hlc: None,
        },
    )?;
    let complete = cursor >= status.frontier_seq;
    let mut replayed = false;
    if complete {
        set_log_complete(&tx, true)?;
        set_backfill_frontier(&tx, None)?;
        if events::projections_stale_conn(&tx)? {
            if events::replay_projections(&tx, data_dir)?.is_some() {
                events::set_projections_stale_conn(&tx, false)?;
                replayed = true;
            }
        }
    }
    tx.commit()?;
    Ok(BackfillReport {
        appended,
        cursor,
        complete,
        replayed,
    })
}

/// The pull loop's shortcut for a device whose backfill finished by other
/// means (the tail pull ran past the frontier while the backfill cursor sat
/// at it): re-evaluate completeness from the cursors alone.
pub(crate) fn settle_backfill(conn: &mut Connection, data_dir: &Path) -> Result<Option<BackfillStatus>, CommandError> {
    let Some(status) = backfill_status(conn)? else {
        return Ok(None);
    };
    if !status.complete {
        return Ok(Some(status));
    }
    let tx = conn.transaction()?;
    set_log_complete(&tx, true)?;
    set_backfill_frontier(&tx, None)?;
    if events::projections_stale_conn(&tx)? && events::replay_projections(&tx, data_dir)?.is_some() {
        events::set_projections_stale_conn(&tx, false)?;
    }
    tx.commit()?;
    Ok(Some(BackfillStatus { complete: true, ..status }))
}

fn now_iso() -> String {
    // Same wire format the SQL side produces (`strftime('%Y-%m-%dT%H:%M:%fZ')`).
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    apply::iso_from_millis(now.as_millis() as i64)
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// The schema version this build cuts and accepts checkpoints under.
#[tauri::command]
pub fn checkpoint_schema_version() -> i64 {
    SCHEMA_VERSION
}

#[tauri::command]
pub async fn checkpoint_list(
    app: tauri::AppHandle,
) -> Result<Vec<CheckpointInfo>, CommandError> {
    crate::storage::blocking("checkpoint_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        list_checkpoints(&conn)
    })
    .await
}

/// Cut a local checkpoint if enough happened since the last one (see
/// `maintain_checkpoints`). Off the main thread: it copies every derived table.
#[tauri::command]
pub async fn checkpoint_maintain(app: AppHandle) -> Result<Option<CheckpointInfo>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        maintain_checkpoints(&mut conn, &data_dir.0)
    })
    .await
    .map_err(|e| format!("checkpoint_maintain task failed: {e}"))?
}

#[tauri::command]
pub async fn checkpoint_prepare_publish(app: AppHandle) -> Result<CheckpointInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        let info = create_publish_checkpoint(&mut conn, &data_dir.0)?;
        prune_checkpoints(&conn, &data_dir.0)?;
        Ok(info)
    })
    .await
    .map_err(|e| format!("checkpoint_prepare_publish task failed: {e}"))?
}

#[tauri::command]
pub async fn checkpoint_mark_published(
    id: i64,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("checkpoint_mark_published", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        mark_checkpoint_published(&conn, id)
    })
    .await
}

#[tauri::command]
pub async fn checkpoint_restore_bootstrap(blob_key: String, app: AppHandle) -> Result<CheckpointInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        restore_bootstrap_checkpoint(&mut conn, &data_dir.0, &blob_key)
    })
    .await
    .map_err(|e| format!("checkpoint_restore_bootstrap task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_backfill_status(
    app: tauri::AppHandle,
) -> Result<Option<BackfillStatus>, CommandError> {
    crate::storage::blocking("sync_backfill_status", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        backfill_status(&conn)
    })
    .await
}

#[tauri::command]
pub async fn sync_backfill_events(
    events: Vec<EventRow>,
    seqs: Vec<i64>,
    app: AppHandle,
) -> Result<BackfillReport, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        backfill_remote_events(&mut conn, &data_dir.0, &events, &seqs)
    })
    .await
    .map_err(|e| format!("sync_backfill_events task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_backfill_settle(app: AppHandle) -> Result<Option<BackfillStatus>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        settle_backfill(&mut conn, &data_dir.0)
    })
    .await
    .map_err(|e| format!("sync_backfill_settle task failed: {e}"))?
}
