//! Close this device's reading facts before portable capture or merge planning.
//! A pending bucket has no portable identity. Never infer overlap by timestamps
//! or invent an identity after copying it to a second device.
use super::{Db, EventRow, ReadingSessionBucket};
use crate::error::CommandError;
use rusqlite::{Connection, TransactionBehavior};
use std::collections::BTreeMap;
use tauri::Manager;

type BucketKey = (String, String, i64);
fn changed() -> CommandError {
    CommandError::new(
        "backup/changed",
        "pending reading catalog or event clock changed",
    )
}
fn invalid() -> CommandError {
    CommandError::new("backup/incomplete", "invalid reading closure for backup")
}
pub(crate) fn require_closed(conn: &Connection) -> Result<(), CommandError> {
    if conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM reading_sessions_pending)",
        [],
        |row| row.get::<_, bool>(0),
    )? {
        return Err(CommandError::new(
            "backup/incomplete",
            "close pending reading sessions before backup capture or merge planning",
        ));
    }
    Ok(())
}
fn key(event: &EventRow) -> Result<BucketKey, CommandError> {
    let book = event
        .payload
        .get("bookId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(invalid)?;
    let day = event
        .payload
        .get("localDay")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(invalid)?;
    let hour = event
        .payload
        .get("localHour")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(invalid)?;
    if event.event_type != "book.sessionRecorded"
        || event.origin.as_deref() != Some("system")
        || event.aggregate_type.as_deref() != Some("book")
        || event.aggregate_id.as_deref() != Some(book)
        || book.is_empty()
        || book.len() > 4096
        || day.len() != 10
        || !(0..=23).contains(&hour)
    {
        return Err(invalid());
    }
    Ok((book.to_owned(), day.to_owned(), hour))
}
fn payload(bucket: &ReadingSessionBucket) -> Result<serde_json::Value, CommandError> {
    if bucket.ms < 0
        || bucket.ms > 9_007_199_254_740_991
        || bucket.last_at < bucket.started_at
        || !(bucket.progress.is_null() || bucket.progress.is_object())
    {
        return Err(invalid());
    }
    let mut result = serde_json::json!({"bookId":bucket.book_id,"localDay":bucket.local_day,"localHour":bucket.local_hour,
        "ms":bucket.ms,"startedAt":bucket.started_at,"endedAt":bucket.last_at});
    if bucket.progress.is_object() {
        let mut progress = bucket.progress.clone();
        progress["observedAt"] = serde_json::json!(bucket.position_at.unwrap_or(bucket.last_at));
        result["progress"] = progress;
    }
    Ok(result)
}
/// Caller owns the native Db lock and has paused reader writes through capture.
/// Returned events contain ACTUAL closed facts, not the caller's older snapshot.
/// If export subsequently fails, these legitimate reading facts stay committed.
pub(crate) fn close(
    conn: &mut Connection,
    input: Vec<EventRow>,
) -> Result<Vec<EventRow>, CommandError> {
    if input.len() > 100_000 {
        return Err(invalid());
    }
    let mut requested = BTreeMap::new();
    for event in input {
        if requested.insert(key(&event)?, event).is_some() {
            return Err(invalid());
        }
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // Bound the read and its eventual IPC receipt before loading JSON bodies.
    let mut total = 0i64;
    let mut count = 0usize;
    {
        let mut query = tx.prepare("SELECT length(CAST(book_id AS BLOB))+length(CAST(local_day AS BLOB))+coalesce(length(CAST(progress_json AS BLOB)),0) FROM reading_sessions_pending LIMIT 100001")?;
        let mut lengths = query.query([])?;
        while let Some(row) = lengths.next()? {
            count += 1;
            total += row.get::<_, i64>(0)?;
            if count > 100_000 || total > 64 * 1024 * 1024 {
                return Err(invalid());
            }
        }
    }
    let current = super::reading_sessions_pending_inner(&tx)?;
    let mut actual = BTreeMap::new();
    for bucket in current {
        if bucket.ms > 0 || !bucket.progress.is_null() {
            actual.insert(
                (
                    bucket.book_id.clone(),
                    bucket.local_day.clone(),
                    bucket.local_hour,
                ),
                bucket,
            );
        }
    }
    // No active facts remain: a lost close receipt can be retried without
    // minting a second event. Inert zero/null rows may be retired safely.
    if !actual.is_empty() && !actual.keys().eq(requested.keys()) {
        return Err(changed());
    }
    let mut committed = Vec::new();
    // Preserve minted clock order, which need not match book/day/hour ordering.
    let mut ordered: Vec<_> = requested.into_values().collect();
    ordered.sort_by(|a, b| {
        (&a.hlc.wall_ms, &a.hlc.counter, &a.hlc.device_id).cmp(&(
            &b.hlc.wall_ms,
            &b.hlc.counter,
            &b.hlc.device_id,
        ))
    });
    for mut event in ordered {
        let Some(bucket) = actual.remove(&key(&event)?) else {
            continue;
        };
        super::local_event_guard::validate_new_event(&tx, &event).map_err(|error| {
            match error.code.as_str() {
                "memory/conflict" | "memory/invalid-input" => changed(),
                _ => error,
            }
        })?;
        event.payload = payload(&bucket)?;
        super::reading_session_flush_in_transaction(&tx, std::slice::from_ref(&event))?;
        committed.push(event);
    }
    tx.execute("DELETE FROM reading_sessions_pending WHERE ms=0 AND (progress_json IS NULL OR progress_json='null')",[])?;
    require_closed(&tx)?;
    tx.commit()?;
    Ok(committed)
}
#[tauri::command]
pub async fn backup_close_reading_sessions(
    app: tauri::AppHandle,
    events: Vec<EventRow>,
) -> Result<Vec<EventRow>, CommandError> {
    super::blocking("backup_close_reading_sessions", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        close(&mut conn, events)
    })
    .await
}
#[cfg(test)]
#[path = "backup_reading_tests.rs"]
mod tests;
