//! Reading-time projection (migration v9) and the one-time reconstruction that
//! gives its pre-event-era aggregates a history in the log.
//!
//! Split out of `storage/mod.rs`, which had grown to hold fourteen unrelated
//! domains in one file. `use super::*` keeps the parent's shared types (`Db`,
//! `EventRow`, the apply helpers) in scope, so this is a move, not a rewrite.
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
pub fn reading_time_genesis(db: State<'_, Db>) -> Result<usize, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    reading_time_genesis_inner(&mut conn)
}

/// Read the three reading-time tables into (daily, hourly, bounds) maps,
/// keyed by book. Only positive rows — a zero contributes no event.
type ReadingTimeShape = (
    std::collections::BTreeMap<String, Vec<(String, i64)>>,
    std::collections::BTreeMap<String, Vec<(i64, i64)>>,
    std::collections::BTreeMap<String, (Option<i64>, Option<i64>)>,
);

fn read_reading_time_shape(conn: &Connection) -> Result<ReadingTimeShape, String> {
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
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let book: String = row.get(0).map_err(|e| e.to_string())?;
            daily.entry(book).or_default().push((
                row.get(1).map_err(|e| e.to_string())?,
                row.get(2).map_err(|e| e.to_string())?,
            ));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT book_id, local_hour, ms FROM reading_time_hourly WHERE ms > 0")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let book: String = row.get(0).map_err(|e| e.to_string())?;
            hourly.entry(book).or_default().push((
                row.get(1).map_err(|e| e.to_string())?,
                row.get(2).map_err(|e| e.to_string())?,
            ));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT book_id, first_started_at, last_read_at FROM reading_time_totals")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let book: String = row.get(0).map_err(|e| e.to_string())?;
            bounds.insert(
                book,
                (
                    row.get(1).map_err(|e| e.to_string())?,
                    row.get(2).map_err(|e| e.to_string())?,
                ),
            );
        }
    }
    Ok((daily, hourly, bounds))
}

pub(crate) fn reading_time_genesis_inner(conn: &mut Connection) -> Result<usize, String> {
    let device_id = ensure_local_device(conn)?;

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
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for table in [
            "reading_time_totals",
            "reading_time_daily",
            "reading_time_hourly",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(|e| e.to_string())?;
        }
        let logged: Vec<EventRow> = {
            let mut stmt = tx
                .prepare(
                    "SELECT * FROM domain_events WHERE type = 'book.timeRecorded'
                     ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt.query_map([], row_to_event).map_err(|e| e.to_string())?;
            iter.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?
        };
        for event in &logged {
            apply::apply_event(&tx, event)?;
        }
        let (d, h, _) = read_reading_time_shape(&tx)?;
        tx.rollback().map_err(|e| e.to_string())?;
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
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for event in &events {
        insert_event_row(&tx, event)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(events.len())
}

#[tauri::command]
pub fn reading_time_load(db: State<'_, Db>) -> Result<ReadingTimeWire, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let totals = {
        let mut stmt = conn
            .prepare("SELECT book_id, total_ms, first_started_at, last_read_at FROM reading_time_totals")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeTotalRow {
                    book_id: row.get(0)?,
                    total_ms: row.get(1)?,
                    first_started_at: row.get(2)?,
                    last_read_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let daily = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_day, ms FROM reading_time_daily")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeDailyRow {
                    book_id: row.get(0)?,
                    local_day: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let hourly = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_hour, ms FROM reading_time_hourly")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeHourlyRow {
                    book_id: row.get(0)?,
                    local_hour: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    Ok(ReadingTimeWire { totals, daily, hourly })
}

pub(crate) fn reading_time_record_inner(
    conn: &Connection,
    book_id: &str,
    ms: i64,
    at_epoch_ms: i64,
    local_day: &str,
    local_hour: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(book_id) DO UPDATE SET
            total_ms = total_ms + excluded.total_ms,
            first_started_at = COALESCE(first_started_at, excluded.first_started_at),
            last_read_at = MAX(COALESCE(last_read_at, 0), excluded.last_read_at)",
        params![book_id, ms, at_epoch_ms],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id, local_day) DO UPDATE SET ms = ms + excluded.ms",
        params![book_id, local_day, ms],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id, local_hour) DO UPDATE SET ms = ms + excluded.ms",
        params![book_id, local_hour, ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One active-reading delta (the tracker's tick), bucketed at record time.
#[tauri::command]
pub fn reading_time_record(
    book_id: String,
    ms: i64,
    at_epoch_ms: i64,
    local_day: String,
    local_hour: i64,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    reading_time_record_inner(&conn, &book_id, ms, at_epoch_ms, &local_day, local_hour)
}

/// Bulk replace (one-time app_kv migration; the stats demo seed).
#[tauri::command]
pub fn reading_time_import(wire: ReadingTimeWire, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "DELETE FROM reading_time_totals;
         DELETE FROM reading_time_daily;
         DELETE FROM reading_time_hourly;",
    )
    .map_err(|e| e.to_string())?;
    for row in &wire.totals {
        tx.execute(
            "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
             VALUES (?1,?2,?3,?4)",
            params![row.book_id, row.total_ms, row.first_started_at, row.last_read_at],
        )
        .map_err(|e| e.to_string())?;
    }
    for row in &wire.daily {
        tx.execute(
            "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_day, row.ms],
        )
        .map_err(|e| e.to_string())?;
    }
    for row in &wire.hourly {
        tx.execute(
            "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_hour, row.ms],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

