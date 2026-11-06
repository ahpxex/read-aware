//! IPC commands over `read_aware_store::storage::events`.
use crate::error::CommandError;
use crate::storage::*;
use tauri::Manager;

/// Append events WITHOUT touching the projections.
///
/// The one caller is the boot-time genesis backfill, which synthesizes creation
/// events for pre-event-era rows: the projection already holds that state, so
/// applying would be redundant. Every path that changes state uses
/// `commit_events` instead.
#[tauri::command]
pub async fn append_events(
    events: Vec<EventRow>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("append_events", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        append_events_inner(&mut conn, &events)
    })
    .await
}

/// THE write path: append events and apply them to the projections in ONE
/// transaction.
///
/// Before this existed the frontend wrote the projection itself and appended
/// the event next to it, fire-and-forget — so a failure on either side left the
/// two disagreeing with nothing to detect or repair it. Now the log leads and
/// the tables derive from it: both land, or neither does.
#[tauri::command]
pub async fn commit_events(
    events: Vec<EventRow>,
    app: tauri::AppHandle,
) -> Result<CommitReport, CommandError> {
    crate::storage::blocking("commit_events", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        commit_events_inner(&mut conn, &events)
    })
    .await
}

#[tauri::command]
pub async fn stage_remote_events(
    events: Vec<EventRow>,
    seqs: Option<Vec<i64>>,
    app: AppHandle,
) -> Result<usize, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        stage_remote_events_inner(&mut conn, &data_dir.0, &events, seqs.as_deref())
    })
    .await
    .map_err(|e| format!("stage_remote_events task failed: {e}"))?
}

#[tauri::command]
pub async fn finalize_staged_events(app: AppHandle) -> Result<Option<RebuildReport>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        finalize_staged_events_inner(&mut conn, &data_dir.0)
    })
    .await
    .map_err(|e| format!("finalize_staged_events task failed: {e}"))?
}

/// The sync engine's merge entry point: append events pulled from the relay
/// and bring the projections up to date, in ONE transaction.
///
/// Differs from `commit_events` in exactly two ways: merged events do NOT enter
/// the push outbox (they came from the relay — echoing them back would loop
/// forever), and out-of-HLC-order arrivals fall back to a full replay rather
/// than applying incrementally (see `apply_remote_events_inner`). The caller
/// (the pull loop) is responsible for `hlc.observe()`-ing every stamp BEFORE
/// invoking this, and for advancing `sync_cursors` after it returns.
#[tauri::command]
pub async fn apply_remote_events(
    events: Vec<EventRow>,
    seqs: Option<Vec<i64>>,
    app: AppHandle,
) -> Result<MergeReport, CommandError> {
    // Same threading note as `rebuild_projections`: the replay fallback is
    // unbounded work and must stay off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        apply_remote_events_inner(&mut conn, &data_dir.0, &events, seqs.as_deref())
    })
    .await
    .map_err(|e| format!("apply_remote_events task failed: {e}"))?
}

/// Distinct aggregate ids that already have an event of one of the given types.
/// Backs the boot-time genesis reconciliation: the frontend synthesizes
/// creation events for projection rows whose aggregate never entered the log.
#[tauri::command]
pub async fn list_event_aggregate_ids(
    types: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("list_event_aggregate_ids", move || {
        let db = tauri::Manager::state::<Db>(&app);
        if types.is_empty() {
            return Ok(Vec::new());
        }
        let conn = db.0.lock()?;
        let placeholders = vec!["?"; types.len()].join(", ");
        let sql = format!(
            "SELECT DISTINCT aggregate_id FROM domain_events
         WHERE aggregate_id IS NOT NULL AND type IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let iter = stmt.query_map(rusqlite::params_from_iter(types.iter()), |row| {
            row.get::<_, String>(0)
        })?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        if types.iter().any(|kind| kind == "memory.promoted") {
            // Onboarding seeds have one compound creation event. Their receipt
            // survives checkpoints and prevents genesis from minting them again.
            let mut seeds = conn.prepare(
                "SELECT DISTINCT value FROM onboarding_receipts, json_each(memory_ids_json)",
            )?;
            let rows = seeds.query_map([], |row| row.get::<_, String>(0))?;
            for id in rows {
                out.push(id?);
            }
        }
        Ok(out)
    })
    .await
}

/// Discard the derived tables and rebuild them from the event log.
///
/// This is what makes `domain_events` the source of truth rather than a claim:
/// disaster recovery, and the restore half of a future multi-device bootstrap.
///
/// `async` + `spawn_blocking`: a full replay is unbounded work (it scales with
/// the log), and a synchronous command would run it on the main thread and
/// freeze the window for its duration.
#[tauri::command]
pub async fn rebuild_projections(app: AppHandle) -> Result<RebuildReport, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        rebuild_projections_inner(&mut conn)
    })
    .await
    .map_err(|e| format!("rebuild_projections task failed: {e}"))?
}

/// Replay the log into scratch state and diff it against the live projections,
/// then roll everything back.
///
/// A clean result is the only real evidence that the log is complete enough to
/// sync — the projections and the events agree on every row. Drift points at
/// exactly which table (and which rows) a write path failed to record.
/// Same threading note as `rebuild_projections`: this replays the whole log
/// (twice over, counting the snapshots), so it must stay off the main thread.
#[tauri::command]
pub async fn verify_projections(app: AppHandle) -> Result<VerifyReport, CommandError> {
    tauri::async_runtime::spawn_blocking(move || verify_inner(&tauri::Manager::state::<Db>(&app)))
        .await
        .map_err(|e| format!("verify_projections task failed: {e}"))?
}
