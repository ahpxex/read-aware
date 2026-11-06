//! Admission for new local memory: authoritative deduplication and user-forgetting
//! checks share the event/projection transaction. No network or fuzzy matching.
use super::{events::commit_events_in_transaction, row_to_memory, Db, EventRow, Memory};
use crate::error::CommandError;
use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCreation {
    pub memory: Memory,
    pub inserted: bool,
}
fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid new memory")
}
fn canonical(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(crate) fn memory_create_inner(
    conn: &mut Connection,
    event: &EventRow,
    automatic: bool,
) -> Result<MemoryCreation, CommandError> {
    let p = event.payload.as_object().ok_or_else(invalid)?;
    let text = p
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let id = p
        .get("memoryId")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let kind = p.get("kind").and_then(Value::as_str).ok_or_else(invalid)?;
    let scope = p.get("scope").and_then(Value::as_str).ok_or_else(invalid)?;
    let scope = match scope {
        "user" | "global" => scope.to_string(),
        "book" => {
            let book = p
                .get("bookId")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            if book.trim().is_empty() || book.encode_utf16().count() > 256 {
                return Err(invalid());
            }
            format!("book:{book}")
        }
        _ => return Err(invalid()),
    };
    if id.trim().is_empty()
        || id.encode_utf16().count() > 256
        || text.trim().is_empty()
        || text.encode_utf16().count() > 16000
        || !["fact", "preference", "insight", "summary"].contains(&kind)
        || event.event_type != "memory.promoted"
        || event.origin.as_deref() != Some("agent")
        || event.aggregate_type.as_deref() != Some("memory")
        || event.aggregate_id.as_deref() != Some(id)
        || event.id.is_empty()
        || p.keys().any(|key| {
            ![
                "memoryId",
                "kind",
                "scope",
                "bookId",
                "content",
                "importance",
            ]
            .contains(&key.as_str())
        })
        || p.get("importance").is_some_and(|v| {
            !v.as_f64()
                .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
        })
    {
        return Err(invalid());
    }
    if !scope.starts_with("book:") && p.contains_key("bookId") {
        return Err(invalid());
    }
    let target = canonical(text);
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(book) = scope.strip_prefix("book:") {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [book],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(CommandError::new(
                "library/book-not-found",
                "Memory source book no longer exists",
            ));
        }
    }
    let mut duplicate = None;
    let mut forgotten = false;
    {
        let mut stmt = tx.prepare("SELECT * FROM memories WHERE scope=?1 AND status IN ('active','forgotten') ORDER BY id")?;
        let mut rows = stmt.query([&scope])?;
        let mut count = 0usize;
        let mut bytes = 0usize;
        while let Some(row) = rows.next()? {
            count += 1;
            let content = row.get_ref("content")?.as_str().map_err(|_| invalid())?;
            bytes = bytes.saturating_add(content.len());
            if count > 10000 || bytes > 8 * 1024 * 1024 || content.len() > 128 * 1024 {
                return Err(CommandError::new(
                    "memory/input-budget-exceeded",
                    "Memory admission read set exceeds its budget",
                ));
            }
            if canonical(content) != target {
                continue;
            }
            let current = super::memories::bounded_memory_row(row)?;
            if current.status == "active" && duplicate.is_none() {
                duplicate = Some(current);
            } else if automatic && current.status == "forgotten" {
                let user_forgot: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM domain_events WHERE aggregate_type='memory' AND aggregate_id=?1 AND type='memory.forgotten' AND json_extract(payload_json,'$.reason')='user') OR NOT EXISTS(SELECT 1 FROM domain_events WHERE aggregate_type='memory' AND aggregate_id=?1 AND type='memory.forgotten' AND json_extract(payload_json,'$.reason')='decay')", [&current.id], |r| r.get(0))?;
                forgotten |= user_forgot;
            }
        }
    }
    // An explicit later remember action can create a new active record. Its
    // presence wins over the retired copy without clearing the user's history.
    if let Some(memory) = duplicate {
        return Ok(MemoryCreation {
            memory,
            inserted: false,
        });
    }
    if forgotten {
        return Err(CommandError::new(
            "memory/forgotten-suppressed",
            "Automatic extraction must not recreate a forgotten memory",
        ));
    }
    let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE id=?1) OR EXISTS(SELECT 1 FROM domain_events WHERE id=?2)", rusqlite::params![id,event.id], |r| r.get(0))?;
    if used {
        return Err(invalid());
    }
    let report = commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
    if report.appended != 1 || report.applied != 1 {
        return Err(CommandError::internal("Incomplete memory creation"));
    }
    let memory = tx.query_row("SELECT * FROM memories WHERE id=?1", [id], row_to_memory)?;
    tx.commit()?;
    Ok(MemoryCreation {
        memory,
        inserted: true,
    })
}

