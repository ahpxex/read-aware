//! Annotation provenance survives replay. Live source checks belong only to
//! local commits: an old source is still valid historical evidence on replay.
use super::EventRow;
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

fn invalid() -> CommandError {
    CommandError::new(
        "annotations/invalid-input",
        "Invalid annotation source range",
    )
}

pub(super) fn source_json(payload: &Value, book_id: &str) -> Result<Option<String>, CommandError> {
    let Some(range) = payload.get("range").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let object = range.as_object().ok_or_else(invalid)?;
    if object
        .keys()
        .any(|key| !["bookId", "contentVersion", "cfi", "textQuote"].contains(&key.as_str()))
        || range.get("bookId").and_then(Value::as_str) != Some(book_id)
    {
        return Err(invalid());
    }
    let version = range
        .get("contentVersion")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let cfi = range
        .get("cfi")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if version.trim().is_empty()
        || version.len() > 1024
        || !cfi.starts_with("epubcfi(")
        || !cfi.ends_with(')')
        || cfi.len() > 32768
        || payload.get("anchor").and_then(Value::as_str) != Some(cfi)
    {
        return Err(invalid());
    }
    if let Some(quote) = range.get("textQuote") {
        let quote = quote.as_object().ok_or_else(invalid)?;
        if quote
            .keys()
            .any(|key| !["exact", "prefix", "suffix"].contains(&key.as_str()))
            // The host parser owns quote resolution (PDF matching can fold
            // whitespace). Native storage checks shape, not new text semantics.
            || quote.get("exact").and_then(Value::as_str).is_none_or(|s| s.trim().is_empty() || s.len() > 48000)
            || ["prefix", "suffix"]
                .iter()
                .any(|key| quote.get(*key).is_some_and(|v| v.as_str().is_none()))
        {
            return Err(invalid());
        }
    }
    Ok(Some(serde_json::to_string(range)?))
}

