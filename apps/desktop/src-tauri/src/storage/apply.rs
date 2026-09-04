//! Event → projection application: the "apply" half of event sourcing.
//!
//! Until this module existed the projections (books/collections/annotations/…)
//! were written DIRECTLY by the frontend and the event log was a best-effort
//! side-car appended next to them. That made the log unreplayable: nothing
//! could turn `domain_events` back into the tables the app reads, so the log
//! could drift from the projections with no way to detect or repair it.
//!
//! `apply_event` is now the ONLY thing that writes a projection row. Two
//! callers share it, which is what makes the log authoritative:
//!
//!   - `commit_events` — the live write path. Append + apply run in ONE
//!     transaction, so an event and the row it implies land together or not
//!     at all.
//!   - `rebuild_projections` — wipes the derived tables and replays the whole
//!     log through the same function. Also backs `verify_projections`, which
//!     replays into scratch tables and diffs against the live ones.
//!
//! Rules every arm here follows:
//!   - **Idempotent.** Upsert or delete; never blind INSERT, never read-modify-
//!     write in Rust. Replaying the same event twice must be a no-op. The one
//!     accumulating projection (reading_time) is protected upstream instead:
//!     `commit_events` only applies events the log actually accepted as new.
//!   - **Order-tolerant.** A mutation for a row that does not exist is a silent
//!     no-op (`UPDATE … WHERE id = ?`), not an error — a book with no
//!     `book.imported` should not exist, and rebuild must reach that same state.
//!   - **Forward-compatible.** An unknown event type is ignored, so a log
//!     written by a newer build still replays on an older one.
//!
//! Two axes stay separate, and this module only owns one of them:
//!   - **Domain facts** (title, author, progress, highlights, memories) are
//!     event-sourced. That is everything below.
//!   - **Book content** — the original file and anything extracted from it
//!     (covers) — travels as a blob through object storage, never through the
//!     log. `book.coverExtracted` records the VERDICT of an extraction — a
//!     `cover:` blob exists (`ready`), or the book has none (`none`) — and
//!     projects it to `books.cover_status` / `cover_blob_key`, so every device
//!     knows whether artwork exists before any bytes arrive and never probes
//!     for a cover the importing device already ruled out. The bytes stay in
//!     the device-local blob registry (`blob_objects`), outside rebuild's wipe.
//!
//! `profile.updated` / `entity.*` likewise apply to nothing: they are accepted
//! into the log, but the consolidation pipeline that would own their projection
//! is not built yet.

use crate::error::CommandError;
use rusqlite::{params, Transaction};
use serde_json::Value;

use super::EventRow;

// ─── Time helpers ────────────────────────────────────────────────────────────

/// ISO-8601 UTC with millisecond precision — byte-identical to the format
/// SQLite's `strftime('%Y-%m-%dT%H:%M:%fZ', …)` produces, which is what the
/// projection columns already hold.
pub fn iso_from_millis(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let mut rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let hour = rem / 3_600_000;
    rem %= 3_600_000;
    let min = rem / 60_000;
    rem %= 60_000;
    let sec = rem / 1_000;
    let milli = rem % 1_000;
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}.{milli:03}Z")
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's `civil_from_days`
/// (chrono-compatible, no dependency, valid across the whole i64 range we care
/// about).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// When the fact happened: the envelope's `createdAt` if the producer stamped
/// one (genesis backfill carries historical time there), else the HLC wall time.
fn event_time(ev: &EventRow) -> String {
    ev.created_at
        .clone()
        .unwrap_or_else(|| iso_from_millis(ev.hlc.wall_ms))
}

// ─── Payload accessors ───────────────────────────────────────────────────────

fn str_of(p: &Value, key: &str) -> Option<String> {
    p.get(key).and_then(Value::as_str).map(str::to_string)
}
fn i64_of(p: &Value, key: &str) -> Option<i64> {
    p.get(key).and_then(Value::as_i64)
}
fn f64_of(p: &Value, key: &str) -> Option<f64> {
    p.get(key).and_then(Value::as_f64)
}
fn bool_of(p: &Value, key: &str) -> Option<bool> {
    p.get(key).and_then(Value::as_bool)
}

/// Encode a number the way JavaScript's `JSON.stringify` would: a whole value
/// serializes without a fractional part (`1`, not `1.0`).
///
/// `progress_json` is read back by the reader as an ordinary JSON object, so
/// either spelling parses — but the two must not DISAGREE, or every row would
/// look like drift to `verify_projections` purely over formatting.
fn json_number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9e15 {
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}