#[tauri::command]
pub async fn memory_create(
    event: EventRow,
    automatic: bool,
    app: tauri::AppHandle,
) -> Result<MemoryCreation, CommandError> {
    super::blocking("memory_create", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_create_inner(&mut conn, &event, automatic)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::super::{
        apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
    };
    use super::*;
    use serde_json::json;
    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        conn
    }
    fn event(id: &str, text: &str, counter: i64) -> EventRow {
        EventRow {
            id: format!("e-{id}-{counter}"),
            event_type: "memory.promoted".into(),
            payload: json!({"memoryId":id,"scope":"user","kind":"fact","content":text,"importance":0.35}),
            hlc: Hlc {
                wall_ms: 1780000000000,
                counter,
                device_id: "creation-test".into(),
            },
            schema_version: None,
            aggregate_type: Some("memory".into()),
            aggregate_id: Some(id.into()),
            actor_id: None,
            origin: Some("agent".into()),
            created_at: None,
        }
    }
    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT count(*) FROM domain_events", [], |r| r.get(0))
            .unwrap()
    }
    #[test]
    fn memory_creation_deduplicates_beyond_prompt_candidates_without_inflating_evidence() {
        let mut conn = db();
        let first = memory_create_inner(&mut conn, &event("a", "Likes  TEA", 1), true).unwrap();
        let duplicate =
            memory_create_inner(&mut conn, &event("b", " likes\n tea ", 2), true).unwrap();
        assert!(first.inserted);
        assert!(!duplicate.inserted);
        assert_eq!(duplicate.memory.id, "a");
        assert_eq!(duplicate.memory.evidence_count, 1);
        assert_eq!(count(&conn), 1);
        let mut other = event("c", "likes tea", 3);
        other.payload["scope"] = json!("global");
        assert!(
            memory_create_inner(&mut conn, &other, true)
                .unwrap()
                .inserted
        );
    }
    #[test]
    fn memory_creation_honors_user_forgetting_but_allows_explicit_later_remember() {
        let mut conn = db();
        memory_create_inner(&mut conn, &event("a", "Known fact", 1), true).unwrap();
        let mut forgot = event("a", "", 2);
        forgot.event_type = "memory.forgotten".into();
        forgot.payload = json!({"memoryId":"a","reason":"user"});
        commit_events_inner(&mut conn, &[forgot]).unwrap();
        assert_eq!(
            memory_create_inner(&mut conn, &event("b", "known fact", 3), true)
                .unwrap_err()
                .code,
            "memory/forgotten-suppressed"
        );
        assert_eq!(count(&conn), 2);
        assert!(
            memory_create_inner(&mut conn, &event("c", "Known fact", 4), false)
                .unwrap()
                .inserted
        );
        let again = memory_create_inner(&mut conn, &event("d", "KNOWN FACT", 5), true).unwrap();
        assert!(!again.inserted);
        assert_eq!(again.memory.id, "c");
        assert_eq!(count(&conn), 3);
    }
    #[test]
    fn memory_creation_failure_is_atomic_and_oversized_candidates_or_read_sets_do_not_write() {
        let mut conn = db();
        conn.execute_batch("CREATE TRIGGER reject_memory BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        assert!(memory_create_inner(&mut conn, &event("a", "Fact", 1), true).is_err());
        assert_eq!(count(&conn), 0);
        conn.execute_batch("DROP TRIGGER reject_memory;").unwrap();
        assert_eq!(
            memory_create_inner(&mut conn, &event("a", &"x".repeat(16001), 1), true)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
        memory_create_inner(&mut conn, &event("a", "Fact", 1), true).unwrap();
        conn.execute(
            "UPDATE memories SET content=?1 WHERE id='a'",
            ["x".repeat(128 * 1024 + 1)],
        )
        .unwrap();
        assert_eq!(
            memory_create_inner(&mut conn, &event("b", "Other", 2), true)
                .unwrap_err()
                .code,
            "memory/input-budget-exceeded"
        );
        assert_eq!(count(&conn), 1);
    }
}

#[cfg(test)]
mod concurrent_tests {
    use super::super::{apply_connection_pragmas, register_sql_functions, run_migrations, Hlc};
    use super::*;
    use std::sync::{Arc, Barrier};
    #[test]
    fn memory_creation_two_connections_cannot_insert_the_same_fact_twice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("memory.sqlite");
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        drop(conn);
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = ["left", "right"].into_iter().map(|id| {
            let path = path.clone(); let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut conn = Connection::open(path).unwrap(); apply_connection_pragmas(&conn).unwrap(); register_sql_functions(&conn).unwrap();
                conn.busy_timeout(std::time::Duration::from_secs(3)).unwrap();
                let event = EventRow { id: format!("event-{id}"), event_type: "memory.promoted".into(),
                    payload: serde_json::json!({"memoryId":id,"scope":"user","kind":"fact","content":"Same fact"}),
                    hlc: Hlc { wall_ms: 1780000000000, counter: 1, device_id: id.into() }, schema_version: None,
                    aggregate_type: Some("memory".into()), aggregate_id: Some(id.into()), actor_id: None, origin: Some("agent".into()), created_at: None };
                barrier.wait(); memory_create_inner(&mut conn, &event, true).unwrap()
            })
        }).collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.inserted).count(), 1);
        assert_eq!(results[0].memory.id, results[1].memory.id);
    }
}
