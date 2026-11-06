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
use crate::error::CommandError;
use rusqlite::OptionalExtension;

pub fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
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

// --- Local HLC stamps minted natively ---

/// The newest stamp the log holds, from any device, or a restored checkpoint's
/// frontier when that is newer (a still-backfilling log): every new local
/// stamp must sort after it.
pub fn log_frontier(conn: &Connection) -> Result<Option<(i64, i64)>, CommandError> {
    Ok(conn
        .query_row(
            "SELECT hlc_wall_ms, hlc_counter FROM (
                SELECT hlc_wall_ms, hlc_counter FROM domain_events
                UNION ALL
                SELECT hlc_wall_ms, hlc_counter FROM projection_checkpoints
             )
             ORDER BY hlc_wall_ms DESC, hlc_counter DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?)
}

/// Stamps for `count` new events of this device, strictly after the log
/// frontier — the HLC send rule the web clock follows. Call inside the write
/// transaction that appends them (`BEGIN IMMEDIATE`): no other writer can then
/// take the same stamps between this read and the insert.
pub fn next_local_stamps(tx: &Transaction<'_>, count: usize) -> Result<Vec<Hlc>, CommandError> {
    let device_id = ensure_local_device(tx)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| CommandError::internal(format!("system clock before 1970: {error}")))?
        .as_millis() as i64;
    // Same millisecond as (or a clock behind) the frontier: continue its
    // counter; otherwise start the current millisecond fresh.
    let (wall, mut counter) = match log_frontier(tx)? {
        Some((wall, counter)) if wall >= now => (wall, counter),
        _ => (now, -1),
    };
    let mut stamps = Vec::with_capacity(count);
    for _ in 0..count {
        counter += 1;
        stamps.push(Hlc {
            wall_ms: wall,
            counter,
            device_id: device_id.clone(),
        });
    }
    Ok(stamps)
}

// --- Event log (the sync unit) ---

/// Where an envelope entered the log, which decides whether it enters the push
/// outbox: local writes still owe the relay a copy; events PULLED from the
/// relay are already there, and re-enqueueing them would echo every pull
/// straight back as a push.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventSource {
    Local,
    Remote,
}

/// Insert one envelope into the log. Returns whether the row was NEW — dedup by
/// event id makes redelivery a no-op, and callers use the answer to avoid
/// applying an event to the projections twice. A local event whose HLC stamp is
/// already held by a different event fails with `event/hlc-conflict`.
pub fn insert_event_row(
    tx: &Transaction<'_>,
    ev: &EventRow,
    source: EventSource,
) -> Result<bool, CommandError> {
    insert_event_row_with_seq(tx, ev, source, None)
}

/// `insert_event_row`, plus the relay's word: when a pulled envelope arrives
/// with its `server_seq`, the mailbox demonstrably holds this id — so the
/// bookkeeping row is settled as `synced` at that seq whether the event was
/// new here or already logged (a local event whose push ack was lost, an
/// `unverified` row after an account adoption). This is what makes a pull
/// double as verification: nothing the relay just handed back ever needs to
/// be pushed again.
pub fn insert_event_row_with_seq(
    tx: &Transaction<'_>,
    ev: &EventRow,
    source: EventSource,
    remote_seq: Option<i64>,
) -> Result<bool, CommandError> {
    let payload = serde_json::to_string(&ev.payload)?;
    // `?4` (HLC wall ms) is reused to derive created_at when the caller
    // didn't stamp one.
    let inserted = tx.execute(
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
    )?;
    if inserted == 0 {
        // Ignored for one of two reasons. The same event redelivered (its id
        // is already logged) is the idempotent case callers rely on. A
        // different event at an already-used stamp is not: the unique HLC
        // index refused it, and skipping it would lose the write while the
        // caller reports success. Locally that means a second process on this
        // device (the CLI) minted the same stamp, so the batch must fail.
        let logged: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id = ?1)",
            [&ev.id],
            |row| row.get(0),
        )?;
        if !logged {
            if source == EventSource::Local {
                return Err(CommandError::new(
                    crate::error::CODE_EVENT_HLC_CONFLICT,
                    "another event already holds this HLC stamp",
                ));
            }
            log::warn!(
                "remote event {} reuses HLC stamp {}:{}:{} of a logged event; skipped",
                ev.id,
                ev.hlc.wall_ms,
                ev.hlc.counter,
                ev.hlc.device_id
            );
        }
    }
    // Locally-appended events enter the push outbox; ignored duplicates
    // (already logged, possibly already pushed) must not re-enter it.
    if inserted > 0 && source == EventSource::Local {
        tx.execute(
            "INSERT OR IGNORE INTO event_sync_state (event_id, updated_at)
             VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![ev.id],
        )?;
    }
    if let Some(seq) = remote_seq {
        tx.execute(
            "INSERT INTO event_sync_state
                (event_id, push_state, remote_id, pushed_at, last_error, updated_at)
             VALUES (?1, 'synced', ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL,
                     strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(event_id) DO UPDATE SET
                push_state = 'synced',
                remote_id = excluded.remote_id,
                pushed_at = COALESCE(event_sync_state.pushed_at, excluded.pushed_at),
                last_error = NULL,
                updated_at = excluded.updated_at",
            params![ev.id, seq.to_string()],
        )?;
    }
    Ok(inserted > 0)
}