pub(super) fn validate_local_source(
    conn: &Connection,
    event: &EventRow,
) -> Result<(), CommandError> {
    if !["highlight.created", "note.created"].contains(&event.event_type.as_str()) {
        return Ok(());
    }
    let Some(range) = event.payload.get("range").filter(|v| !v.is_null()) else {
        return Ok(());
    };
    let book_id = range
        .get("bookId")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let format: Option<String> = conn
        .query_row("SELECT format FROM books WHERE id=?1", [book_id], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(format) = format else {
        return Err(CommandError::new(
            "library/book-not-found",
            "Annotation source book was removed",
        ));
    };
    let version = range
        .get("contentVersion")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if format != "virtual" {
        let sha: Option<String> = conn
            .query_row(
                "SELECT sha256 FROM blob_objects WHERE key=?1 AND deleted_at IS NULL",
                [format!("bookfile:{book_id}")],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if sha.as_ref().map(|sha| format!("sha256:{sha}")).as_deref() != Some(version) {
            return Err(CommandError::new(
                "reader/stale-location",
                "Annotation source changed before commit",
            ));
        }
    } else if !version.starts_with("virtual:sha256:") {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
    };
    use serde_json::json;

    fn event(id: &str, kind: &str, payload: Value, counter: i64) -> EventRow {
        EventRow {
            id: id.into(),
            event_type: kind.into(),
            payload,
            hlc: Hlc {
                wall_ms: 1_780_000_000_000,
                counter,
                device_id: "test".into(),
            },
            schema_version: None,
            aggregate_type: None,
            aggregate_id: None,
            actor_id: None,
            origin: Some("agent".into()),
            created_at: None,
        }
    }
    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        commit_events_inner(&mut conn, &[event("book", "book.imported", json!({
            "bookId":"book", "title":"Book", "author":"Author", "format":"epub", "fileName":"book.epub", "fileSize":12
        }), 0)]).unwrap();
        super::super::blobs::register_blob_inner(
            &conn,
            "bookfile:book",
            None,
            12,
            "old".into(),
            "book.epub".into(),
        )
        .unwrap();
        conn
    }
    fn creation(id: &str, kind: &str) -> EventRow {
        event(
            id,
            kind,
            json!({"highlightId":id,"noteId":id,"bookId":"book","text":"Quote","quotedText":"Quote","body":"Note",
            "anchor":"epubcfi(/6/2!/4/2, /1:0, /1:5)", "range": {"bookId":"book","contentVersion":"sha256:old",
                "cfi":"epubcfi(/6/2!/4/2, /1:0, /1:5)","textQuote":{"exact":"Quote","prefix":"Before","suffix":"After"}}}),
            if kind == "note.created" { 2 } else { 1 },
        )
    }
    fn read(conn: &Connection, id: &str) -> Value {
        let row = conn
            .query_row(
                "SELECT * FROM annotations WHERE id=?1",
                [id],
                super::super::annotations::row_to_annotation,
            )
            .unwrap();
        serde_json::to_value(row).unwrap()
    }
    #[test]
    fn annotation_range_survives_updates_replay_and_redelivery_after_source_change() {
        let mut conn = db();
        let h = creation("h", "highlight.created");
        let n = creation("n", "note.created");
        commit_events_inner(&mut conn, &[h.clone(), n.clone()]).unwrap();
        assert_eq!(read(&conn, "h")["range"], h.payload["range"]);
        assert_eq!(read(&conn, "n")["range"], n.payload["range"]);
        commit_events_inner(
            &mut conn,
            &[
                event(
                    "edit",
                    "note.updated",
                    json!({"noteId":"n","body":"Edited"}),
                    3,
                ),
                event(
                    "color",
                    "highlight.recolored",
                    json!({"highlightId":"h","color":"blue","style":"underline"}),
                    4,
                ),
            ],
        )
        .unwrap();
        conn.execute(
            "UPDATE blob_objects SET sha256='new' WHERE key='bookfile:book'",
            [],
        )
        .unwrap();
        assert_eq!(
            commit_events_inner(&mut conn, &[h.clone(), n.clone()])
                .unwrap()
                .appended,
            0
        );
        let tx = conn.transaction().unwrap();
        super::super::events::replay_into(&tx).unwrap();
        tx.commit().unwrap();
        assert_eq!(read(&conn, "h")["range"], h.payload["range"]);
        assert_eq!(read(&conn, "h")["color"], "blue");
        assert_eq!(read(&conn, "n")["range"], n.payload["range"]);
        assert_eq!(read(&conn, "n")["content"], "Edited");
    }
    #[test]
    fn annotation_range_rejects_stale_deleted_mismatched_sources_atomically() {
        for scenario in ["version", "deleted", "book", "quote", "anchor"] {
            let mut conn = db();
            let mut invalid = creation("bad", "highlight.created");
            invalid.hlc.counter = 2;
            match scenario {
                "version" => invalid.payload["range"]["contentVersion"] = json!("sha256:stale"),
                "deleted" => {
                    conn.execute("UPDATE blob_objects SET deleted_at='now'", [])
                        .unwrap();
                }
                "book" => invalid.payload["bookId"] = json!("other"),
                "quote" => invalid.payload["range"]["textQuote"]["exact"] = json!([]),
                _ => invalid.payload["anchor"] = json!("epubcfi(/other)"),
            }
            let prior = event(
                "prior",
                "note.created",
                json!({"noteId":"prior","bookId":"book","body":"Must roll back"}),
                1,
            );
            assert!(
                commit_events_inner(&mut conn, &[prior, invalid]).is_err(),
                "{scenario}"
            );
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0, "{scenario}");
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM domain_events WHERE id IN ('prior','bad')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{scenario}");
        }
    }
    #[test]
    fn annotation_range_legacy_events_keep_their_original_anchor_without_a_version() {
        let mut conn = db();
        let mut legacy = creation("legacy", "note.created");
        legacy.payload.as_object_mut().unwrap().remove("range");
        commit_events_inner(&mut conn, &[legacy.clone()]).unwrap();
        assert!(read(&conn, "legacy").get("range").is_none());
        assert_eq!(read(&conn, "legacy")["cfiRange"], legacy.payload["anchor"]);
        let tx = conn.transaction().unwrap();
        super::super::events::replay_into(&tx).unwrap();
        tx.commit().unwrap();
        assert!(read(&conn, "legacy").get("range").is_none());
    }
}
