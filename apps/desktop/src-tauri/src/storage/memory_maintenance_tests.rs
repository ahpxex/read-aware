use super::super::{
    apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
};
use super::*;
use serde_json::json;

fn event(id: &str, memory: &str, kind: &str, payload: serde_json::Value, counter: i64) -> EventRow {
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
        aggregate_type: Some("memory".into()),
        aggregate_id: Some(memory.into()),
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
    for (n, id) in ["a", "b"].iter().enumerate() {
        commit_events_inner(
            &mut conn,
            &[event(
                &format!("seed-{id}"),
                id,
                "memory.promoted",
                json!({"memoryId":id,"content":id,"kind":"fact","scope":"user","importance":0.5}),
                n as i64,
            )],
        )
        .unwrap();
    }
    conn
}
fn conditions(conn: &mut Connection) -> Vec<MemoryCondition> {
    snapshots_inner(conn)
        .unwrap()
        .iter()
        .map(|snapshot| MemoryCondition {
            memory_id: snapshot.memory.id.clone(),
            revision: snapshot.revision.clone(),
        })
        .collect()
}
fn merge() -> Vec<EventRow> {
    vec![
        event(
            "drop",
            "b",
            "memory.superseded",
            json!({"memoryId":"b","bySupersedingId":"a"}),
            10,
        ),
        event(
            "credit",
            "a",
            "memory.revised",
            json!({"memoryId":"a","importance":0.6,"evidenceCount":2}),
            11,
        ),
    ]
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn memory_maintenance_merge_is_atomic_with_winner_credit_and_sync_outbox() {
    let mut conn = db();
    let expected = conditions(&mut conn);
    let outbox = count(&conn, "event_sync_state");
    conn.execute_batch("CREATE TRIGGER deny_winner BEFORE UPDATE ON memories WHEN NEW.id='a' BEGIN SELECT RAISE(ABORT,'owned failure'); END;").unwrap();
    assert!(commit_inner(&mut conn, &expected, &merge()).is_err());
    assert_eq!(snapshots_inner(&mut conn).unwrap().len(), 2);
    assert_eq!(count(&conn, "domain_events"), 2);
    assert_eq!(count(&conn, "event_sync_state"), outbox);
    conn.execute_batch("DROP TRIGGER deny_winner").unwrap();
    commit_inner(&mut conn, &expected, &merge()).unwrap();
    let rows = snapshots_inner(&mut conn).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].memory.id, "a");
    assert_eq!(rows[0].memory.evidence_count, 2);
    assert_eq!(count(&conn, "domain_events"), 4);
}

#[test]
fn memory_maintenance_receipt_excludes_unread_insertions_and_later_edits() {
    let mut conn = db();
    let expected = conditions(&mut conn);
    commit_events_inner(
        &mut conn,
        &[event(
            "seed-c",
            "c",
            "memory.promoted",
            json!({"memoryId":"c","content":"New fact","kind":"fact","scope":"user"}),
            2,
        )],
    )
    .unwrap();
    let receipt = commit_inner(&mut conn, &expected, &merge()).unwrap();
    assert_eq!(receipt.len(), 1);
    assert_eq!(receipt[0].memory.id, "a");
    let now = snapshots_inner(&mut conn).unwrap();
    assert_eq!(now.len(), 2);
    assert_eq!(receipt[0].revision, now[0].revision);
    commit_events_inner(
        &mut conn,
        &[event(
            "late-edit",
            "a",
            "memory.revised",
            json!({"memoryId":"a","content":"Late correction"}),
            12,
        )],
    )
    .unwrap();
    assert_ne!(
        receipt[0].revision,
        snapshots_inner(&mut conn).unwrap()[0].revision
    );
}

#[test]
fn memory_maintenance_stale_read_set_prevents_decay_merge_and_reinforcement() {
    let mut conn = db();
    let expected = conditions(&mut conn);
    commit_events_inner(
        &mut conn,
        &[event(
            "correct",
            "a",
            "memory.revised",
            json!({"memoryId":"a","content":"User corrected"}),
            2,
        )],
    )
    .unwrap();
    assert_eq!(
        commit_inner(&mut conn, &expected, &merge())
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(snapshots_inner(&mut conn).unwrap().len(), 2);
    let fresh = conditions(&mut conn);
    commit_events_inner(
        &mut conn,
        &[event(
            "forget",
            "a",
            "memory.forgotten",
            json!({"memoryId":"a","reason":"user"}),
            3,
        )],
    )
    .unwrap();
    assert_eq!(
        commit_inner(&mut conn, &fresh, &merge()).unwrap_err().code,
        "memory/conflict"
    );
    assert_eq!(count(&conn, "domain_events"), 4);
}

#[test]
fn memory_maintenance_rejects_unconditioned_or_arbitrary_mutations() {
    let mut conn = db();
    let expected = conditions(&mut conn);
    for payload in [
        json!({"memoryId":"a","content":"Replace"}),
        json!({"memoryId":"a","importance":1,"evidenceCount":90}),
        json!({"memoryId":"a","scope":"global"}),
    ] {
        assert_eq!(
            commit_inner(
                &mut conn,
                &expected,
                &[event("bad", "a", "memory.revised", payload, 3)]
            )
            .unwrap_err()
            .code,
            "memory/invalid-input"
        );
    }
    assert!(commit_inner(&mut conn, &expected[..1], &merge()).is_err());
    assert_eq!(count(&conn, "domain_events"), 2);
    commit_events_inner(
        &mut conn,
        &[event(
            "pin",
            "b",
            "memory.feedback",
            json!({"memoryId":"b","signal":"pin"}),
            2,
        )],
    )
    .unwrap();
    let fresh = conditions(&mut conn);
    assert_eq!(
        commit_inner(&mut conn, &fresh, &merge()).unwrap_err().code,
        "memory/invalid-input"
    );
    assert_eq!(count(&conn, "domain_events"), 3);
    commit_events_inner(
        &mut conn,
        &[event(
            "max-evidence",
            "a",
            "memory.revised",
            json!({"memoryId":"a","evidenceCount":i64::MAX}),
            4,
        )],
    )
    .unwrap();
    let fresh = conditions(&mut conn);
    assert_eq!(
        commit_inner(
            &mut conn,
            &fresh,
            &[event(
                "overflow",
                "a",
                "memory.revised",
                json!({"memoryId":"a","importance":0.65,"evidenceCount":null}),
                5
            )]
        )
        .unwrap_err()
        .code,
        "memory/invalid-input"
    );
    assert_eq!(count(&conn, "domain_events"), 4);
}
