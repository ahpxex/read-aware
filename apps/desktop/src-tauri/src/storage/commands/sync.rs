//! IPC commands over `read_aware_store::storage::sync`.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn sync_profile_get(app: tauri::AppHandle) -> Result<SyncProfile, CommandError> {
    crate::storage::blocking("sync_profile_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_profile_get_inner(&conn)
    })
    .await
}

#[tauri::command]
pub async fn sync_profile_set(
    profile: SyncProfile,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_profile_set", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_profile_set_inner(&conn, &profile)
    })
    .await
}

/// Stamp `last_push_at` / `last_pull_at` = now without racing a full
/// profile write from another part of the loop.
#[tauri::command]
pub async fn sync_profile_touch(field: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("sync_profile_touch", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let column = match field.as_str() {
            "push" => "last_push_at",
            "pull" => "last_pull_at",
            other => {
                return Err(CommandError::internal(format!(
                    "sync_profile_touch: unknown field `{other}`"
                )))
            }
        };
        let conn = db.0.lock()?;
        conn.execute(
            &format!(
                "UPDATE sync_profile SET {column} = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = 1"
            ),
            [],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sync_cursor_get(
    feed: String,
    app: tauri::AppHandle,
) -> Result<Option<SyncCursor>, CommandError> {
    crate::storage::blocking("sync_cursor_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_cursor_get_inner(&conn, &feed)
    })
    .await
}

#[tauri::command]
pub async fn sync_cursor_set(
    cursor: SyncCursor,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_cursor_set", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_cursor_set_inner(&conn, &cursor)
    })
    .await
}

#[tauri::command]
pub async fn sync_outbox_events(
    limit: i64,
    app: tauri::AppHandle,
) -> Result<Vec<EventRow>, CommandError> {
    crate::storage::blocking("sync_outbox_events", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_outbox_events_inner(&conn, limit)
    })
    .await
}

#[tauri::command]
pub async fn sync_mark_events_pushed(
    assigned: Vec<(String, i64)>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_mark_events_pushed", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_events_pushed_inner(&mut conn, &assigned)
    })
    .await
}

#[tauri::command]
pub async fn sync_mark_events_failed(
    event_ids: Vec<String>,
    error: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_mark_events_failed", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_events_failed_inner(&mut conn, &event_ids, &error)
    })
    .await
}

#[tauri::command]
pub async fn sync_outbox_blobs(
    limit: i64,
    app: tauri::AppHandle,
) -> Result<Vec<SyncBlobTask>, CommandError> {
    crate::storage::blocking("sync_outbox_blobs", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_outbox_blobs_inner(&conn, limit)
    })
    .await
}

/// Also the "don't re-push what we just downloaded" switch: after a lazy blob
/// fetch lands through `put_blob` (which enqueues it), the puller immediately
/// marks it synced.
#[tauri::command]
pub async fn sync_mark_blobs_pushed(
    keys: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_mark_blobs_pushed", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_blobs_inner(&mut conn, &keys, "synced", None)
    })
    .await
}

/// Permanent refusal (over the size cap, quota exhausted, missing bytes):
/// `rejected` is EXCLUDED from the outbox query, so the loop stops re-uploading
/// tens of megabytes into a guaranteed 413 every cycle. Re-enqueue happens
/// naturally if the blob is ever re-put.
#[tauri::command]
pub async fn sync_mark_blobs_rejected(
    keys: Vec<String>,
    error: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_mark_blobs_rejected", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_blobs_inner(&mut conn, &keys, "rejected", Some(&error))
    })
    .await
}

#[tauri::command]
pub async fn sync_quota_rejected_blobs(
    app: tauri::AppHandle,
) -> Result<Vec<SyncBlobTask>, CommandError> {
    crate::storage::blocking("sync_quota_rejected_blobs", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_quota_rejected_blobs_inner(&conn)
    })
    .await
}

/// Put blobs back into the outbox (`pending`, error cleared) — the engine's
/// answer to a quota refusal that no longer applies. Idempotent.
#[tauri::command]
pub async fn sync_requeue_blobs(
    keys: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_requeue_blobs", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_blobs_inner(&mut conn, &keys, "pending", None)
    })
    .await
}

