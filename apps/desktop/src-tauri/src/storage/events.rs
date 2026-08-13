//! The event log and its replay: append, read, rebuild, verify.
//!
//! This is the half of event sourcing that makes `domain_events` authoritative
//! rather than decorative — `commit_events` is the only write path, and
//! `rebuild_projections` / `verify_projections` prove the tables can be
//! reproduced from it. The mapping itself lives in `apply.rs`.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;

pub(crate) fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
    let payload_str: String = row.get("payload_json")?;
    let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);
    Ok(EventRow {
        id: row.get("id")?,
        event_type: row.get("type")?,
        hlc: Hlc {
            wall_ms: row.get("hlc_wall_ms")?,
            counter: row.get("hlc_counter")?,
            device_id: row.get("hlc_device")?,
        },
        schema_version: row.get("schema_version")?,
        aggregate_type: row.get("aggregate_type")?,
        aggregate_id: row.get("aggregate_id")?,
        actor_id: row.get("actor_id")?,
        origin: row.get("origin")?,
        created_at: row.get("created_at")?,
        payload,
    })
}

// --- Event log (the sync unit) ---

/// Where an envelope entered the log, which decides whether it enters the push
/// outbox: local writes still owe the relay a copy; events PULLED from the
/// relay are already there, and re-enqueueing them would echo every pull
/// straight back as a push.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EventSource {
    Local,
    Remote,
}

