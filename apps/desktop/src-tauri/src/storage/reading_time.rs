//! Reading-time projection (migration v9) and the one-time reconstruction that
//! gives its pre-event-era aggregates a history in the log.
//!
//! Split out of `storage/mod.rs`, which had grown to hold fourteen unrelated
//! domains in one file. `use super::*` keeps the parent's shared types (`Db`,
//! `EventRow`, the apply helpers) in scope, so this is a move, not a rewrite.
use crate::error::CommandError;
use super::*;

// --- Reading-time projection (migration v9) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeTotalRow {
    pub book_id: String,
    pub total_ms: i64,
    #[serde(default)]
    pub first_started_at: Option<i64>,
    #[serde(default)]
    pub last_read_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeDailyRow {
    pub book_id: String,
    pub local_day: String,
    pub ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeHourlyRow {
    pub book_id: String,
    pub local_hour: i64,
    pub ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeWire {
    pub totals: Vec<ReadingTimeTotalRow>,
    pub daily: Vec<ReadingTimeDailyRow>,
    pub hourly: Vec<ReadingTimeHourlyRow>,
}

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
pub async fn reading_time_genesis(
    app: tauri::AppHandle,
) -> Result<usize, CommandError> {
    crate::storage::blocking("reading_time_genesis", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        reading_time_genesis_inner(&mut conn)
    })
    .await
}

/// Read the three reading-time tables into (daily, hourly, bounds) maps,
/// keyed by book. Only positive rows — a zero contributes no event.
type ReadingTimeShape = (
    std::collections::BTreeMap<String, Vec<(String, i64)>>,
    std::collections::BTreeMap<String, Vec<(i64, i64)>>,
    std::collections::BTreeMap<String, (Option<i64>, Option<i64>)>,
);

fn read_reading_time_shape(conn: &Connection) -> Result<ReadingTimeShape, CommandError> {
    let mut daily: std::collections::BTreeMap<String, Vec<(String, i64)>> = Default::default();
    let mut hourly: std::collections::BTreeMap<String, Vec<(i64, i64)>> = Default::default();
    let mut bounds: std::collections::BTreeMap<String, (Option<i64>, Option<i64>)> =
        Default::default();
    {
        let mut stmt = conn
            .prepare(
                "SELECT book_id, local_day, ms FROM reading_time_daily
                 WHERE ms > 0 ORDER BY local_day",
            )
            ?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let book: String = row.get(0)?;
            daily.entry(book).or_default().push((
                row.get(1)?,
                row.get(2)?,
            ));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT book_id, local_hour, ms FROM reading_time_hourly WHERE ms > 0")
            ?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let book: String = row.get(0)?;
            hourly.entry(book).or_default().push((
                row.get(1)?,
                row.get(2)?,
            ));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT book_id, first_started_at, last_read_at FROM reading_time_totals")
            ?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let book: String = row.get(0)?;
            bounds.insert(
                book,
                (
                    row.get(1)?,
                    row.get(2)?,
                ),
            );
        }
    }
    Ok((daily, hourly, bounds))
}

pub(crate) fn reading_time_genesis_inner(conn: &mut Connection) -> Result<usize, CommandError> {
    let device_id = ensure_local_device(conn)?;

    // Once per device: the pass below replays every time-bearing event to
    // measure what the log already covers — O(log) work that must not run at
    // every boot on a large log. The tables can only drift from the log
    // through `reading_time_import`, which clears this stamp.
    let already: Option<String> = conn
        .query_row(
            "SELECT reading_time_genesis_at FROM local_device WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(CommandError::from(other)),
        })?;
    if already.is_some() {
        return Ok(0);
    }
    let synthesized = reading_time_genesis_pass(conn, &device_id)?;
    conn.execute(
        "UPDATE local_device SET reading_time_genesis_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = 1",
        [],
    )?;
    Ok(synthesized)
}