pub fn append_events_inner(conn: &mut Connection, events: &[EventRow]) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    for ev in events {
        insert_event_row(&tx, ev, EventSource::Local)?;
    }
    tx.commit()?;
    Ok(())
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

pub fn commit_events_inner(
    conn: &mut Connection,
    events: &[EventRow],
) -> Result<CommitReport, CommandError> {
    let tx = conn.transaction()?;
    let report = commit_events_in_transaction(&tx, events)?;
    tx.commit()?;
    Ok(report)
}

pub fn commit_events_in_transaction(
    tx: &Transaction<'_>,
    events: &[EventRow],
) -> Result<CommitReport, CommandError> {
    let mut report = CommitReport {
        appended: 0,
        applied: 0,
    };
    for ev in events {
        // Redelivery: the log already holds it, so the projection already
        // reflects it. Skipping keeps accumulating projections (reading_time)
        // from double-counting.
        if !insert_event_row(tx, ev, EventSource::Local)? {
            continue;
        }
        super::annotation_range::validate_local_source(tx, ev)?;
        report.appended += 1;
        if apply::apply_event(tx, ev)? {
            report.applied += 1;
        }
    }
    Ok(report)
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
    /// so the projections were rebuilt by replay (from the newest still-valid
    /// checkpoint, or from empty) instead of incremental apply.
    pub replayed: bool,
    /// True when such a replay could NOT run yet: the log is still backfilling
    /// behind a bootstrap checkpoint that the merged events just invalidated.
    /// The events are in the log and the projections are marked stale; the
    /// backfill's completion replays them.
    #[serde(default)]
    pub deferred: bool,
}

