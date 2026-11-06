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
    commit_events_inner(
        &mut conn,
        &[event(
            "seed",
            "memory.promoted",
            json!({"memoryId":"m", "content":"Original", "kind":"fact", "scope":"user"}),
            0,
        )],
    )
    .unwrap();
    conn
}
fn event(id: &str, kind: &str, payload: serde_json::Value, counter: i64) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: Some("memory".into()),
        aggregate_id: Some("m".into()),
        actor_id: None,
        origin: Some("plugin:memory-feedback".into()),
        created_at: None,
        payload,
    }
}
fn snapshot(conn: &mut Connection) -> MemorySnapshot {
    memory_inspect_inner(conn, "m").unwrap().unwrap()
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn memory_feedback_correct_pin_unpin_forget_are_canonical_and_preserve_origin() {
    let mut conn = db();
    for (n, (kind, payload)) in [
        (
            "memory.revised",
            json!({"memoryId":"m","content":"Corrected"}),
        ),
        ("memory.feedback", json!({"memoryId":"m","signal":"pin"})),
        ("memory.feedback", json!({"memoryId":"m","signal":"unpin"})),
    ]
    .into_iter()
    .enumerate()
    {
        let old = snapshot(&mut conn);
        let result = memory_commit_inner(
            &mut conn,
            &event(&format!("e{n}"), kind, payload, n as i64 + 1),
            &old.revision,
        )
        .unwrap();
        assert_ne!(result.revision.as_deref(), Some(old.revision.as_str()));
        assert_eq!(snapshot(&mut conn).memory.content, "Corrected");
        assert_eq!(snapshot(&mut conn).memory.pinned, n == 1);
    }
    let token = snapshot(&mut conn).revision;
    assert!(memory_commit_inner(
        &mut conn,
        &event(
            "forget",
            "memory.forgotten",
            json!({"memoryId":"m","reason":"user"}),
            4
        ),
        &token
    )
    .unwrap()
    .revision
    .is_none());
    assert!(memory_inspect_inner(&mut conn, "m").unwrap().is_none());
    assert_eq!(count(&conn, "domain_events"), 5);
    let origin: String = conn
        .query_row(
            "SELECT origin FROM domain_events WHERE id='e0'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(origin, "plugin:memory-feedback");
    assert_eq!(
        memory_commit_inner(
            &mut conn,
            &event(
                "late",
                "memory.feedback",
                json!({"memoryId":"m","signal":"pin"}),
                5
            ),
            &token
        )
        .unwrap_err()
        .code,
        "memory/not-found"
    );
}

#[test]
fn memory_feedback_aba_and_sql_failure_leave_log_projection_and_outbox_unchanged() {
    let mut conn = db();
    let old = snapshot(&mut conn);
    commit_events_inner(
        &mut conn,
        &[
            event(
                "away",
                "memory.revised",
                json!({"memoryId":"m","content":"Other"}),
                1,
            ),
            event(
                "back",
                "memory.revised",
                json!({"memoryId":"m","content":"Original"}),
                2,
            ),
        ],
    )
    .unwrap();
    assert_eq!(snapshot(&mut conn).memory.updated_at, old.memory.updated_at);
    let change = event(
        "attempt",
        "memory.revised",
        json!({"memoryId":"m","content":"New"}),
        3,
    );
    assert_eq!(
        memory_commit_inner(&mut conn, &change, &old.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let fresh = snapshot(&mut conn).revision;
    let outbox = count(&conn, "event_sync_state");
    conn.execute_batch("CREATE TRIGGER refuse_memory BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT,'owned memory fault'); END;").unwrap();
    assert!(memory_commit_inner(&mut conn, &change, &fresh).is_err());
    assert_eq!(snapshot(&mut conn).revision, fresh);
    assert_eq!(count(&conn, "domain_events"), 3);
    assert_eq!(count(&conn, "event_sync_state"), outbox);
    conn.execute_batch("DROP TRIGGER refuse_memory").unwrap();
    memory_commit_inner(&mut conn, &change, &fresh).unwrap();
}

#[test]
fn memory_feedback_cannot_change_scope_weights_evidence_or_create_memories() {
    let mut conn = db();
    let token = snapshot(&mut conn).revision;
    for (kind, payload) in [
        (
            "memory.revised",
            json!({"memoryId":"m","content":"x","importance":1}),
        ),
        (
            "memory.revised",
            json!({"memoryId":"m","content":"x","scope":"global"}),
        ),
        ("memory.revised", json!({"memoryId":"m","evidenceCount":10})),
        ("memory.feedback", json!({"memoryId":"m","signal":"useful"})),
        ("memory.forgotten", json!({"memoryId":"m","reason":"decay"})),
        ("memory.promoted", json!({"memoryId":"m","content":"new"})),
    ] {
        assert_eq!(
            memory_commit_inner(&mut conn, &event("bad", kind, payload, 1), &token)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 1);
}