fn reading_time_genesis_pass(conn: &mut Connection, device_id: &str) -> Result<usize, CommandError> {
    let device_id = device_id.to_string();
    // What the tables hold today — the truth to preserve.
    let (target_daily, target_hourly, bounds) = read_reading_time_shape(conn)?;
    if target_daily.is_empty() {
        return Ok(0);
    }

    // What the log ALREADY accounts for. Some timeRecorded events did make it
    // through the old best-effort path, and synthesizing on top of them would
    // double-count exactly those. Measured by replaying them into wiped tables
    // inside a transaction that is then rolled back, so nothing is disturbed.
    let (covered_daily, covered_hourly) = {
        let tx = conn.transaction()?;
        for table in [
            "reading_time_totals",
            "reading_time_daily",
            "reading_time_hourly",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                ?;
        }
        let logged: Vec<EventRow> = {
            let mut stmt = tx
                .prepare(
                    "SELECT * FROM domain_events
                      WHERE type IN ('book.timeRecorded', 'book.sessionRecorded')
                      ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                ?;
            let iter = stmt.query_map([], row_to_event)?;
            iter.collect::<rusqlite::Result<Vec<_>>>()
                ?
        };
        for event in &logged {
            apply::apply_event(&tx, event)?;
        }
        let (d, h, _) = read_reading_time_shape(&tx)?;
        tx.rollback()?;
        (d, h)
    };

    // Synthesize only the DIFFERENCE, so log + existing events == the tables.
    let sub = |target: &Vec<(String, i64)>, covered: Option<&Vec<(String, i64)>>| {
        let mut out = Vec::new();
        for (key, ms) in target {
            let seen = covered
                .and_then(|list| list.iter().find(|(k, _)| k == key))
                .map(|(_, ms)| *ms)
                .unwrap_or(0);
            let deficit = ms - seen;
            if deficit > 0 {
                out.push((key.clone(), deficit));
            }
        }
        out
    };
    let sub_hours = |target: &Vec<(i64, i64)>, covered: Option<&Vec<(i64, i64)>>| {
        let mut out = Vec::new();
        for (key, ms) in target {
            let seen = covered
                .and_then(|list| list.iter().find(|(k, _)| k == key))
                .map(|(_, ms)| *ms)
                .unwrap_or(0);
            let deficit = ms - seen;
            if deficit > 0 {
                out.push((*key, deficit));
            }
        }
        out
    };

    let mut daily: std::collections::BTreeMap<String, Vec<(String, i64)>> = Default::default();
    let mut hourly: std::collections::BTreeMap<String, Vec<(i64, i64)>> = Default::default();
    for (book, days) in &target_daily {
        let deficit = sub(days, covered_daily.get(book));
        if !deficit.is_empty() {
            daily.insert(book.clone(), deficit);
        }
    }
    for (book, hours) in &target_hourly {
        let deficit = sub_hours(hours, covered_hourly.get(book));
        if !deficit.is_empty() {
            hourly.insert(book.clone(), deficit);
        }
    }
    if daily.is_empty() {
        return Ok(0);
    }

    let mut events: Vec<EventRow> = Vec::new();
    let mut wall = 0_i64;
    for (book_id, days) in &daily {
        let hours = match hourly.get(book_id) {
            Some(list) if !list.is_empty() => list.clone(),
            // No hourly detail for this book: put the whole day in one bucket
            // that the hourly table already agrees is empty.
            _ => vec![(0, days.iter().map(|(_, ms)| *ms).sum())],
        };
        let hour_total: i64 = hours.iter().map(|(_, ms)| *ms).sum();
        if hour_total <= 0 {
            continue;
        }

        // Build the (day × hour) grid so BOTH margins come back exact. Flooring
        // the proportional split alone loses milliseconds to rounding, and
        // handing every day's remainder to the same bucket skews the hourly
        // shape a little further with each day. So: floor first, then hand out
        // what is left by walking the row/column deficits — the standard
        // feasible-solution construction for a transport problem, which lands
        // on a grid whose rows sum to the daily totals and whose columns sum to
        // the hourly ones.
        let day_total: i64 = days.iter().map(|(_, ms)| *ms).sum();
        // The two aggregates can disagree slightly (they were written by
        // independent best-effort paths). Days are the finer record and feed
        // the streak/calendar surfaces, so they win; hours are scaled to fit.
        let scaled_hours: Vec<(i64, i64)> = hours
            .iter()
            .map(|(hour, ms)| {
                (
                    *hour,
                    ((*ms as i128) * (day_total as i128) / (hour_total as i128)) as i64,
                )
            })
            .collect();

        let mut row_left: Vec<i64> = days.iter().map(|(_, ms)| *ms).collect();
        let mut col_left: Vec<i64> = scaled_hours.iter().map(|(_, ms)| *ms).collect();
        let mut grid = vec![vec![0_i64; scaled_hours.len()]; days.len()];
        for (r, (_, day_ms)) in days.iter().enumerate() {
            for (c, (_, hour_ms)) in scaled_hours.iter().enumerate() {
                let share = ((*day_ms as i128) * (*hour_ms as i128) / (day_total.max(1) as i128))
                    as i64;
                grid[r][c] = share;
                row_left[r] -= share;
                col_left[c] -= share;
            }
        }
        // Distribute the flooring leftovers against both deficits at once.
        for r in 0..grid.len() {
            for c in 0..grid[r].len() {
                if row_left[r] == 0 {
                    break;
                }
                let take = row_left[r].min(col_left[c]);
                if take > 0 {
                    grid[r][c] += take;
                    row_left[r] -= take;
                    col_left[c] -= take;
                }
            }
        }
        // Any residue left over (only possible when the margins disagreed after
        // scaling) goes to the day that is still short, in its largest hour.
        for (r, remaining) in row_left.iter().enumerate() {
            if *remaining > 0 {
                let largest = scaled_hours
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, (_, ms))| *ms)
                    .map(|(c, _)| c)
                    .unwrap_or(0);
                grid[r][largest] += remaining;
            }
        }

        let mut cells: Vec<(String, i64, i64)> = Vec::new(); // (day, hour, ms)
        for (r, (day, _)) in days.iter().enumerate() {
            for (c, (hour, _)) in scaled_hours.iter().enumerate() {
                if grid[r][c] > 0 {
                    cells.push((day.clone(), *hour, grid[r][c]));
                }
            }
        }

        // `atEpochMs` only feeds first_started_at / last_read_at, so pin the
        // ends to the recorded bounds and interpolate the middle.
        let (first, last) = bounds.get(book_id).copied().unwrap_or((None, None));
        let count = cells.len();
        for (index, (day, hour, ms)) in cells.into_iter().enumerate() {
            let at_epoch = if index == 0 {
                first.unwrap_or(0)
            } else if index + 1 == count {
                last.or(first).unwrap_or(0)
            } else {
                // Midpoint of the recorded span; ordering within it is lost
                // anyway, and only MIN/MAX are read back.
                match (first, last) {
                    (Some(a), Some(b)) => a + (b - a) / 2,
                    (Some(a), None) => a,
                    _ => 0,
                }
            };
            wall += 1;
            events.push(EventRow {
                id: uuid::Uuid::new_v4().to_string(),
                event_type: "book.timeRecorded".to_string(),
                hlc: Hlc {
                    wall_ms: at_epoch.max(1),
                    counter: wall,
                    device_id: device_id.clone(),
                },
                schema_version: None,
                aggregate_type: Some("book".to_string()),
                aggregate_id: Some(book_id.clone()),
                actor_id: None,
                origin: Some("system".to_string()),
                created_at: Some(apply::iso_from_millis(at_epoch.max(1))),
                payload: serde_json::json!({
                    "bookId": book_id,
                    "ms": ms,
                    "atEpochMs": at_epoch,
                    "localDay": day,
                    "localHour": hour,
                }),
            });
        }
    }

    if events.is_empty() {
        return Ok(0);
    }

    // Append only — do NOT apply. The tables already hold the target values;
    // these events exist so a future replay can arrive at the same place.
    // Applying them here would add the deficit on top of the sums it was
    // computed from.
    let tx = conn.transaction()?;
    for event in &events {
        insert_event_row(&tx, event, EventSource::Local)?;
    }
    tx.commit()?;
    Ok(events.len())
}