/// The log's newest HLC stamp, as an ordering key. None on an empty log.
fn max_hlc_key(tx: &Transaction<'_>) -> Result<Option<(i64, i64, String)>, CommandError> {
    tx.query_row(
        "SELECT hlc_wall_ms, hlc_counter, hlc_device FROM domain_events
         ORDER BY hlc_wall_ms DESC, hlc_counter DESC, hlc_device DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

fn hlc_key(ev: &EventRow) -> (i64, i64, String) {
    (ev.hlc.wall_ms, ev.hlc.counter, ev.hlc.device_id.clone())
}

/// Pair every event with its relay seq when the caller has them (a pull page
/// carries a parallel `seqs` array; transports without positions pass none).
fn seq_of(seqs: Option<&[i64]>, index: usize) -> Option<i64> {
    seqs.and_then(|s| s.get(index).copied())
}

pub fn apply_remote_events_inner(
    conn: &mut Connection,
    data_dir: &Path,
    events: &[EventRow],
    seqs: Option<&[i64]>,
) -> Result<MergeReport, CommandError> {
    if let Some(s) = seqs {
        if s.len() != events.len() {
            return Err(CommandError::internal(
                "apply_remote_events: events and seqs differ in length",
            ));
        }
    }
    let tx = conn.transaction()?;
    let horizon = max_hlc_key(&tx)?;

    let mut fresh: Vec<&EventRow> = Vec::new();
    for (index, ev) in events.iter().enumerate() {
        let seq = seq_of(seqs, index);
        if insert_event_row_with_seq(&tx, ev, EventSource::Remote, seq)? {
            // A checkpoint whose frontier is past this stamp was cut without
            // it — it can no longer serve as a replay base.
            checkpoints::invalidate_checkpoints_behind(&tx, data_dir, &hlc_key(ev), seq)?;
            fresh.push(ev);
        }
    }
    let mut report = MergeReport {
        appended: fresh.len(),
        applied: 0,
        replayed: false,
        deferred: false,
    };
    if fresh.is_empty() {
        tx.commit()?;
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
    // title. In that case replay: restore the newest checkpoint that still
    // predates the merged events and apply the tail in HLC order — every
    // device lands on identical projections either way.
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
    } else if replay_projections(&tx, data_dir)?.is_some() {
        report.replayed = true;
    } else {
        // No valid base and the log is incomplete: leave the projections as
        // they are (stale but coherent) and let the backfill finish the job.
        set_projections_stale(&tx, true)?;
        report.deferred = true;
    }
    tx.commit()?;
    Ok(report)
}

// ─── Staged merge (batched backlog replay) ───────────────────────────────────

/// Read the deferred-replay marker (missing sync_profile row = not stale).
fn projections_stale(tx: &Transaction<'_>) -> Result<bool, CommandError> {
    projections_stale_conn(tx)
}

pub fn projections_stale_conn(conn: &Connection) -> Result<bool, CommandError> {
    conn.query_row(
        "SELECT projections_stale FROM sync_profile WHERE id = 1",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        other => Err(other.into()),
    })
}

fn set_projections_stale(tx: &Transaction<'_>, stale: bool) -> Result<(), CommandError> {
    set_projections_stale_conn(tx, stale)
}

pub fn set_projections_stale_conn(conn: &Connection, stale: bool) -> Result<(), CommandError> {
    conn.execute(
        "INSERT INTO sync_profile (id, projections_stale, updated_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(id) DO UPDATE SET
            projections_stale = excluded.projections_stale,
            updated_at = excluded.updated_at",
        params![stale as i64],
    )?;
    Ok(())
}

/// Append pulled events to the log WITHOUT touching the projections, and mark
/// them stale. The batched half of merging a large backlog: when a pull's
/// first page already fell behind the local HLC frontier (see
/// `apply_remote_events_inner`), every following page of that backlog will
/// too, and replaying per 200-event page costs O(pages × log). So the pull
/// loop stages the remaining pages here and replays ONCE via
/// `finalize_staged_events` after the last page.
///
/// Durability: staged events are committed to the log before the cursor
/// advances, and the stale marker survives a crash — recovery (boot and the
/// start of every pull) finalizes whatever a previous session left behind.
pub fn stage_remote_events_inner(
    conn: &mut Connection,
    data_dir: &Path,
    events: &[EventRow],
    seqs: Option<&[i64]>,
) -> Result<usize, CommandError> {
    if let Some(s) = seqs {
        if s.len() != events.len() {
            return Err(CommandError::internal(
                "stage_remote_events: events and seqs differ in length",
            ));
        }
    }
    let tx = conn.transaction()?;
    let mut appended = 0usize;
    for (index, ev) in events.iter().enumerate() {
        let seq = seq_of(seqs, index);
        if insert_event_row_with_seq(&tx, ev, EventSource::Remote, seq)? {
            checkpoints::invalidate_checkpoints_behind(&tx, data_dir, &hlc_key(ev), seq)?;
            appended += 1;
        }
    }
    if appended > 0 {
        set_projections_stale(&tx, true)?;
    }
    tx.commit()?;
    Ok(appended)
}

/// Bring the projections up to date with everything staged: one full replay,
/// then clear the marker — atomically, so a crash mid-replay leaves the marker
/// set and recovery runs it again. A no-op (None) when nothing is staged,
/// which makes it safe to call defensively.
pub fn finalize_staged_events_inner(
    conn: &mut Connection,
    data_dir: &Path,
) -> Result<Option<RebuildReport>, CommandError> {
    let tx = conn.transaction()?;
    if !projections_stale(&tx)? {
        return Ok(None);
    }
    // None here means "no valid base and the log is incomplete": the marker
    // stays set and the backfill's completion finalizes instead.
    let Some(report) = replay_projections(&tx, data_dir)? else {
        return Ok(None);
    };
    set_projections_stale(&tx, false)?;
    tx.commit()?;
    Ok(Some(report))
}

// --- Replay: rebuild + verify (proves the log is authoritative) ---

/// Per-table row counts after a replay, plus how much of the log was consumed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildReport {
    /// Events applied by this replay — the whole log from an empty base, or
    /// only the tail past `checkpoint`.
    pub events_replayed: usize,
    pub events_applied: usize,
    pub rows: std::collections::BTreeMap<String, i64>,
    /// The checkpoint the replay started from (its registry id), if any.
    #[serde(default)]
    pub checkpoint: Option<i64>,
}

