//! The sync engine's local seams: outbox reads and acknowledgements, the
//! single-row `sync_profile`, and per-feed `sync_cursors`.
//!
//! The TS sync loop (apps/web/src/platform/sync/) drives everything; this
//! module only answers "what still owes the relay a push" and records what the
//! relay has confirmed. Nothing here talks to the network, and nothing here
//! writes a projection — the pull path lands through `apply_remote_events`.
use super::*;

// ── sync_profile (single row) ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProfile {
    pub sync_enabled: bool,
    pub remote_account_id: Option<String>,
    /// Name of the secret-store slot holding the E2E master key — never the
    /// key itself (docs/sqlite-schema.sql: SQLite holds no key material).
    pub encryption_key_ref: Option<String>,
    pub last_push_at: Option<String>,
    pub last_pull_at: Option<String>,
}

impl Default for SyncProfile {
    fn default() -> Self {
        SyncProfile {
            sync_enabled: false,
            remote_account_id: None,
            encryption_key_ref: None,
            last_push_at: None,
            last_pull_at: None,
        }
    }
}

pub(crate) fn sync_profile_get_inner(conn: &Connection) -> Result<SyncProfile, String> {
    conn.query_row(
        "SELECT sync_enabled, remote_account_id, encryption_key_ref, last_push_at, last_pull_at
           FROM sync_profile WHERE id = 1",
        [],
        |row| {
            Ok(SyncProfile {
                sync_enabled: row.get::<_, i64>(0)? != 0,
                remote_account_id: row.get(1)?,
                encryption_key_ref: row.get(2)?,
                last_push_at: row.get(3)?,
                last_pull_at: row.get(4)?,
            })
        },
    )
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(SyncProfile::default()),
        other => Err(other.to_string()),
    })
}

#[tauri::command]
pub fn sync_profile_get(db: State<'_, Db>) -> Result<SyncProfile, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_profile_get_inner(&conn)
}

