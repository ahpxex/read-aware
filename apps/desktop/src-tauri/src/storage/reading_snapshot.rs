use super::{events::projections_stale_conn, Db};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingTimeCursor {
    pub book_id: String,
    pub local_day: String,
    pub local_hour: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingTimeQuery {
    pub book_id: Option<String>,
    pub local_day: Option<String>,
    pub after: Option<ReadingTimeCursor>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingReadingTime {
    #[serde(flatten)]
    pub cursor: ReadingTimeCursor,
    pub ms: i64,
    pub started_at: i64,
    pub last_at: i64,
    pub position_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeSnapshot {
    pub book_id: Option<String>,
    pub local_day: Option<String>,
    pub observed_at_epoch_ms: i64,
    pub settled_ms: i64,
    pub pending_ms: i64,
    pub total_ms: i64,
    pub pending_bucket_count: i64,
    pub pending: Vec<PendingReadingTime>,
    pub next_cursor: Option<ReadingTimeCursor>,
}

fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.encode_utf16().count() <= 256
}
fn valid_day(conn: &Connection, day: &str) -> Result<bool, CommandError> {
    if day.len() != 10 {
        return Ok(false);
    }
    Ok(conn.query_row(
        "SELECT COALESCE(date(?1, '+0 days') = ?1, 0)",
        [day],
        |row| row.get(0),
    )?)
}

pub(crate) fn reading_time_snapshot_inner(
    conn: &mut Connection,
    query: ReadingTimeQuery,
) -> Result<ReadingTimeSnapshot, CommandError> {
    let limit = query.limit.unwrap_or(50);
    let day_valid = match &query.local_day {
        Some(day) => valid_day(conn, day)?,
        None => true,
    };
    let cursor_day_valid = match &query.after {
        Some(cursor) => valid_day(conn, &cursor.local_day)?,
        None => true,
    };
    if !(1..=100).contains(&limit)
        || query.book_id.as_deref().is_some_and(|id| !valid_id(id))
        || !day_valid
        || !cursor_day_valid
        || query.after.as_ref().is_some_and(|c| {
            !valid_id(&c.book_id)
                || !(0..=23).contains(&c.local_hour)
                || query.book_id.as_ref().is_some_and(|id| id != &c.book_id)
                || query
                    .local_day
                    .as_ref()
                    .is_some_and(|day| day != &c.local_day)
        })
    {
        return Err(CommandError::new(
            "reading/invalid-time-query",
            "Invalid reading time scope or cursor",
        ));
    }
    // The read transaction prevents a concurrent flush from appearing in both
    // settled totals and pending buckets (including other SQLite connections).
    let tx = conn.transaction()?;
    if projections_stale_conn(&tx)? {
        return Err(CommandError::new(
            "reading/stats-stale",
            "Wait for reading projection recovery",
        ));
    }
    if let Some(id) = &query.book_id {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(CommandError::new(
                "library/book-not-found",
                "Unknown reading time book",
            ));
        }
    }
    let observed_at_epoch_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| CommandError::new("reading/stats-unavailable", error.to_string()))?
        .as_millis() as i64;
    let settled_ms: i64 = if let Some(day) = &query.local_day {
        tx.query_row("SELECT COALESCE(SUM(ms),0) FROM reading_time_daily WHERE (?1 IS NULL OR book_id=?1) AND local_day=?2",
            params![query.book_id, day], |r| r.get(0))?
    } else {
        tx.query_row("SELECT COALESCE(SUM(total_ms),0) FROM reading_time_totals WHERE (?1 IS NULL OR book_id=?1)",
            [&query.book_id], |r| r.get(0))?
    };
    let (pending_ms, pending_bucket_count): (i64, i64) = tx.query_row(
        "SELECT COALESCE(SUM(ms),0), COUNT(*) FROM reading_sessions_pending WHERE (?1 IS NULL OR book_id=?1) AND (?2 IS NULL OR local_day=?2)",
        params![query.book_id, query.local_day], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut pending = {
        let mut stmt = tx.prepare("SELECT book_id, local_day, local_hour, ms, started_at, last_at, position_at
            FROM reading_sessions_pending WHERE (?1 IS NULL OR book_id=?1) AND (?2 IS NULL OR local_day=?2)
            AND (?3 IS NULL OR (book_id,local_day,local_hour) > (?3,?4,?5))
            ORDER BY book_id,local_day,local_hour LIMIT ?6")?;
        let rows = stmt
            .query_map(
                params![
                    query.book_id,
                    query.local_day,
                    query.after.as_ref().map(|c| &c.book_id),
                    query.after.as_ref().map(|c| &c.local_day),
                    query.after.as_ref().map(|c| c.local_hour),
                    limit + 1
                ],
                |row| {
                    Ok(PendingReadingTime {
                        cursor: ReadingTimeCursor {
                            book_id: row.get(0)?,
                            local_day: row.get(1)?,
                            local_hour: row.get(2)?,
                        },
                        ms: row.get(3)?,
                        started_at: row.get(4)?,
                        last_at: row.get(5)?,
                        position_at: row.get(6)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let next_cursor = if pending.len() > limit as usize {
        pending.truncate(limit as usize);
        pending.last().map(|item| item.cursor.clone())
    } else {
        None
    };
    let total_ms = settled_ms
        .checked_add(pending_ms)
        .ok_or_else(|| CommandError::new("reading/stats-invalid", "Reading duration overflow"))?;
    if settled_ms < 0 || pending_ms < 0 || total_ms > 9_007_199_254_740_991 {
        return Err(CommandError::new(
            "reading/stats-invalid",
            "Reading duration is outside the exact JSON integer range",
        ));
    }
    tx.commit()?;
    Ok(ReadingTimeSnapshot {
        book_id: query.book_id,
        local_day: query.local_day,
        observed_at_epoch_ms,
        settled_ms,
        pending_ms,
        total_ms,
        pending_bucket_count,
        pending,
        next_cursor,
    })
}

#[tauri::command]
pub fn reading_time_snapshot(
    query: ReadingTimeQuery,
    db: tauri::State<'_, Db>,
) -> Result<ReadingTimeSnapshot, CommandError> {
    let mut conn = db.0.lock()?;
    reading_time_snapshot_inner(&mut conn, query)
}
