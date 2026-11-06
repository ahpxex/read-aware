//! IPC commands over `read_aware_store::storage::reading_time`.
use crate::error::CommandError;
use crate::storage::*;

/// Give the pre-event-era reading-time aggregates a history in the log.
///
/// These three tables were written directly, and the `book.timeRecorded`
/// events that should have described them were fire-and-forget — so the log has
/// none of them. Left alone, `rebuild_projections` would faithfully replay the
/// log and wipe every reading statistic the user has.
///
/// Aggregates cannot be reversed into the individual ticks that produced them,
/// so this reconstructs a distribution that reproduces the SAME table contents:
/// per book, the daily and hourly marginals are multiplied into a joint
/// (day, hour) grid, normalized so each margin still sums to its original
/// value. Replaying the result restores all three tables exactly; only the
/// invented *interleaving* of days and hours is not real history, which is the
/// most that can be recovered from a sum.
///
/// Idempotent: it does nothing once the log contains any `book.timeRecorded`.
#[tauri::command]
pub async fn reading_time_genesis(app: tauri::AppHandle) -> Result<usize, CommandError> {
    crate::storage::blocking("reading_time_genesis", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_time_genesis_inner(&mut conn)
    })
    .await
}

#[tauri::command]
pub async fn reading_time_load(app: tauri::AppHandle) -> Result<ReadingTimeWire, CommandError> {
    crate::storage::blocking("reading_time_load", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let wire = reading_time_load_conn(&tx, None)?;
        tx.commit()?;
        Ok(wire)
    })
    .await
}

#[tauri::command]
pub async fn reading_time_scope(
    book_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<ReadingTimeWire, CommandError> {
    crate::storage::blocking("reading_time_scope", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_time_scope_inner(&mut conn, book_id)
    })
    .await
}

/// One tracker tick: add `deltaMs` of active reading to its hour bucket.
#[tauri::command]
pub async fn reading_session_accrue(
    book_id: String,
    local_day: String,
    local_hour: i64,
    delta_ms: i64,
    at_epoch_ms: i64,
    app: tauri::AppHandle,
) -> Result<ReadingSessionBucket, CommandError> {
    crate::storage::blocking("reading_session_accrue", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        reading_session_accrue_inner(
            &conn,
            &book_id,
            &local_day,
            local_hour,
            delta_ms,
            at_epoch_ms,
        )
    })
    .await
}

/// One page turn: the bucket's position becomes `progress`.
#[tauri::command]
pub async fn reading_session_position(
    book_id: String,
    local_day: String,
    local_hour: i64,
    at_epoch_ms: i64,
    progress: Value,
    app: tauri::AppHandle,
) -> Result<ReadingSessionBucket, CommandError> {
    crate::storage::blocking("reading_session_position", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        reading_session_position_inner(
            &conn,
            &book_id,
            &local_day,
            local_hour,
            at_epoch_ms,
            &progress,
        )
    })
    .await
}

/// Every open bucket (boot recovery closes what a crash left).
#[tauri::command]
pub async fn reading_sessions_pending(
    app: tauri::AppHandle,
) -> Result<Vec<ReadingSessionBucket>, CommandError> {
    crate::storage::blocking("reading_sessions_pending", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        reading_sessions_pending_inner(&conn)
    })
    .await
}

#[tauri::command]
pub async fn reading_session_flush(
    events: Vec<EventRow>,
    app: tauri::AppHandle,
) -> Result<CommitReport, CommandError> {
    crate::storage::blocking("reading_session_flush", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_session_flush_inner(&mut conn, &events)
    })
    .await
}

/// LEGACY-MIGRATION-ONLY projection writer, exempt from the `apply_event` rule
/// in `apply.rs`. Its only caller is the one-time interim `app_kv` reading-stats
/// migration (`apps/web/src/platform/interim-projections.ts`). It bulk-replaces
/// the reading-time tables and clears the genesis stamp, so the next
/// `reading_time_genesis` pass reconciles them with the log. Every other write
/// goes through `commit_events` — do not add callers.
#[tauri::command]
pub async fn reading_time_import(
    wire: ReadingTimeWire,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("reading_time_import", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_time_import_inner(&mut conn, &wire)
    })
    .await
}