/// Walk the log in HLC order from just past `after` (None = from the start),
/// one bounded page at a time, so a replay's memory does not scale with the
/// log. Returns how many events the callback saw.
pub fn for_each_event_after<F>(
    tx: &Transaction<'_>,
    after: Option<&checkpoints::HlcKey>,
    mut f: F,
) -> Result<usize, CommandError>
where
    F: FnMut(&EventRow) -> Result<(), CommandError>,
{
    let page = checkpoints::REPLAY_PAGE;
    let mut cursor: Option<checkpoints::HlcKey> = after.cloned();
    let mut total = 0usize;
    loop {
        let batch: Vec<EventRow> = match &cursor {
            Some((wall, counter, device)) => {
                let mut stmt = tx.prepare_cached(
                    "SELECT * FROM domain_events
                      WHERE (hlc_wall_ms, hlc_counter, hlc_device) > (?1, ?2, ?3)
                      ORDER BY hlc_wall_ms, hlc_counter, hlc_device
                      LIMIT ?4",
                )?;
                let iter =
                    stmt.query_map(params![wall, counter, device, page as i64], row_to_event)?;
                iter.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let mut stmt = tx.prepare_cached(
                    "SELECT * FROM domain_events
                      ORDER BY hlc_wall_ms, hlc_counter, hlc_device
                      LIMIT ?1",
                )?;
                let iter = stmt.query_map(params![page as i64], row_to_event)?;
                iter.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };
        if batch.is_empty() {
            break;
        }
        for ev in &batch {
            f(ev)?;
        }
        total += batch.len();
        let last = batch.last().expect("non-empty batch");
        cursor = Some(hlc_key(last));
        if batch.len() < page {
            break;
        }
    }
    Ok(total)
}

fn derived_row_counts(
    tx: &Transaction<'_>,
) -> Result<std::collections::BTreeMap<String, i64>, CommandError> {
    let mut rows = std::collections::BTreeMap::new();
    for table in apply::DERIVED_TABLES {
        let count: i64 =
            tx.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?;
        rows.insert((*table).to_string(), count);
    }
    Ok(rows)
}

/// Replay the WHOLE log into the derived tables from an empty base, inside
/// `tx`. Every column of every derived table comes back from the log — covers
/// included, since `book.coverExtracted` projects them; the bytes they point
/// at live in the device-local blob registry, which the wipe never touches.
/// This is the ground truth `verify_projections` diffs against; ordinary
/// merges go through `replay_projections`, which starts from a checkpoint.
pub fn replay_into(tx: &Transaction<'_>) -> Result<RebuildReport, CommandError> {
    for table in apply::DERIVED_TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    let mut applied = 0usize;
    let replayed = for_each_event_after(tx, None, |ev| {
        if apply::apply_event(tx, ev)? {
            applied += 1;
        }
        Ok(())
    })?;
    Ok(RebuildReport {
        events_replayed: replayed,
        events_applied: applied,
        rows: derived_row_counts(tx)?,
        checkpoint: None,
    })
}

/// Bring the projections to `f(log)` the cheap way: restore the newest valid
/// checkpoint and apply only the events past its frontier. Invalidation
/// (`checkpoints::invalidate_checkpoints_behind`) runs at every insertion, so
/// whatever checkpoint is newest here is sound by construction. A checkpoint
/// whose file turns out unreadable is dropped and the next older one tried.
///
/// Returns None when NO base is usable and the log is incomplete (a device
/// mid-backfill whose bootstrap checkpoint a straggler just invalidated):
/// replaying a partial log would produce wrong tables, so the caller leaves
/// the projections stale until the backfill completes.
pub fn replay_projections(
    tx: &Transaction<'_>,
    data_dir: &Path,
) -> Result<Option<RebuildReport>, CommandError> {
    while let Some(base) = checkpoints::newest_checkpoint(tx)? {
        match checkpoints::restore_checkpoint(tx, data_dir, &base) {
            Ok(()) => {
                let after = checkpoints::hlc_key_of(&base.hlc);
                let mut applied = 0usize;
                let replayed = for_each_event_after(tx, Some(&after), |ev| {
                    if apply::apply_event(tx, ev)? {
                        applied += 1;
                    }
                    Ok(())
                })?;
                return Ok(Some(RebuildReport {
                    events_replayed: replayed,
                    events_applied: applied,
                    rows: derived_row_counts(tx)?,
                    checkpoint: Some(base.id),
                }));
            }
            Err(error) => {
                log::warn!(
                    "checkpoint {} unusable ({}); dropping it and falling back",
                    base.blob_key,
                    error
                );
                checkpoints::delete_checkpoint(tx, data_dir, base.id, &base.blob_key)?;
            }
        }
    }
    if !checkpoints::log_complete(tx)? {
        return Ok(None);
    }
    Ok(Some(replay_into(tx)?))
}

pub fn rebuild_projections_inner(conn: &mut Connection) -> Result<RebuildReport, CommandError> {
    require_complete_log(conn)?;
    let tx = conn.transaction()?;
    let report = replay_into(&tx)?;
    set_projections_stale(&tx, false)?;
    super::capability_changes::invalidate(&tx)?;
    tx.commit()?;
    Ok(report)
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
pub fn snapshot_table(
    tx: &Transaction<'_>,
    spec: &apply::DiffSpec,
) -> Result<std::collections::BTreeMap<String, i64>, CommandError> {
    let sql = match spec.domain_rows {
        Some(filter) => format!("SELECT * FROM {} WHERE {filter}", spec.table),
        None => format!("SELECT * FROM {}", spec.table),
    };
    let mut stmt = tx.prepare(&sql)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut out = std::collections::BTreeMap::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let mut obj = serde_json::Map::new();
        for (i, name) in columns.iter().enumerate() {
            if spec.local_columns.contains(&name.as_str()) {
                continue;
            }
            obj.insert(name.clone(), value_to_json(row.get_ref(i)?));
        }
        *out.entry(Value::Object(obj).to_string()).or_insert(0) += 1;
    }
    Ok(out)
}

/// Full-log operations (rebuild from empty, verify) are meaningless while the
/// pre-frontier log is still backfilling behind a bootstrap checkpoint.
fn require_complete_log(conn: &Connection) -> Result<(), CommandError> {
    if checkpoints::log_complete(conn)? {
        Ok(())
    } else {
        Err(CommandError::new(
            checkpoints::CODE_SYNC_LOG_INCOMPLETE,
            "the event log is still being backfilled from the relay",
        ))
    }
}

pub fn verify_inner(db: &Db) -> Result<VerifyReport, CommandError> {
    let mut conn = db.0.lock()?;
    require_complete_log(&conn)?;
    let tx = conn.transaction()?;

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
    tx.rollback()?;

    Ok(VerifyReport {
        consistent: drift.is_empty(),
        events_replayed: report.events_replayed,
        drift,
    })
}
