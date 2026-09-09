use super::super::{
    apply_connection_pragmas, commit_events_inner, events::replay_into, register_sql_functions,
    run_migrations, Hlc,
};
use super::*;
use serde_json::json;

fn event(id: &str, counter: i64, automatic: bool, flavor: &str) -> EventRow {
    let mut payload = json!({"bookId":"b", "narrativity":flavor});
    if automatic {
        payload["onlyIfUnclassified"] = json!(true);
    }
    EventRow {
        id: id.into(),
        event_type: "book.narrativityClassified".into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: Some("book".into()),
        aggregate_id: Some("b".into()),
        actor_id: None,
        origin: Some(
            if automatic {
                "agent"
            } else {
                "plugin:classification"
            }
            .into(),
        ),
        created_at: None,
        payload,
    }
}
fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let mut seed = event("seed", 0, false, "narrative");
    seed.event_type = "book.imported".into();
    seed.payload = json!({"bookId":"b", "title":"Test", "format":"epub", "fileName":"test.epub"});
    commit_events_inner(&mut conn, &[seed]).unwrap();
    conn
}
fn snapshot(conn: &mut Connection) -> BookClassificationSnapshot {
    book_classification_inspect_inner(conn, "b")
        .unwrap()
        .unwrap()
}
fn count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM domain_events", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn classification_commits_are_conditional_and_late_automation_returns_the_winner() {
    let mut conn = db();
    let old = snapshot(&mut conn);
    assert!(old.narrativity.is_none());
    let result = book_classification_commit_inner(
        &mut conn,
        &event("user", 1, false, "expository"),
        Some(&old.revision),
    )
    .unwrap();
    assert!(result.changed);
    assert_eq!(result.snapshot.narrativity.as_deref(), Some("expository"));
    assert_ne!(old.revision, result.snapshot.revision);
    let late =
        book_classification_commit_inner(&mut conn, &event("auto", 2, true, "narrative"), None)
            .unwrap();
    assert!(!late.changed);
    assert_eq!(late.snapshot.revision, result.snapshot.revision);
    assert_eq!(count(&conn), 2);
    assert_eq!(
        book_classification_commit_inner(
            &mut conn,
            &event("stale", 3, false, "narrative"),
            Some(&old.revision)
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    assert_eq!(count(&conn), 2);
    let origin: String = conn
        .query_row(
            "SELECT origin FROM domain_events WHERE id='user'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(origin, "plugin:classification");
}

#[test]
fn automatic_events_preserve_explicit_choices_in_both_replay_orders() {
    for auto_first in [true, false] {
        let mut conn = db();
        let auto = event("auto", if auto_first { 1 } else { 2 }, true, "narrative");
        let user = event("user", if auto_first { 2 } else { 1 }, false, "expository");
        // Insert out of order too; full replay is the authoritative contract.
        commit_events_inner(&mut conn, &[auto, user]).unwrap();
        let tx = conn.transaction().unwrap();
        replay_into(&tx).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            snapshot(&mut conn).narrativity.as_deref(),
            Some("expository")
        );
    }
}

#[test]
fn classification_aba_rollbacks_and_deletion_do_not_silently_succeed() {
    let mut conn = db();
    let initial =
        book_classification_commit_inner(&mut conn, &event("auto", 1, true, "narrative"), None)
            .unwrap();
    assert!(initial.changed);
    commit_events_inner(
        &mut conn,
        &[
            event("b", 2, false, "expository"),
            event("a", 3, false, "narrative"),
        ],
    )
    .unwrap();
    assert_eq!(
        book_classification_commit_inner(
            &mut conn,
            &event("stale", 4, false, "expository"),
            Some(&initial.snapshot.revision)
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    let revision = snapshot(&mut conn).revision;
    let before = count(&conn);
    let outbox: i64 = conn
        .query_row("SELECT COUNT(*) FROM event_sync_state", [], |row| {
            row.get(0)
        })
        .unwrap();
    conn.execute_batch("CREATE TRIGGER reject_classification BEFORE UPDATE OF narrativity ON books BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(book_classification_commit_inner(
        &mut conn,
        &event("retry", 5, false, "expository"),
        Some(&revision)
    )
    .is_err());
    assert_eq!(count(&conn), before);
    assert_eq!(snapshot(&mut conn).revision, revision);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM event_sync_state", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        outbox
    );
    conn.execute_batch("DROP TRIGGER reject_classification;")
        .unwrap();
    book_classification_commit_inner(
        &mut conn,
        &event("retry", 5, false, "expository"),
        Some(&revision),
    )
    .unwrap();
    let mut removed = event("remove", 6, false, "narrative");
    removed.event_type = "book.removed".into();
    removed.payload = json!({"bookId":"b"});
    commit_events_inner(&mut conn, &[removed]).unwrap();
    assert!(book_classification_inspect_inner(&mut conn, "b")
        .unwrap()
        .is_none());
    assert_eq!(
        book_classification_commit_inner(&mut conn, &event("late", 7, true, "narrative"), None)
            .unwrap_err()
            .code,
        "reader/book-not-found"
    );
}

#[test]
fn classification_rejects_malformed_requests_and_corrupt_projections() {
    let mut conn = db();
    let revision = snapshot(&mut conn).revision;
    for mutate in [
        |e: &mut EventRow| {
            e.payload["narrativity"] = json!("poetry");
        },
        |e: &mut EventRow| {
            e.payload["extra"] = json!(true);
        },
        |e: &mut EventRow| {
            e.aggregate_id = Some("other".into());
        },
        |e: &mut EventRow| {
            e.payload["onlyIfUnclassified"] = json!(false);
        },
    ] {
        let mut e = event("bad", 1, false, "narrative");
        mutate(&mut e);
        assert_eq!(
            book_classification_commit_inner(&mut conn, &e, Some(&revision))
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    let mut unauthorized = event("auto", 1, true, "narrative");
    unauthorized.origin = Some("plugin:bad".into());
    assert_eq!(
        book_classification_commit_inner(&mut conn, &unauthorized, None)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    assert_eq!(
        book_classification_commit_inner(
            &mut conn,
            &event("bad-token", 1, false, "narrative"),
            Some(&"é".repeat(35))
        )
        .unwrap_err()
        .code,
        "memory/invalid-input"
    );
    assert_eq!(count(&conn), 1);
    conn.execute(
        "UPDATE books SET narrativity='private-invalid' WHERE id='b'",
        [],
    )
    .unwrap();
    assert_eq!(
        book_classification_inspect_inner(&mut conn, "b")
            .unwrap_err()
            .code,
        "db/error"
    );
}