/// Insert one envelope into the log. Returns whether the row was NEW — dedup by
/// event id (and by the unique HLC index) makes redelivery a no-op, and callers
/// use the answer to avoid applying an event to the projections twice.
pub(crate) fn insert_event_row(
    tx: &Transaction<'_>,
    ev: &EventRow,
    source: EventSource,
) -> Result<bool, String> {
    let payload = serde_json::to_string(&ev.payload).map_err(|e| e.to_string())?;
    // `?4` (HLC wall ms) is reused to derive created_at when the caller
    // didn't stamp one.
    let inserted = tx
        .execute(
            "INSERT OR IGNORE INTO domain_events
                (id, type, schema_version, hlc_wall_ms, hlc_counter, hlc_device,
                 aggregate_type, aggregate_id, payload_json, actor_id, origin, created_at)
             VALUES (?1, ?2, COALESCE(?3, 1), ?4, ?5, ?6, ?7, ?8, ?9,
                     COALESCE(?10, 'local'),
                     COALESCE(?11, 'user'),
                     COALESCE(?12, strftime('%Y-%m-%dT%H:%M:%fZ', ?4 / 1000.0, 'unixepoch')))",
            params![
                ev.id,
                ev.event_type,
                ev.schema_version,
                ev.hlc.wall_ms,
                ev.hlc.counter,
                ev.hlc.device_id,
                ev.aggregate_type,
                ev.aggregate_id,
                payload,
                ev.actor_id,
                ev.origin,
                ev.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    // Locally-appended events enter the push outbox; ignored duplicates
    // (already logged, possibly already pushed) must not re-enter it.
    if inserted > 0 && source == EventSource::Local {
        tx.execute(
            "INSERT OR IGNORE INTO event_sync_state (event_id, updated_at)
             VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![ev.id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(inserted > 0)
}

pub(crate) fn append_events_inner(conn: &mut Connection, events: &[EventRow]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for ev in events {
        insert_event_row(&tx, ev, EventSource::Local)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Append events WITHOUT touching the projections.
///
/// The one caller is the boot-time genesis backfill, which synthesizes creation
/// events for pre-event-era rows: the projection already holds that state, so
/// applying would be redundant. Every path that changes state uses
/// `commit_events` instead.
#[tauri::command]
pub fn append_events(events: Vec<EventRow>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    append_events_inner(&mut conn, &events)
}

/// What a `commit_events` call did.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReport {
    /// Envelopes the log accepted (duplicates excluded).
    pub appended: usize,
    /// Of those, how many changed a projection row. The remainder are events
    /// with no projection (profile/entity, cover bookkeeping, unknown types).
    pub applied: usize,
}

pub(crate) fn commit_events_inner(
    conn: &mut Connection,
    events: &[EventRow],
) -> Result<CommitReport, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut report = CommitReport {
        appended: 0,
        applied: 0,
    };
    for ev in events {
        // Redelivery: the log already holds it, so the projection already
        // reflects it. Skipping keeps accumulating projections (reading_time)
        // from double-counting.
        if !insert_event_row(&tx, ev, EventSource::Local)? {
            continue;
        }
        report.appended += 1;
        if apply::apply_event(&tx, ev)? {
            report.applied += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

/// THE write path: append events and apply them to the projections in ONE
/// transaction.
///
/// Before this existed the frontend wrote the projection itself and appended
/// the event next to it, fire-and-forget — so a failure on either side left the
/// two disagreeing with nothing to detect or repair it. Now the log leads and
/// the tables derive from it: both land, or neither does.
#[tauri::command]
pub fn commit_events(events: Vec<EventRow>, db: State<'_, Db>) -> Result<CommitReport, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    commit_events_inner(&mut conn, &events)
}

/// What a `apply_remote_events` call did.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    /// Envelopes the log accepted (already-merged duplicates excluded).
    pub appended: usize,
    /// Projection rows changed by the incremental path; 0 when `replayed`.
    pub applied: usize,
    /// True when merged events landed BEHIND existing log entries in HLC order,
    /// so the projections were rebuilt by full replay instead of incremental
    /// apply.
    pub replayed: bool,
}

/// The log's newest HLC stamp, as an ordering key. None on an empty log.
fn max_hlc_key(tx: &Transaction<'_>) -> Result<Option<(i64, i64, String)>, String> {
    tx.query_row(
        "SELECT hlc_wall_ms, hlc_counter, hlc_device FROM domain_events
         ORDER BY hlc_wall_ms DESC, hlc_counter DESC, hlc_device DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn hlc_key(ev: &EventRow) -> (i64, i64, String) {
    (ev.hlc.wall_ms, ev.hlc.counter, ev.hlc.device_id.clone())
}

pub(crate) fn apply_remote_events_inner(
    conn: &mut Connection,
    events: &[EventRow],
) -> Result<MergeReport, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let horizon = max_hlc_key(&tx)?;

    let mut fresh: Vec<&EventRow> = Vec::new();
    for ev in events {
        if insert_event_row(&tx, ev, EventSource::Remote)? {
            fresh.push(ev);
        }
    }
    let mut report = MergeReport {
        appended: fresh.len(),
        applied: 0,
        replayed: false,
    };
    if fresh.is_empty() {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(report);
    }

    // The relay feeds events in arrival (server_seq) order, which is unrelated
    // to HLC order — sort so the incremental path applies them as the log
    // orders them.
    fresh.sort_by_key(|ev| hlc_key(ev));

    // Incremental apply is only sound when every merged event extends the log's
    // frontier: projections reflect the log AS ORDERED, so an event slotting in
    // behind existing entries (both devices wrote while apart) can't just be
    // applied last — a stale `book.metadataEdited` would overwrite a newer
    // title. In that case rebuild from the log, which replays everything in
    // HLC order and lands both devices on identical projections.
    let extends_frontier = match &horizon {
        None => true,
        Some(h) => hlc_key(fresh[0]) > *h,
    };
    if extends_frontier {
        for ev in fresh {
            if apply::apply_event(&tx, ev)? {
                report.applied += 1;
            }
        }
    } else {
        replay_into(&tx)?;
        report.replayed = true;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
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
pub async fn apply_remote_events(events: Vec<EventRow>, app: AppHandle) -> Result<MergeReport, String> {
    // Same threading note as `rebuild_projections`: the replay fallback is
    // unbounded work and must stay off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        apply_remote_events_inner(&mut conn, &events)
    })
    .await
    .map_err(|e| format!("apply_remote_events task failed: {e}"))?
}

#[tauri::command]
pub fn read_events_since(after: Option<Hlc>, db: State<'_, Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    match after {
        Some(a) => {
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM domain_events
                     WHERE (hlc_wall_ms, hlc_counter, hlc_device) > (?1, ?2, ?3)
                     ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map(params![a.wall_ms, a.counter, a.device_id], row_to_event)
                .map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM domain_events
                     ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map([], row_to_event)
                .map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

/// Distinct aggregate ids that already have an event of one of the given types.
/// Backs the boot-time genesis reconciliation: the frontend synthesizes
/// creation events for projection rows whose aggregate never entered the log.
#[tauri::command]
pub fn list_event_aggregate_ids(
    types: Vec<String>,
    db: State<'_, Db>,
) -> Result<Vec<String>, String> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let placeholders = vec!["?"; types.len()].join(", ");
    let sql = format!(
        "SELECT DISTINCT aggregate_id FROM domain_events
         WHERE aggregate_id IS NOT NULL AND type IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(rusqlite::params_from_iter(types.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in iter {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// --- Replay: rebuild + verify (proves the log is authoritative) ---

/// Per-table row counts after a replay, plus how much of the log was consumed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildReport {
    pub events_replayed: usize,
    pub events_applied: usize,
    pub rows: std::collections::BTreeMap<String, i64>,
}

/// Replay the whole log into the derived tables, inside `tx`.
///
/// `books.cover_url` / `cover_checked` survive the wipe: they cache work done
/// on object-storage content, not domain facts, and re-extracting every cover
/// is pure waste (see storage::apply's module header).
pub(crate) fn replay_into(tx: &Transaction<'_>) -> Result<RebuildReport, String> {
    let cache_columns = apply::BOOK_LOCAL_CACHE_COLUMNS;
    let cached: Vec<(String, Vec<rusqlite::types::Value>)> = {
        let sql = format!("SELECT id, {} FROM books", cache_columns.join(", "));
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let mut values = Vec::with_capacity(cache_columns.len());
                for i in 0..cache_columns.len() {
                    values.push(row.get::<_, rusqlite::types::Value>(i + 1)?);
                }
                Ok((id, values))
            })
            .map_err(|e| e.to_string())?;
        iter.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    for table in apply::DERIVED_TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|e| e.to_string())?;
    }

    // Collected up front so the statement's borrow of `tx` ends before
    // `apply_event` needs it. Event logs for a reading app stay in the
    // thousands; if that ever changes this becomes a chunked cursor.
    let events: Vec<EventRow> = {
        let mut stmt = tx
            .prepare(
                "SELECT * FROM domain_events
                 ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt.query_map([], row_to_event).map_err(|e| e.to_string())?;
        iter.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let mut applied = 0usize;
    for ev in &events {
        if apply::apply_event(tx, ev)? {
            applied += 1;
        }
    }

    {
        let assignments = cache_columns
            .iter()
            .enumerate()
            .map(|(i, column)| format!("{column} = ?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("UPDATE books SET {assignments} WHERE id = ?1");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        for (id, values) in &cached {
            let mut bound: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(values.len() + 1);
            bound.push(id);
            for value in values {
                bound.push(value);
            }
            stmt.execute(bound.as_slice()).map_err(|e| e.to_string())?;
        }
    }

    let mut rows = std::collections::BTreeMap::new();
    for table in apply::DERIVED_TABLES {
        let count: i64 = tx
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.insert((*table).to_string(), count);
    }

    Ok(RebuildReport {
        events_replayed: events.len(),
        events_applied: applied,
        rows,
    })
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
pub async fn rebuild_projections(app: AppHandle) -> Result<RebuildReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let report = replay_into(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(report)
    })
    .await
    .map_err(|e| format!("rebuild_projections task failed: {e}"))?
}

/// One table's disagreement between the live projection and a fresh replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDrift {
    pub table: String,
    /// Rows the live projection has that a replay does not produce — writes the
    /// log never captured.
    pub only_live: usize,
    /// Rows a replay produces that the live projection lacks — events whose
    /// effect never reached the table.
    pub only_replayed: usize,
    /// Up to three examples from either side, for diagnosis.
    pub samples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub consistent: bool,
    pub events_replayed: usize,
    pub drift: Vec<TableDrift>,
}

fn value_to_json(v: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(s) => Value::String(String::from_utf8_lossy(s).into_owned()),
        ValueRef::Blob(b) => Value::String(format!("<blob {} bytes>", b.len())),
    }
}

/// A table's event-derived content as a multiset of canonical row strings
/// (serde_json sorts object keys, so the encoding is stable regardless of column
/// order). Local-only columns and rows are excluded per the spec — comparing
/// them would report drift that no write path could ever fix.
pub(crate) fn snapshot_table(
    tx: &Transaction<'_>,
    spec: &apply::DiffSpec,
) -> Result<std::collections::BTreeMap<String, i64>, String> {
    let sql = match spec.domain_rows {
        Some(filter) => format!("SELECT * FROM {} WHERE {filter}", spec.table),
        None => format!("SELECT * FROM {}", spec.table),
    };
    let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut out = std::collections::BTreeMap::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = serde_json::Map::new();
        for (i, name) in columns.iter().enumerate() {
            if spec.local_columns.contains(&name.as_str()) {
                continue;
            }
            obj.insert(
                name.clone(),
                value_to_json(row.get_ref(i).map_err(|e| e.to_string())?),
            );
        }
        *out.entry(Value::Object(obj).to_string()).or_insert(0) += 1;
    }
    Ok(out)
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
pub async fn verify_projections(app: AppHandle) -> Result<VerifyReport, String> {
    tauri::async_runtime::spawn_blocking(move || verify_inner(&app))
        .await
        .map_err(|e| format!("verify_projections task failed: {e}"))?
}

pub(crate) fn verify_inner(app: &AppHandle) -> Result<VerifyReport, String> {
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut live = std::collections::BTreeMap::new();
    for spec in apply::DIFF_SPECS {
        live.insert(spec.table, snapshot_table(&tx, spec)?);
    }

    let report = replay_into(&tx)?;

    let mut drift = Vec::new();
    for spec in apply::DIFF_SPECS {
        let table = &spec.table;
        let replayed = snapshot_table(&tx, spec)?;
        let live_rows = &live[spec.table];
        let mut only_live = 0usize;
        let mut only_replayed = 0usize;
        // Sampled per side, not first-come — otherwise one side fills the quota
        // and the report shows a row with nothing to compare it against.
        let mut live_samples = Vec::new();
        let mut replay_samples = Vec::new();
        for (row, count) in live_rows {
            let extra = count - replayed.get(row).copied().unwrap_or(0);
            if extra > 0 {
                only_live += extra as usize;
                if live_samples.len() < 2 {
                    live_samples.push(format!("only-live: {row}"));
                }
            }
        }
        for (row, count) in &replayed {
            let extra = count - live_rows.get(row).copied().unwrap_or(0);
            if extra > 0 {
                only_replayed += extra as usize;
                if replay_samples.len() < 2 {
                    replay_samples.push(format!("only-replayed: {row}"));
                }
            }
        }
        let mut samples = live_samples;
        samples.append(&mut replay_samples);
        if only_live > 0 || only_replayed > 0 {
            drift.push(TableDrift {
                table: (*table).to_string(),
                only_live,
                only_replayed,
                samples,
            });
        }
    }

    // Diagnosis only — never mutate. The rollback undoes the replay.
    tx.rollback().map_err(|e| e.to_string())?;

    Ok(VerifyReport {
        consistent: drift.is_empty(),
        events_replayed: report.events_replayed,
        drift,
    })
}