#[tauri::command]
pub async fn sync_mark_blobs_failed(
    keys: Vec<String>,
    error: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_mark_blobs_failed", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_mark_blobs_inner(&mut conn, &keys, "failed", Some(&error))
    })
    .await
}

#[tauri::command]
pub async fn sync_outbox_counts(app: tauri::AppHandle) -> Result<SyncOutboxCounts, CommandError> {
    crate::storage::blocking("sync_outbox_counts", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_outbox_counts_inner(&conn)
    })
    .await
}

#[tauri::command]
pub async fn sync_unverified_events(
    limit: i64,
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("sync_unverified_events", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_unverified_events_inner(&conn, limit)
    })
    .await
}

#[tauri::command]
pub async fn sync_resolve_events(
    known: Vec<(String, i64)>,
    missing: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_resolve_events", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_resolve_events_inner(&mut conn, &known, &missing)
    })
    .await
}

/// A transport that cannot answer "do you have these ids?" gets the
/// pessimistic settlement: everything unverified owes a push.
#[tauri::command]
pub async fn sync_assume_events_missing(app: tauri::AppHandle) -> Result<i64, CommandError> {
    crate::storage::blocking("sync_assume_events_missing", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let n = conn.execute(
            "UPDATE event_sync_state
            SET push_state = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE push_state = 'unverified'",
            [],
        )?;
        Ok(n as i64)
    })
    .await
}

#[tauri::command]
pub async fn sync_unverified_blobs(
    limit: i64,
    app: tauri::AppHandle,
) -> Result<Vec<SyncBlobTask>, CommandError> {
    crate::storage::blocking("sync_unverified_blobs", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        sync_unverified_blobs_inner(&conn, limit)
    })
    .await
}

#[tauri::command]
pub async fn sync_resolve_blobs(
    present: Vec<String>,
    absent: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("sync_resolve_blobs", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_resolve_blobs_inner(&mut conn, &present, &absent)
    })
    .await
}

/// Pessimistic settlement for a transport without HEAD: every unverified
/// blob owes a push.
#[tauri::command]
pub async fn sync_assume_blobs_missing(app: tauri::AppHandle) -> Result<i64, CommandError> {
    crate::storage::blocking("sync_assume_blobs_missing", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let n = conn.execute(
            "UPDATE blob_sync_state
            SET push_state = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE push_state = 'unverified'",
            [],
        )?;
        Ok(n as i64)
    })
    .await
}

#[tauri::command]
pub async fn sync_book_backlog(
    app: tauri::AppHandle,
) -> Result<Vec<SyncBookBacklogRow>, CommandError> {
    crate::storage::blocking("sync_book_backlog", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare(
            "SELECT substr(bo.key, length('bookfile:') + 1),
                    b.title,
                    bo.byte_size,
                    bs.push_state,
                    bs.last_error,
                    bo.storage_uri IS NOT NULL
               FROM blob_objects bo
               JOIN blob_sync_state bs ON bs.blob_key = bo.key
               -- INNER: a blob row whose book is gone (an orphan a delete left
               -- behind) is bookkeeping residue, not a book the user can see.
               JOIN books b ON b.id = substr(bo.key, length('bookfile:') + 1)
              WHERE bo.key LIKE 'bookfile:%'
                AND bo.deleted_at IS NULL
                AND bs.push_state IN ('pending', 'failed', 'rejected', 'unverified')
              ORDER BY CASE bs.push_state
                         WHEN 'rejected' THEN 0
                         WHEN 'failed' THEN 1
                         ELSE 2
                       END,
                       bo.byte_size DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SyncBookBacklogRow {
                    book_id: row.get(0)?,
                    title: row.get(1)?,
                    byte_size: row.get(2)?,
                    push_state: row.get(3)?,
                    last_error: row.get(4)?,
                    local_bytes: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn sync_adopt_account(
    account_id: String,
    app: tauri::AppHandle,
) -> Result<bool, CommandError> {
    crate::storage::blocking("sync_adopt_account", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        sync_adopt_account_inner(&mut conn, &account_id)
    })
    .await
}
