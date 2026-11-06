use super::super::apply;
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
    conn.execute("INSERT INTO local_device(id,device_id,created_at,last_opened_at) VALUES(1,'test','old','old')", []).unwrap();
    conn
}
fn event(conn: &Connection, id: &str, counter: i64) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: "profile.onboarded".into(),
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
        payload: json!({"submissionId":"interview-1", "expectedRevision":user_profile::read_snapshot(conn).unwrap().revision,
            "summary":"Reader likes history", "seeds":[{"kind":"preference","content":"History"},{"kind":"fact","content":"Engineering background"}]}),
    }
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn whole_submission_is_atomic_retryable_and_replayable() {
    let mut conn = db();
    let initial = event(&conn, "first", 1);
    let receipt = onboarding_commit_inner(&mut conn, &initial).unwrap();
    assert_eq!(receipt.status, "completed");
    assert_eq!(receipt.memory_ids.len(), 2);
    assert_eq!(count(&conn, "domain_events"), 1);
    assert_eq!(count(&conn, "event_sync_state"), 1);
    let mut retry = initial.clone();
    retry.id = "retry".into();
    retry.hlc.counter = 2;
    assert_eq!(
        onboarding_commit_inner(&mut conn, &retry).unwrap().status,
        "already-completed"
    );
    assert_eq!(count(&conn, "memories"), 2);
    assert_eq!(count(&conn, "domain_events"), 1);
    // A retry cannot undo a later profile edit or resurrect a forgotten seed.
    let mut later = retry.clone();
    later.event_type = "profile.updated".into();
    later.payload = json!({"summary":"Later"});
    commit_events_inner(&mut conn, &[later]).unwrap();
    conn.execute("UPDATE memories SET status='forgotten'", [])
        .unwrap();
    assert_eq!(
        onboarding_commit_inner(&mut conn, &initial)
            .unwrap()
            .revision,
        receipt.revision
    );
    assert_eq!(
        user_profile::read_snapshot(&conn)
            .unwrap()
            .summary
            .as_deref(),
        Some("Later")
    );
    let tx = conn.transaction().unwrap();
    tx.execute("DELETE FROM onboarding_receipts", []).unwrap();
    tx.execute("DELETE FROM user_profile", []).unwrap();
    tx.execute("DELETE FROM memories", []).unwrap();
    apply::apply_event(&tx, &initial).unwrap();
    assert_eq!(count(&tx, "memories"), 2);
    let (_, restored) = retained(&tx, &parse(&initial).unwrap().0, "agent")
        .unwrap()
        .unwrap();
    assert_eq!(restored.memory_ids, receipt.memory_ids);
    assert_eq!(restored.revision, receipt.revision);
    assert!(!apply::apply_event(&tx, &retry).unwrap());
}

#[test]
fn seed_or_receipt_failure_rolls_back_profile_log_and_outbox() {
    for table in ["memories", "onboarding_receipts"] {
        let mut conn = db();
        let input = event(&conn, "first", 1);
        conn.execute_batch(&format!("CREATE TRIGGER fail BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'injected failure'); END;")).unwrap();
        assert!(onboarding_commit_inner(&mut conn, &input).is_err());
        for name in [
            "user_profile",
            "memories",
            "onboarding_receipts",
            "domain_events",
            "event_sync_state",
        ] {
            assert_eq!(count(&conn, name), 0);
        }
        conn.execute_batch("DROP TRIGGER fail").unwrap();
        assert_eq!(
            onboarding_commit_inner(&mut conn, &input).unwrap().status,
            "completed"
        );
    }
}

#[test]
fn stale_profile_reused_id_and_invalid_payloads_never_commit() {
    let mut conn = db();
    let input = event(&conn, "first", 1);
    onboarding_commit_inner(&mut conn, &input).unwrap();
    let mut changed = input.clone();
    changed.id = "other".into();
    changed.hlc.counter = 2;
    changed.payload["summary"] = json!("Changed candidate");
    assert_eq!(
        onboarding_commit_inner(&mut conn, &changed)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    changed.payload["submissionId"] = json!("second");
    assert_eq!(
        onboarding_commit_inner(&mut conn, &changed)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    for patch in [
        json!({"seeds":[{"kind":"fact","content":""}]}),
        json!({"seeds":[{"kind":"instruction","content":"Bad"}]}),
        json!({"summary":"x".repeat(16001)}),
        json!({"submissionId":"../invalid"}),
        json!({"extra":true}),
    ] {
        let mut invalid = event(&conn, "invalid", 3);
        invalid
            .payload
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert_eq!(
            onboarding_commit_inner(&mut conn, &invalid)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 1);
    let mut other_owner = event(&conn, "owner", 4);
    other_owner.origin = Some("plugin:journal".into());
    assert_eq!(
        onboarding_commit_inner(&mut conn, &other_owner)
            .unwrap()
            .status,
        "completed"
    );
    assert_eq!(count(&conn, "onboarding_receipts"), 2);
}

#[test]
fn checkpoint_and_reopen_retain_submission_receipts_without_recreating_seeds() {
    let dir = std::env::temp_dir().join(format!("readaware-onboarding-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("database.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn.execute("INSERT INTO local_device(id,device_id,created_at,last_opened_at) VALUES(1,'test','old','old')", []).unwrap();
    let input = event(&conn, "durable", 1);
    let original = onboarding_commit_inner(&mut conn, &input).unwrap();
    let checkpoint =
        super::super::checkpoints::create_checkpoint(&mut conn, &dir, "local", None).unwrap();
    let tx = conn.transaction().unwrap();
    tx.execute("DELETE FROM onboarding_receipts", []).unwrap();
    tx.execute("DELETE FROM memories", []).unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, &dir, &checkpoint).unwrap();
    tx.commit().unwrap();
    drop(conn);
    let mut reopened = Connection::open(&path).unwrap();
    apply_connection_pragmas(&reopened).unwrap();
    register_sql_functions(&reopened).unwrap();
    run_migrations(&mut reopened).unwrap();
    let receipt = onboarding_commit_inner(&mut reopened, &input).unwrap();
    assert_eq!(receipt.status, "already-completed");
    assert_eq!(receipt.memory_ids, original.memory_ids);
    assert_eq!(count(&reopened, "memories"), 2);
    assert_eq!(count(&reopened, "domain_events"), 1);
    drop(reopened);
    std::fs::remove_dir_all(dir).unwrap();
}