#[tauri::command]
pub async fn reading_time_load(
    app: tauri::AppHandle,
) -> Result<ReadingTimeWire, CommandError> {
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

pub(crate) fn reading_time_scope_inner(conn: &mut Connection, book_id: Option<String>) -> Result<ReadingTimeWire, CommandError> {
    if book_id.as_deref().is_some_and(|id| id.trim().is_empty() || id.encode_utf16().count() > 256) {
        return Err(CommandError::new("reading/invalid-time-query", "Invalid reading history book"));
    }
    let tx = conn.transaction()?;
    if super::events::projections_stale_conn(&tx)? {
        return Err(CommandError::new("reading/stats-stale", "Reading history is recovering"));
    }
    if let Some(id) = &book_id {
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)", [id], |row| row.get(0))?;
        if !exists { return Err(CommandError::new("library/book-not-found", "Unknown reading history book")); }
    }
    let wire = reading_time_load_conn(&tx, book_id.as_deref())?;
    tx.commit()?;
    Ok(wire)
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

fn reading_time_load_conn(conn: &Connection, book_id: Option<&str>) -> Result<ReadingTimeWire, CommandError> {
    let totals = {
        let mut stmt = conn
            .prepare("SELECT book_id, total_ms, first_started_at, last_read_at FROM reading_time_totals WHERE (?1 IS NULL OR book_id=?1) ORDER BY book_id")
            ?;
        let rows = stmt
            .query_map([book_id], |row| {
                Ok(ReadingTimeTotalRow {
                    book_id: row.get(0)?,
                    total_ms: row.get(1)?,
                    first_started_at: row.get(2)?,
                    last_read_at: row.get(3)?,
                })
            })
            ?
            .collect::<Result<Vec<_>, _>>()
            ?;
        rows
    };
    let daily = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_day, ms FROM reading_time_daily WHERE (?1 IS NULL OR book_id=?1) ORDER BY book_id,local_day")
            ?;
        let rows = stmt
            .query_map([book_id], |row| {
                Ok(ReadingTimeDailyRow {
                    book_id: row.get(0)?,
                    local_day: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            ?
            .collect::<Result<Vec<_>, _>>()
            ?;
        rows
    };
    let hourly = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_hour, ms FROM reading_time_hourly WHERE (?1 IS NULL OR book_id=?1) ORDER BY book_id,local_hour")
            ?;
        let rows = stmt
            .query_map([book_id], |row| {
                Ok(ReadingTimeHourlyRow {
                    book_id: row.get(0)?,
                    local_hour: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            ?
            .collect::<Result<Vec<_>, _>>()
            ?;
        rows
    };
    Ok(ReadingTimeWire { totals, daily, hourly })
}

// ── Reading sessions: the tracker's crash-safe scratch pad ───────────────────
//
// Reading is modelled as sessions, not as ticks and page turns. A tick ACCRUES
// time into a (book, local day, local hour) bucket here and every page turn
// OVERWRITES the bucket's position; the single `book.sessionRecorded` event
// for the bucket — time read plus position reached — is minted only when the
// bucket CLOSES (hour rolls over, the book or the app closes, reading pauses),
// and the flush retires the bucket in the same transaction as the commit.
// A crash loses nothing: the next boot closes whatever is still open.
// [device-local] — never synced, never derived, never in a checkpoint.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSessionBucket {
    pub book_id: String,
    pub local_day: String,
    pub local_hour: i64,
    /// Active reading milliseconds accrued so far.
    pub ms: i64,
    /// Epoch ms of the first and latest tick/page turn in the bucket.
    pub started_at: i64,
    pub last_at: i64,
    /// The latest position seen (the `book.progressed`-shaped payload the
    /// reader reports), or null when only time accrued.
    pub progress: Value,
    /// When that position was observed — moves with page turns only, never
    /// with ticks. The clock last-observed-wins compares.
    pub position_at: Option<i64>,
}

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<ReadingSessionBucket> {
    let progress: Option<String> = row.get(6)?;
    Ok(ReadingSessionBucket {
        book_id: row.get(0)?,
        local_day: row.get(1)?,
        local_hour: row.get(2)?,
        ms: row.get(3)?,
        started_at: row.get(4)?,
        last_at: row.get(5)?,
        progress: progress
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or(Value::Null),
        position_at: row.get(7)?,
    })
}

const SESSION_COLUMNS: &str =
    "book_id, local_day, local_hour, ms, started_at, last_at, progress_json, position_at";

fn read_session(
    conn: &Connection,
    book_id: &str,
    local_day: &str,
    local_hour: i64,
) -> Result<ReadingSessionBucket, CommandError> {
    conn.query_row(
        &format!(
            "SELECT {SESSION_COLUMNS} FROM reading_sessions_pending
              WHERE book_id = ?1 AND local_day = ?2 AND local_hour = ?3"
        ),
        params![book_id, local_day, local_hour],
        row_to_session,
    )
    .map_err(CommandError::from)
}

pub(crate) fn reading_session_accrue_inner(
    conn: &Connection,
    book_id: &str,
    local_day: &str,
    local_hour: i64,
    delta_ms: i64,
    at_epoch_ms: i64,
) -> Result<ReadingSessionBucket, CommandError> {
    if delta_ms <= 0 {
        return Err(CommandError::internal("reading_session_accrue: delta must be positive"));
    }
    conn.execute(
        "INSERT INTO reading_sessions_pending
            (book_id, local_day, local_hour, ms, started_at, last_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(book_id, local_day, local_hour) DO UPDATE SET
            ms = ms + excluded.ms,
            last_at = MAX(last_at, excluded.last_at)",
        params![book_id, local_day, local_hour, delta_ms, at_epoch_ms],
    )?;
    read_session(conn, book_id, local_day, local_hour)
}

/// A page turn: overwrite the bucket's position (creating the bucket with no
/// time yet if the first tick has not fired). `at_epoch_ms` is when the
/// position was observed — it becomes the session's `endedAt`, the clock the
/// projection's last-observed-wins rule compares.
pub(crate) fn reading_session_position_inner(
    conn: &Connection,
    book_id: &str,
    local_day: &str,
    local_hour: i64,
    at_epoch_ms: i64,
    progress: &Value,
) -> Result<ReadingSessionBucket, CommandError> {
    if !progress.is_object() {
        return Err(CommandError::internal("reading_session_position: progress must be an object"));
    }
    conn.execute(
        "INSERT INTO reading_sessions_pending
            (book_id, local_day, local_hour, ms, started_at, last_at, progress_json, position_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5, ?4)
         ON CONFLICT(book_id, local_day, local_hour) DO UPDATE SET
            last_at = MAX(last_at, excluded.last_at),
            progress_json = CASE WHEN position_at IS NULL OR excluded.position_at >= position_at
                                 THEN excluded.progress_json ELSE progress_json END,
            position_at = MAX(COALESCE(position_at, 0), excluded.position_at)",
        params![book_id, local_day, local_hour, at_epoch_ms, progress.to_string()],
    )?;
    read_session(conn, book_id, local_day, local_hour)
}

pub(crate) fn reading_sessions_pending_inner(conn: &Connection) -> Result<Vec<ReadingSessionBucket>, CommandError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS} FROM reading_sessions_pending ORDER BY started_at"
    ))?;
    let rows = stmt
        .query_map([], row_to_session)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Close buckets: commit the caller-minted `book.sessionRecorded` events
/// through the ordinary write path and retire what they carry, in ONE
/// transaction. Each event's payload names its bucket (`bookId`, `localDay`,
/// `localHour`) and what it took from it (`ms`, `endedAt`): time accrued
/// since the caller read the bucket stays, and a position observed after
/// `endedAt` keeps the bucket open — a tick or page turn racing a flush is
/// never lost or double-counted. Returns the commit report.
pub(crate) fn reading_session_flush_inner(
    conn: &mut Connection,
    events_in: &[EventRow],
) -> Result<CommitReport, CommandError> {
    let tx = conn.transaction()?;
    let mut report = CommitReport {
        appended: 0,
        applied: 0,
    };
    for ev in events_in {
        if ev.event_type != "book.sessionRecorded" {
            return Err(CommandError::internal(format!(
                "reading_session_flush: refusing to flush a `{}` event",
                ev.event_type
            )));
        }
        let book_id = ev.payload.get("bookId").and_then(|v| v.as_str()).ok_or_else(|| {
            CommandError::internal("reading_session_flush: payload lacks bookId")
        })?;
        let local_day = ev.payload.get("localDay").and_then(|v| v.as_str()).ok_or_else(|| {
            CommandError::internal("reading_session_flush: payload lacks localDay")
        })?;
        let local_hour = ev.payload.get("localHour").and_then(|v| v.as_i64()).ok_or_else(|| {
            CommandError::internal("reading_session_flush: payload lacks localHour")
        })?;
        let ms = ev.payload.get("ms").and_then(|v| v.as_i64()).unwrap_or(0);
        let ended_at = ev.payload.get("endedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let has_position = ev.payload.get("progress").is_some_and(|v| v.is_object());
        let observed_at = ev
            .payload
            .get("progress")
            .and_then(|p| p.get("observedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(ended_at);
        if ms <= 0 && !has_position {
            continue;
        }
        if !events::insert_event_row(&tx, ev, events::EventSource::Local)? {
            // Redelivery of an already-logged flush: the bucket was retired
            // with it the first time.
            continue;
        }
        report.appended += 1;
        if apply::apply_event(&tx, ev)? {
            report.applied += 1;
        }
        tx.execute(
            "UPDATE reading_sessions_pending SET ms = MAX(0, ms - ?4)
              WHERE book_id = ?1 AND local_day = ?2 AND local_hour = ?3",
            params![book_id, local_day, local_hour, ms],
        )?;
        // Retired when nothing newer than the event remains: no unflushed
        // time, nothing after the event's `endedAt`, and no position observed
        // after the one the event carries.
        tx.execute(
            "DELETE FROM reading_sessions_pending
              WHERE book_id = ?1 AND local_day = ?2 AND local_hour = ?3
                AND ms <= 0 AND last_at <= ?4
                AND (position_at IS NULL OR position_at <= ?5)",
            params![book_id, local_day, local_hour, ended_at, observed_at],
        )?;
    }
    tx.commit()?;
    Ok(report)
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
        reading_session_accrue_inner(&conn, &book_id, &local_day, local_hour, delta_ms, at_epoch_ms)
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
        reading_session_position_inner(&conn, &book_id, &local_day, local_hour, at_epoch_ms, &progress)
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

/// Bulk replace (one-time app_kv migration; the stats demo seed).
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

pub(crate) fn reading_time_import_inner(conn: &mut Connection, wire: &ReadingTimeWire) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "DELETE FROM reading_time_totals;
         DELETE FROM reading_time_daily;
         DELETE FROM reading_time_hourly;",
    )
    ?;
    for row in &wire.totals {
        tx.execute(
            "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
             VALUES (?1,?2,?3,?4)",
            params![row.book_id, row.total_ms, row.first_started_at, row.last_read_at],
        )
        ?;
    }
    for row in &wire.daily {
        tx.execute(
            "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_day, row.ms],
        )
        ?;
    }
    for row in &wire.hourly {
        tx.execute(
            "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_hour, row.ms],
        )
        ?;
    }
    // The tables no longer equal the log's replay: let the genesis pass
    // re-measure at next boot.
    tx.execute("UPDATE local_device SET reading_time_genesis_at = NULL WHERE id = 1", [])?;
    tx.commit()?;
    Ok(())
}