pub(crate) fn sync_profile_set_inner(conn: &Connection, profile: &SyncProfile) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_profile
            (id, sync_enabled, remote_account_id, encryption_key_ref,
             last_push_at, last_pull_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            sync_enabled = excluded.sync_enabled,
            remote_account_id = excluded.remote_account_id,
            encryption_key_ref = excluded.encryption_key_ref,
            last_push_at = excluded.last_push_at,
            last_pull_at = excluded.last_pull_at,
            updated_at = excluded.updated_at",
        params![
            profile.sync_enabled as i64,
            profile.remote_account_id,
            profile.encryption_key_ref,
            profile.last_push_at,
            profile.last_pull_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_profile_set(profile: SyncProfile, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_profile_set_inner(&conn, &profile)
}

/// Stamp `last_push_at` / `last_pull_at` = now without racing a full
/// profile write from another part of the loop.
#[tauri::command]
pub fn sync_profile_touch(field: String, db: State<'_, Db>) -> Result<(), String> {
    let column = match field.as_str() {
        "push" => "last_push_at",
        "pull" => "last_pull_at",
        other => return Err(format!("sync_profile_touch: unknown field `{other}`")),
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        &format!(
            "UPDATE sync_profile SET {column} = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = 1"
        ),
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── sync_cursors (per feed) ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCursor {
    pub feed_name: String,
    /// The relay's opaque cursor — for the "events" feed, the last merged
    /// server_seq as a string.
    pub remote_cursor: Option<String>,
    /// Highest HLC confirmed merged, for diagnostics and recovery.
    pub hlc: Option<Hlc>,
}

pub(crate) fn sync_cursor_get_inner(
    conn: &Connection,
    feed: &str,
) -> Result<Option<SyncCursor>, String> {
    conn.query_row(
        "SELECT remote_cursor, hlc_wall_ms, hlc_counter, hlc_device
           FROM sync_cursors WHERE feed_name = ?1",
        params![feed],
        |row| {
            let wall: Option<i64> = row.get(1)?;
            Ok(SyncCursor {
                feed_name: feed.to_string(),
                remote_cursor: row.get(0)?,
                hlc: match wall {
                    Some(wall_ms) => Some(Hlc {
                        wall_ms,
                        counter: row.get(2)?,
                        device_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    }),
                    None => None,
                },
            })
        },
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

#[tauri::command]
pub fn sync_cursor_get(feed: String, db: State<'_, Db>) -> Result<Option<SyncCursor>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_cursor_get_inner(&conn, &feed)
}

pub(crate) fn sync_cursor_set_inner(conn: &Connection, cursor: &SyncCursor) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_cursors
            (feed_name, remote_cursor, hlc_wall_ms, hlc_counter, hlc_device, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(feed_name) DO UPDATE SET
            remote_cursor = excluded.remote_cursor,
            hlc_wall_ms = excluded.hlc_wall_ms,
            hlc_counter = excluded.hlc_counter,
            hlc_device = excluded.hlc_device,
            updated_at = excluded.updated_at",
        params![
            cursor.feed_name,
            cursor.remote_cursor,
            cursor.hlc.as_ref().map(|h| h.wall_ms),
            cursor.hlc.as_ref().map(|h| h.counter),
            cursor.hlc.as_ref().map(|h| h.device_id.clone()),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_cursor_set(cursor: SyncCursor, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_cursor_set_inner(&conn, &cursor)
}

// ── Event outbox ─────────────────────────────────────────────────────────────

/// Events still owing the relay a push, in HLC order. `failed` rows are
/// included — the TS loop owns retry pacing, this query just answers "what's
/// left".
pub(crate) fn sync_outbox_events_inner(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<EventRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT de.* FROM domain_events de
             JOIN event_sync_state es ON es.event_id = de.id
             WHERE es.push_state IN ('pending','failed')
             ORDER BY de.hlc_wall_ms, de.hlc_counter, de.hlc_device
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![limit], events::row_to_event)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in iter {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn sync_outbox_events(limit: i64, db: State<'_, Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_outbox_events_inner(&conn, limit)
}

/// The relay confirmed these ids (with their assigned server_seq).
pub(crate) fn sync_mark_events_pushed_inner(
    conn: &mut Connection,
    assigned: &[(String, i64)],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (event_id, seq) in assigned {
        tx.execute(
            "UPDATE event_sync_state
                SET push_state = 'synced', remote_id = ?2, last_error = NULL,
                    pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE event_id = ?1",
            params![event_id, seq.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_mark_events_pushed(
    assigned: Vec<(String, i64)>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_mark_events_pushed_inner(&mut conn, &assigned)
}

pub(crate) fn sync_mark_events_failed_inner(
    conn: &mut Connection,
    event_ids: &[String],
    error: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for event_id in event_ids {
        tx.execute(
            "UPDATE event_sync_state
                SET push_state = 'failed', last_error = ?2,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE event_id = ?1",
            params![event_id, error],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_mark_events_failed(
    event_ids: Vec<String>,
    error: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_mark_events_failed_inner(&mut conn, &event_ids, &error)
}

// ── Blob outbox ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBlobTask {
    pub key: String,
    pub byte_size: Option<i64>,
    pub mime_type: Option<String>,
}

/// Blobs still owing the relay their bytes. `storage_uri IS NOT NULL` — a
/// manifest row from replay ("known remotely, not fetched") has nothing to
/// push; `sync_required = 1` — derivable caches never cross the wire.
pub(crate) fn sync_outbox_blobs_inner(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<SyncBlobTask>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT bo.key, bo.byte_size, bo.mime_type FROM blob_objects bo
             JOIN blob_sync_state bs ON bs.blob_key = bo.key
             WHERE bs.push_state IN ('pending','failed')
               AND bo.sync_required = 1
               AND bo.deleted_at IS NULL
               AND bo.storage_uri IS NOT NULL
             ORDER BY bs.updated_at
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(params![limit], |row| {
            Ok(SyncBlobTask {
                key: row.get(0)?,
                byte_size: row.get(1)?,
                mime_type: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in iter {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn sync_outbox_blobs(limit: i64, db: State<'_, Db>) -> Result<Vec<SyncBlobTask>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_outbox_blobs_inner(&conn, limit)
}

pub(crate) fn sync_mark_blobs_inner(
    conn: &mut Connection,
    keys: &[String],
    state: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for key in keys {
        tx.execute(
            "INSERT INTO blob_sync_state (blob_key, push_state, last_error, pushed_at, updated_at)
             VALUES (?1, ?2, ?3,
                     CASE WHEN ?2 = 'synced' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(blob_key) DO UPDATE SET
                push_state = excluded.push_state,
                last_error = excluded.last_error,
                pushed_at = COALESCE(excluded.pushed_at, blob_sync_state.pushed_at),
                updated_at = excluded.updated_at",
            params![key, state, error],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Also the "don't re-push what we just downloaded" switch: after a lazy blob
/// fetch lands through `put_blob` (which enqueues it), the puller immediately
/// marks it synced.
#[tauri::command]
pub fn sync_mark_blobs_pushed(keys: Vec<String>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_mark_blobs_inner(&mut conn, &keys, "synced", None)
}

/// Permanent refusal (over the size cap, quota exhausted, missing bytes):
/// `rejected` is EXCLUDED from the outbox query, so the loop stops re-uploading
/// tens of megabytes into a guaranteed 413 every cycle. Re-enqueue happens
/// naturally if the blob is ever re-put.
#[tauri::command]
pub fn sync_mark_blobs_rejected(
    keys: Vec<String>,
    error: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_mark_blobs_inner(&mut conn, &keys, "rejected", Some(&error))
}

#[tauri::command]
pub fn sync_mark_blobs_failed(
    keys: Vec<String>,
    error: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    sync_mark_blobs_inner(&mut conn, &keys, "failed", Some(&error))
}