/// A payload field a projection column needs and cannot default. Missing means
/// the event is malformed; the caller decides whether that aborts a commit or
/// merely skips one row during a rebuild.
fn require(p: &Value, key: &str, event_type: &str) -> Result<String, CommandError> {
    str_of(p, key).ok_or_else(|| CommandError::internal(format!("event {event_type}: missing required field `{key}`")))
}

// ─── The mapping ─────────────────────────────────────────────────────────────

/// Apply one event to the projections inside `tx`.
///
/// Returns `Ok(false)` when the event type has no projection (forward-compatible
/// unknowns, and the not-yet-projected profile/entity family), `Ok(true)` when
/// it was handled.
/// `merged_id → keep_id`, single hop (merge flattens chains at write time).
fn resolve_book_alias(tx: &Transaction<'_>, id: &str) -> Result<Option<String>, CommandError> {
    tx.query_row(
        "SELECT keep_id FROM book_aliases WHERE merged_id = ?1",
        params![id],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

pub fn apply_event(tx: &Transaction<'_>, ev: &EventRow) -> Result<bool, CommandError> {
    // A late event addressed to a merged-away book (progress from a device
    // that hadn't seen the merge yet) re-routes to the keeper. One central
    // rewrite of the payload's `bookId` — every handler below then applies
    // to the surviving row without knowing merges exist.
    let rerouted: Option<Value> = match ev.payload.get("bookId").and_then(Value::as_str) {
        Some(id) => resolve_book_alias(tx, id)?.map(|keep| {
            let mut clone = ev.payload.clone();
            clone["bookId"] = Value::String(keep);
            clone
        }),
        None => None,
    };
    let p = rerouted.as_ref().unwrap_or(&ev.payload);
    let at = event_time(ev);
    let t = ev.event_type.as_str();

    match t {
        // ── Books ───────────────────────────────────────────────────────────
        "book.imported" => {
            let id = require(p, "bookId", t)?;
            tx.execute(
                "INSERT INTO books
                    (id, title, author, format, file_name, mime_type, file_size,
                     created_at, updated_at, progress_percent, reading_status, starred)
                 VALUES (?1,?2,?3,?4,?5,?6,?7, ?8, ?8, 0, 'unread', 0)
                 ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title, author=excluded.author,
                    format=excluded.format, file_name=excluded.file_name,
                    mime_type=excluded.mime_type, file_size=excluded.file_size,
                    updated_at=excluded.updated_at",
                params![
                    id,
                    require(p, "title", t)?,
                    str_of(p, "author").unwrap_or_default(),
                    require(p, "format", t)?,
                    require(p, "fileName", t)?,
                    str_of(p, "mimeType").unwrap_or_default(),
                    i64_of(p, "fileSize").unwrap_or(0),
                    at,
                ],
            )
            ?;
            if let Some(key) = str_of(p, "sourceBlobKey") {
                ensure_blob_manifest(
                    tx,
                    &key,
                    str_of(p, "mimeType").as_deref(),
                    i64_of(p, "fileSize"),
                    str_of(p, "sourceSha256").as_deref(),
                    &at,
                )?;
            }
        }
        "book.metadataEdited" => {
            let id = require(p, "bookId", t)?;
            // COALESCE keeps a field the edit didn't touch (both are optional).
            tx.execute(
                "UPDATE books
                    SET title = COALESCE(?2, title),
                        author = COALESCE(?3, author),
                        updated_at = ?4
                  WHERE id = ?1",
                params![id, str_of(p, "title"), str_of(p, "author"), at],
            )
            ?;
        }
        "book.opened" => {
            let id = require(p, "bookId", t)?;
            tx.execute(
                "UPDATE books SET last_opened_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, at],
            )
            ?;
        }
        "book.starred" => {
            let id = require(p, "bookId", t)?;
            // Deliberately does NOT touch updated_at: the shelf orders by
            // `last_opened_at ?? updated_at`, so bumping it would shove a
            // never-opened book to the front just for being starred.
            tx.execute(
                "UPDATE books SET starred = ?2 WHERE id = ?1",
                params![id, bool_of(p, "starred").unwrap_or(false) as i64],
            )
            ?;
        }
        "book.finished" => {
            let id = require(p, "bookId", t)?;
            // The reader's own verdict overrides the percentage-derived status.
            // Un-finishing falls back to whether there is progress to resume,
            // so the shelf doesn't strand the book in a state it can't leave.
            let finished = bool_of(p, "finished").unwrap_or(true);
            if finished {
                tx.execute(
                    "UPDATE books SET reading_status = 'finished', updated_at = ?2 WHERE id = ?1",
                    params![id, at],
                )
            } else {
                tx.execute(
                    "UPDATE books
                        SET reading_status = CASE WHEN progress_percent > 0 THEN 'reading'
                                                 ELSE 'unread' END,
                            updated_at = ?2
                      WHERE id = ?1",
                    params![id, at],
                )
            }
            ?;
        }
        "book.removed" => {
            let id = require(p, "bookId", t)?;
            // The book's annotations go with it; their own `*.removed` events
            // are not emitted per-annotation on a book delete.
            tx.execute("DELETE FROM annotations WHERE book_id = ?1", params![id])
                ?;
            tx.execute("DELETE FROM chapter_digests WHERE book_id = ?1", params![id])
                ?;
            tx.execute("DELETE FROM books WHERE id = ?1", params![id])
                ?;
        }
        // Two records, one content (same source sha256): everything the merged
        // record accrued folds into the keeper, and the alias re-routes any
        // later event still addressed to the dead id. Provenance references
        // (vocabulary context, memory evidence) deliberately keep the original
        // id — they cite where something happened, not a live aggregate.
        "book.merged" => {
            let keep_raw = require(p, "keepId", t)?;
            let merged = require(p, "mergedId", t)?;
            // The chosen keeper may itself have been merged away by an earlier
            // event — follow the alias so chains always flatten to one hop.
            let keep = resolve_book_alias(tx, &keep_raw)?.unwrap_or(keep_raw);
            if keep == merged {
                return Ok(false);
            }
            tx.execute(
                "INSERT OR REPLACE INTO book_aliases (merged_id, keep_id) VALUES (?1, ?2)",
                params![merged, keep],
            )
            ?;
            tx.execute(
                "UPDATE book_aliases SET keep_id = ?2 WHERE keep_id = ?1",
                params![merged, keep],
            )
            ?;
            tx.execute(
                "UPDATE annotations SET book_id = ?2 WHERE book_id = ?1",
                params![merged, keep],
            )
            ?;
            // Reading time is additive: same-key rows sum, then the old rows go.
            tx.execute(
                "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
                    SELECT ?2, total_ms, first_started_at, last_read_at
                      FROM reading_time_totals WHERE book_id = ?1
                 ON CONFLICT(book_id) DO UPDATE SET
                    total_ms = reading_time_totals.total_ms + excluded.total_ms,
                    first_started_at = MIN(
                        COALESCE(reading_time_totals.first_started_at, excluded.first_started_at),
                        COALESCE(excluded.first_started_at, reading_time_totals.first_started_at)),
                    last_read_at = MAX(
                        COALESCE(reading_time_totals.last_read_at, excluded.last_read_at),
                        COALESCE(excluded.last_read_at, reading_time_totals.last_read_at))",
                params![merged, keep],
            )
            ?;
            tx.execute(
                "INSERT INTO reading_time_daily (book_id, local_day, ms)
                    SELECT ?2, local_day, ms FROM reading_time_daily WHERE book_id = ?1
                 ON CONFLICT(book_id, local_day) DO UPDATE SET
                    ms = reading_time_daily.ms + excluded.ms",
                params![merged, keep],
            )
            ?;
            tx.execute(
                "INSERT INTO reading_time_hourly (book_id, local_hour, ms)
                    SELECT ?2, local_hour, ms FROM reading_time_hourly WHERE book_id = ?1
                 ON CONFLICT(book_id, local_hour) DO UPDATE SET
                    ms = reading_time_hourly.ms + excluded.ms",
                params![merged, keep],
            )
            ?;
            tx.execute(
                "DELETE FROM reading_time_totals WHERE book_id = ?1",
                params![merged],
            )
            ?;
            tx.execute("DELETE FROM reading_time_daily WHERE book_id = ?1", params![merged])
                ?;
            tx.execute("DELETE FROM reading_time_hourly WHERE book_id = ?1", params![merged])
                ?;
            // Same content, same artwork: a keeper still waiting on a cover
            // inherits the merged record's verdict instead of re-extracting.
            tx.execute(
                "UPDATE books SET
                    cover_status = (SELECT cover_status FROM books WHERE id = ?1),
                    cover_blob_key = (SELECT cover_blob_key FROM books WHERE id = ?1)
                  WHERE id = ?2 AND cover_status = 'unchecked'
                    AND (SELECT cover_status FROM books WHERE id = ?1) IN ('ready', 'none')",
                params![merged, keep],
            )
            ?;
            // Chapter digests describe the same content on both records: the
            // keeper's own rows win per chapter, the merged record fills gaps.
            tx.execute(
                "INSERT OR IGNORE INTO chapter_digests
                    (book_id, chapter_index, chapter_href, summary,
                     characters_json, relations_json, digest_version, flavor, updated_at)
                    SELECT ?2, chapter_index, chapter_href, summary,
                           characters_json, relations_json, digest_version, flavor, updated_at
                      FROM chapter_digests WHERE book_id = ?1",
                params![merged, keep],
            )
            ?;
            tx.execute("DELETE FROM chapter_digests WHERE book_id = ?1", params![merged])
                ?;
            // The keeper's metadata wins; reading STATE takes whichever record
            // got further (progress trio moves together), stars are sticky,
            // and an unfiled keeper adopts the merged record's shelf.
            tx.execute(
                "UPDATE books SET
                    starred = MAX(starred, COALESCE((SELECT starred FROM books WHERE id = ?1), 0)),
                    collection_id = COALESCE(collection_id, (SELECT collection_id FROM books WHERE id = ?1)),
                    narrativity = COALESCE(narrativity, (SELECT narrativity FROM books WHERE id = ?1)),
                    last_opened_at = COALESCE(
                        MAX(last_opened_at, (SELECT last_opened_at FROM books WHERE id = ?1)),
                        last_opened_at,
                        (SELECT last_opened_at FROM books WHERE id = ?1)),
                    progress_json = CASE
                        WHEN COALESCE((SELECT progress_percent FROM books WHERE id = ?1), 0) > progress_percent
                        THEN (SELECT progress_json FROM books WHERE id = ?1) ELSE progress_json END,
                    reading_status = CASE
                        WHEN COALESCE((SELECT progress_percent FROM books WHERE id = ?1), 0) > progress_percent
                        THEN (SELECT reading_status FROM books WHERE id = ?1) ELSE reading_status END,
                    progress_percent = MAX(progress_percent,
                        COALESCE((SELECT progress_percent FROM books WHERE id = ?1), 0))
                 WHERE id = ?2",
                params![merged, keep],
            )
            ?;
            tx.execute("DELETE FROM books WHERE id = ?1", params![merged])
                ?;
        }
        // Membership changes leave updated_at alone for the same reason as
        // starring — regrouping a shelf is not reading activity.
        "book.addedToCollection" => {
            let id = require(p, "bookId", t)?;
            tx.execute(
                "UPDATE books SET collection_id = ?2 WHERE id = ?1",
                params![id, require(p, "collectionId", t)?],
            )
            ?;
        }
        "book.removedFromCollection" => {
            let id = require(p, "bookId", t)?;
            // Guarded by collection id: a stale removal must not clear a
            // membership the book has since gained elsewhere.
            tx.execute(
                "UPDATE books SET collection_id = NULL
                  WHERE id = ?1 AND collection_id = ?2",
                params![id, require(p, "collectionId", t)?],
            )
            ?;
        }

        // ── Collections ─────────────────────────────────────────────────────
        "collection.created" => {
            tx.execute(
                "INSERT INTO collections (id, name, created_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                params![require(p, "collectionId", t)?, require(p, "name", t)?, at],
            )
            ?;
        }
        "collection.renamed" => {
            tx.execute(
                "UPDATE collections SET name = ?2 WHERE id = ?1",
                params![require(p, "collectionId", t)?, require(p, "name", t)?],
            )
            ?;
        }
        "collection.removed" => {
            let id = require(p, "collectionId", t)?;
            tx.execute(
                "UPDATE books SET collection_id = NULL WHERE collection_id = ?1",
                params![id],
            )
            ?;
            tx.execute("DELETE FROM collections WHERE id = ?1", params![id])
                ?;
        }

        // ── Reading ─────────────────────────────────────────────────────────
        "book.progressed" => {
            let id = require(p, "bookId", t)?;
            let locator = str_of(p, "locator").unwrap_or_default();
            let chapter_href = str_of(p, "chapterHref");
            // The projection stores ReaderProgress verbatim as JSON; `cfi` and
            // `href` are the two anchor shapes the reader understands.
            let progress = serde_json::json!({
                "currentLocation": i64_of(p, "currentLocation").unwrap_or(0),
                "totalLocations": i64_of(p, "totalLocations").unwrap_or(0),
                "progressPercent": json_number(f64_of(p, "progressPercent").unwrap_or(0.0)),
                "cfi": if locator.is_empty() { Value::Null } else { Value::String(locator) },
                "href": chapter_href.clone().map_or(Value::Null, Value::String),
            });
            // last_opened_at moves with progress too: the shelf orders by it,
            // and making progress IS reading the book. `book.opened` covers the
            // case where a book is opened without any progress landing.
            // `reading_status` here is DERIVED from the percentage, so it must
            // not overwrite a reader who declared the book finished — turning
            // one more page is not un-finishing it. Only `book.finished(false)`
            // clears that verdict.
            tx.execute(
                "UPDATE books
                    SET progress_json = ?2,
                        progress_percent = COALESCE(?3, progress_percent),
                        reading_status = CASE WHEN reading_status = 'finished' THEN 'finished'
                                              ELSE COALESCE(?4, reading_status) END,
                        last_opened_at = ?5,
                        updated_at = ?5
                  WHERE id = ?1",
                params![
                    id,
                    progress.to_string(),
                    f64_of(p, "progressPercent"),
                    str_of(p, "status"),
                    at,
                ],
            )
            ?;
        }
        "book.timeRecorded" => {
            let id = require(p, "bookId", t)?;
            let ms = i64_of(p, "ms").unwrap_or(0);
            let at_epoch = i64_of(p, "atEpochMs").unwrap_or(ev.hlc.wall_ms);
            // Accumulating projection. Safe because `commit_events` applies only
            // events the log accepted as NEW, and rebuild starts from empty
            // tables — the same event can never be added twice.
            tx.execute(
                "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(book_id) DO UPDATE SET
                    total_ms = total_ms + excluded.total_ms,
                    first_started_at = MIN(COALESCE(first_started_at, excluded.first_started_at),
                                           excluded.first_started_at),
                    last_read_at = MAX(COALESCE(last_read_at, excluded.last_read_at),
                                       excluded.last_read_at)",
                params![id, ms, at_epoch],
            )
            ?;
            // localDay / localHour are stamped by the RECORDING device; deriving
            // them here would shift history when a rebuild runs in another
            // timezone (see the event contract in @read-aware/core).
            if let Some(day) = str_of(p, "localDay") {
                tx.execute(
                    "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1, ?2, ?3)
                     ON CONFLICT(book_id, local_day) DO UPDATE SET ms = ms + excluded.ms",
                    params![id, day, ms],
                )
                ?;
            }
            if let Some(hour) = i64_of(p, "localHour") {
                tx.execute(
                    "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1, ?2, ?3)
                     ON CONFLICT(book_id, local_hour) DO UPDATE SET ms = ms + excluded.ms",
                    params![id, hour, ms],
                )
                ?;
            }
        }

        // ── Annotations (highlights + notes + asks share one typed table) ────
        "highlight.created" => {
            upsert_annotation(
                tx,
                &require(p, "highlightId", t)?,
                &require(p, "bookId", t)?,
                "highlight",
                p,
                str_of(p, "text").unwrap_or_default(),
                None,
                &at,
            )?;
        }
        "highlight.recolored" => {
            tx.execute(
                "UPDATE annotations
                    SET color = COALESCE(?2, color), style = COALESCE(?3, style), updated_at = ?4
                  WHERE id = ?1",
                params![
                    require(p, "highlightId", t)?,
                    str_of(p, "color"),
                    str_of(p, "style"),
                    at
                ],
            )
            ?;
        }
        "note.created" => {
            upsert_annotation(
                tx,
                &require(p, "noteId", t)?,
                &require(p, "bookId", t)?,
                "note",
                p,
                // A note quotes the passage in `text` and carries its body in
                // `content` — the shape annotation-db.ts reads back.
                str_of(p, "quotedText").unwrap_or_default(),
                Some(str_of(p, "body").unwrap_or_default()),
                &at,
            )?;
        }
        "note.updated" => {
            tx.execute(
                "UPDATE annotations SET content = ?2, updated_at = ?3 WHERE id = ?1",
                params![
                    require(p, "noteId", t)?,
                    str_of(p, "body").unwrap_or_default(),
                    at
                ],
            )
            ?;
        }
        "ask.recorded" => {
            upsert_annotation(
                tx,
                &require(p, "askId", t)?,
                &require(p, "bookId", t)?,
                "ask",
                p,
                str_of(p, "text").unwrap_or_default(),
                None,
                &at,
            )?;
        }
        "highlight.removed" | "note.removed" | "ask.removed" => {
            let key = match t {
                "highlight.removed" => "highlightId",
                "note.removed" => "noteId",
                _ => "askId",
            };
            tx.execute(
                "DELETE FROM annotations WHERE id = ?1",
                params![require(p, key, t)?],
            )
            ?;
        }

        // ── AI conversations ────────────────────────────────────────────────
        "aiConversation.started" => {
            tx.execute(
                "INSERT INTO ai_conversations (id, created_at, updated_at)
                 VALUES (?1, ?2, ?2)
                 ON CONFLICT(id) DO NOTHING",
                params![require(p, "conversationId", t)?, at],
            )
            ?;
        }
        "aiMessage.appended" => {
            let conversation_id = require(p, "conversationId", t)?;
            // A message can arrive before its conversation row on a partial log.
            tx.execute(
                "INSERT INTO ai_conversations (id, created_at, updated_at)
                 VALUES (?1, ?2, ?2) ON CONFLICT(id) DO NOTHING",
                params![conversation_id, at],
            )
            ?;
            // Event attachments use `anchor`; the projection column has always
            // held the reader's `cfiRange` spelling. Translate, don't leak.
            let attachments = p.get("attachments").and_then(Value::as_array).map(|list| {
                let mapped: Vec<Value> = list
                    .iter()
                    .map(|a| {
                        serde_json::json!({
                            "text": a.get("text").and_then(Value::as_str).unwrap_or_default(),
                            "cfiRange": a.get("anchor").cloned().unwrap_or(Value::Null),
                            "chapterHref": a.get("chapterHref").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                Value::Array(mapped).to_string()
            });
            tx.execute(
                "INSERT INTO ai_messages
                    (id, conversation_id, role, seq, content, created_at, attachments_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(id) DO UPDATE SET
                    role=excluded.role, seq=excluded.seq, content=excluded.content,
                    attachments_json=excluded.attachments_json",
                params![
                    require(p, "messageId", t)?,
                    conversation_id,
                    str_of(p, "role").unwrap_or_else(|| "user".into()),
                    i64_of(p, "seq").unwrap_or(0),
                    str_of(p, "content").unwrap_or_default(),
                    at,
                    attachments,
                ],
            )
            ?;
            tx.execute(
                "UPDATE ai_conversations SET updated_at = ?2 WHERE id = ?1",
                params![conversation_id, at],
            )
            ?;
        }
        "aiMessage.removed" => {
            tx.execute(
                "DELETE FROM ai_messages WHERE id = ?1",
                params![require(p, "messageId", t)?],
            )
            ?;
        }
        "aiConversation.cleared" => {
            let id = require(p, "conversationId", t)?;
            tx.execute(
                "DELETE FROM ai_messages WHERE conversation_id = ?1",
                params![id],
            )
            ?;
            // Tombstone, not a row delete — the sync semantics in
            // docs/sqlite-schema.sql keep the conversation with a cleared_at.
            tx.execute(
                "UPDATE ai_conversations SET cleared_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, at],
            )
            ?;
        }

        // ── Memory ──────────────────────────────────────────────────────────
        "memory.promoted" => {
            let id = require(p, "memoryId", t)?;
            // The column stores the scope FLAT: "global" | "user" | "book:<id>".
            let scope = match str_of(p, "scope").as_deref() {
                Some("book") => format!("book:{}", str_of(p, "bookId").unwrap_or_default()),
                Some(other) => other.to_string(),
                None => "user".to_string(),
            };
            let evidence_count = p
                .get("evidence")
                .and_then(Value::as_array)
                .map(|list| list.len() as i64)
                .unwrap_or(1)
                .max(1);
            tx.execute(
                "INSERT INTO memories
                    (id, scope, kind, content, importance, evidence_count, pinned,
                     status, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,0,'active',?7,?7)
                 ON CONFLICT(id) DO UPDATE SET
                    scope=excluded.scope, kind=excluded.kind, content=excluded.content,
                    importance=excluded.importance, evidence_count=excluded.evidence_count,
                    updated_at=excluded.updated_at",
                params![
                    id,
                    scope,
                    str_of(p, "kind").unwrap_or_else(|| "fact".into()),
                    require(p, "content", t)?,
                    f64_of(p, "importance").unwrap_or(0.5),
                    evidence_count,
                    at,
                ],
            )
            ?;
        }
        "memory.revised" => {
            let id = require(p, "memoryId", t)?;
            let scope = match str_of(p, "scope").as_deref() {
                Some("book") => Some(format!("book:{}", str_of(p, "bookId").unwrap_or_default())),
                Some(other) => Some(other.to_string()),
                None => None,
            };
            tx.execute(
                "UPDATE memories
                    SET content = COALESCE(?2, content),
                        importance = COALESCE(?3, importance),
                        evidence_count = COALESCE(?4, evidence_count),
                        scope = COALESCE(?5, scope),
                        updated_at = ?6
                  WHERE id = ?1",
                params![
                    id,
                    str_of(p, "content"),
                    f64_of(p, "importance"),
                    i64_of(p, "evidenceCount"),
                    scope,
                    at
                ],
            )
            ?;
        }
        "memory.superseded" => {
            tx.execute(
                "UPDATE memories SET status = 'superseded', updated_at = ?2 WHERE id = ?1",
                params![require(p, "memoryId", t)?, at],
            )
            ?;
        }
        "memory.forgotten" => {
            tx.execute(
                "UPDATE memories SET status = 'forgotten', updated_at = ?2 WHERE id = ?1",
                params![require(p, "memoryId", t)?, at],
            )
            ?;
        }
        "memory.feedback" => {
            let id = require(p, "memoryId", t)?;
            match str_of(p, "signal").as_deref() {
                Some("pin") => {
                    tx.execute(
                        "UPDATE memories SET pinned = 1, updated_at = ?2 WHERE id = ?1",
                        params![id, at],
                    )
                    ?;
                }
                Some("unpin") => {
                    tx.execute(
                        "UPDATE memories SET pinned = 0, updated_at = ?2 WHERE id = ?1",
                        params![id, at],
                    )
                    ?;
                }
                // "useful" / "not_useful" nudge ranking; the importance model
                // that consumes them lands with the consolidation pipeline.
                _ => return Ok(false),
            }
        }

        // Roaming preferences: key-level last-writer-wins. Events apply in
        // HLC order (merge replays behind the frontier), so a plain upsert IS
        // the LWW rule — no timestamps to compare here.
        "preference.changed" => {
            if let (Some(key), Some(value)) = (str_of(p, "key"), p.get("value")) {
                tx.execute(
                    "INSERT INTO synced_preferences (key, value_json, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at",
                    params![key, value.to_string(), at],
                )
                ?;
            }
        }

        // coverExtracted: the verdict of a cover extraction. `ready` names the
        // synced blob (and leaves a manifest row so a fresh device knows the
        // cover exists remotely before any bytes arrive); `none` closes the
        // question for every device. Anything else ('failed' from older
        // builds) leaves the row unchecked so the engine job may retry.
        "book.coverExtracted" => {
            let id = require(p, "bookId", t)?;
            let status = str_of(p, "status").unwrap_or_default();
            let key = str_of(p, "coverBlobKey");
            match (status.as_str(), key) {
                ("ready", Some(key)) => {
                    ensure_blob_manifest(tx, &key, None, None, None, &at)?;
                    tx.execute(
                        "UPDATE books SET cover_status = 'ready', cover_blob_key = ?2 WHERE id = ?1",
                        params![id, key],
                    )?;
                }
                ("none", _) => {
                    tx.execute(
                        "UPDATE books SET cover_status = 'none', cover_blob_key = NULL WHERE id = ?1",
                        params![id],
                    )?;
                }
                _ => return Ok(false),
            }
        }
        // 章节读毕提炼：LLM 产物不可确定性重算，因此以事件为准物化整行；
        // 同章后到的事件（管线升版重算）整行覆盖。
        "book.chapterDigested" => {
            let id = require(p, "bookId", t)?;
            let chapter_index = i64_of(p, "chapterIndex")
                .ok_or_else(|| format!("{t}: missing chapterIndex"))?;
            let characters_json = p
                .get("characters")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "[]".to_string());
            let relations_json = p
                .get("relations")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "[]".to_string());
            tx.execute(
                "INSERT INTO chapter_digests
                    (book_id, chapter_index, chapter_href, summary,
                     characters_json, relations_json, digest_version, flavor, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(book_id, chapter_index) DO UPDATE SET
                    chapter_href=excluded.chapter_href, summary=excluded.summary,
                    characters_json=excluded.characters_json,
                    relations_json=excluded.relations_json,
                    digest_version=excluded.digest_version,
                    flavor=excluded.flavor,
                    updated_at=excluded.updated_at",
                params![
                    id,
                    chapter_index,
                    str_of(p, "chapterHref"),
                    require(p, "summary", t)?,
                    characters_json,
                    relations_json,
                    i64_of(p, "digestVersion").unwrap_or(1),
                    str_of(p, "flavor"),
                    at,
                ],
            )
            ?;
        }
        // 叙事性分类（剧透围栏与纪要口径的分流信号）：空闲管线的 LLM 判定，
        // 与 chapterDigested 同理入事件——不可确定性重算，重放可复原。
        "book.narrativityClassified" => {
            let id = require(p, "bookId", t)?;
            let narrativity = require(p, "narrativity", t)?;
            tx.execute(
                "UPDATE books SET narrativity = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, narrativity, at],
            )
            ?;
        }
        // profile/entity: no projection table until the consolidation pipeline.
        "profile.updated" | "entity.resolved" | "entity.merged" => return Ok(false),

        // ── Forward compatibility ───────────────────────────────────────────
        // Skipping is the contract (an older build must accept a newer log),
        // but the skip must leave a trace: "a newer device wrote data this
        // version cannot project" is exactly what a user will report as data
        // loss, and the log line is the only way to tell the two apart.
        other => {
            log::warn!("skipping event type {other:?} unknown to this app version");
            return Ok(false);
        }
    }

    Ok(true)
}

/// Blob bootstrap contract (docs/data-model.md §9): an event that references a
/// blob key must leave a `blob_objects` manifest row behind, so a fresh device
/// replaying the log learns the blob exists remotely before any bytes arrive.
/// `storage_uri` stays NULL — "known, not fetched" — which readers treat as a
/// cache miss, never an error; the blob fetcher fills in the bytes lazily.
///
/// `INSERT OR IGNORE`, deliberately: on the device that already holds the
/// bytes, the registry row (with its real `storage_uri`, size, and hash) was
/// written by `put_blob` and must not be touched. `blob_objects` is
/// [device-local], excluded from rebuild's wipe and from the drift check, so
/// replaying this upsert over an existing row is always a no-op.
fn ensure_blob_manifest(
    tx: &Transaction<'_>,
    key: &str,
    mime_type: Option<&str>,
    byte_size: Option<i64>,
    sha256: Option<&str>,
    at: &str,
) -> Result<(), CommandError> {
    let (kind, sync_required) = super::blob_kind(key);
    tx.execute(
        "INSERT OR IGNORE INTO blob_objects
            (key, kind, mime_type, byte_size, sha256, storage_uri, sync_required, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
        params![key, kind, mime_type, byte_size, sha256, sync_required as i64, at],
    )
    ?;
    Ok(())
}

/// Shared upsert for the three annotation kinds. `text` is the anchored passage;
/// `content` carries a note's body (None for highlights/asks).
#[allow(clippy::too_many_arguments)]
fn upsert_annotation(
    tx: &Transaction<'_>,
    id: &str,
    book_id: &str,
    kind: &str,
    payload: &Value,
    text: String,
    content: Option<String>,
    at: &str,
) -> Result<(), CommandError> {
    tx.execute(
        "INSERT INTO annotations
            (id, book_id, type, cfi_range, chapter_href, text, color, style,
             content, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
         ON CONFLICT(id) DO UPDATE SET
            book_id=excluded.book_id, type=excluded.type, cfi_range=excluded.cfi_range,
            chapter_href=excluded.chapter_href, text=excluded.text,
            color=excluded.color, style=excluded.style, content=excluded.content,
            updated_at=excluded.updated_at",
        params![
            id,
            book_id,
            kind,
            str_of(payload, "anchor"),
            str_of(payload, "chapterHref"),
            text,
            str_of(payload, "color"),
            str_of(payload, "style"),
            content,
            at,
        ],
    )
    ?;
    Ok(())
}

/// How a projection table is compared against a fresh replay.
///
/// Not every column in a projection table is event-derived, and pretending
/// otherwise would make the consistency check cry wolf forever. Each spec names
/// the parts that SHOULD match, so drift means a real recording failure.
pub struct DiffSpec {
    pub table: &'static str,
    /// Columns excluded from the comparison because nothing in the log
    /// describes them (local caches and UI-only state).
    pub local_columns: &'static [&'static str],
    /// Restricts the comparison to rows the log is supposed to describe.
    pub domain_rows: Option<&'static str>,
}

/// Projection tables `apply_event` owns, in a safe truncation order. A rebuild
/// clears exactly these — device-local state (app_kv, local_device, the blob
/// registry, plugin documents) is NOT derived from the log and must survive.
pub const DERIVED_TABLES: &[&str] = &[
    "annotations",
    "books",
    "collections",
    "ai_messages",
    "ai_conversations",
    "memories",
    "reading_time_totals",
    "reading_time_daily",
    "reading_time_hourly",
    "synced_preferences",
    "book_aliases",
    "chapter_digests",
];

pub const DIFF_SPECS: &[DiffSpec] = &[
    DiffSpec {
        table: "annotations",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "books",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "collections",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "ai_messages",
        // `parts_json` holds the assistant's rendered structure and `error`
        // marks a failed turn — presentation state layered on the message,
        // which the log records by role/content/attachments. `seq` is a
        // device-local display hint: events carry the saving device's array
        // index, but after a multi-device merge the next local save renumbers
        // the interleaved transcript (`ai_chat_replace`), so live and replayed
        // seq legitimately disagree.
        local_columns: &["parts_json", "error", "seq"],
        // Error stubs are transient UX (a retry replaces them), never a
        // conversation fact, so they are not expected in a replay at all.
        domain_rows: Some("error IS NULL"),
    },
    DiffSpec {
        table: "ai_conversations",
        // Bumped by local-only writes (error stubs) that emit no event.
        local_columns: &["updated_at"],
        domain_rows: None,
    },
    DiffSpec {
        table: "memories",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "reading_time_totals",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "reading_time_daily",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "reading_time_hourly",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "synced_preferences",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "book_aliases",
        local_columns: &[],
        domain_rows: None,
    },
    DiffSpec {
        table: "chapter_digests",
        local_columns: &[],
        domain_rows: None,
    },
];
