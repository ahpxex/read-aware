use super::super::{
    apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
};
use super::*;
use serde_json::json;

fn event(id: &str, counter: i64, index: i64) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: "book.chapterDigested".into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "digest-test".into(),
        },
        schema_version: None,
        aggregate_type: Some("book".into()),
        aggregate_id: Some("b".into()),
        actor_id: None,
        origin: Some("agent".into()),
        created_at: None,
        payload: json!({"bookId":"b","chapterIndex":index,"chapterHref":format!("ch{index}"),"summary":id,"characters":[{"name":"Ada","aliases":["A"]}],"relations":[],"digestVersion":2,"flavor":"narrative"}),
    }
}
fn classification(id: &str, counter: i64, flavor: &str) -> EventRow {
    let mut e = event(id, counter, 0);
    e.event_type = "book.narrativityClassified".into();
    e.payload = json!({"bookId":"b","narrativity":flavor});
    e
}
fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let mut seed = event("seed", 0, 0);
    seed.event_type = "book.imported".into();
    seed.payload = json!({"bookId":"b","title":"Book","format":"epub","fileName":"b.epub"});
    commit_events_inner(&mut conn, &[seed, classification("class", 1, "narrative")]).unwrap();
    conn
}
fn revision(conn: &mut Connection, index: i64) -> String {
    book_digest_inspect_inner(conn, "b", index)
        .unwrap()
        .unwrap()
        .revision
}
fn counts(conn: &Connection) -> (i64, i64) {
    (
        conn.query_row("SELECT COUNT(*) FROM domain_events", [], |r| r.get(0))
            .unwrap(),
        conn.query_row("SELECT COUNT(*) FROM event_sync_state", [], |r| r.get(0))
            .unwrap(),
    )
}
#[test]
fn digest_conditions_allow_other_chapters_but_reject_competing_writes_and_classification_aba() {
    let mut conn = db();
    let zero = revision(&mut conn, 0);
    let one = revision(&mut conn, 1);
    book_digest_commit_inner(&mut conn, &event("one", 2, 1), &one).unwrap();
    assert_eq!(revision(&mut conn, 0), zero);
    let new = book_digest_commit_inner(&mut conn, &event("zero", 3, 0), &zero).unwrap();
    assert_ne!(new.revision, zero);
    assert_eq!(
        book_digest_commit_inner(&mut conn, &event("late", 4, 0), &zero)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let before = counts(&conn);
    commit_events_inner(
        &mut conn,
        &[
            classification("exo", 5, "expository"),
            classification("narr", 6, "narrative"),
        ],
    )
    .unwrap();
    assert_eq!(
        book_digest_commit_inner(&mut conn, &event("old-class", 7, 0), &new.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(counts(&conn), (before.0 + 2, before.1 + 2));
    let fresh = revision(&mut conn, 0);
    book_digest_commit_inner(&mut conn, &event("fresh", 8, 0), &fresh).unwrap();
}
#[test]
fn digest_failure_rolls_back_event_projection_outbox_and_can_retry_the_same_event_id() {
    let mut conn = db();
    let token = revision(&mut conn, 0);
    let before = counts(&conn);
    conn.execute_batch("CREATE TRIGGER reject_digest BEFORE INSERT ON chapter_digests BEGIN SELECT RAISE(ABORT,'private-fixture'); END;").unwrap();
    assert!(book_digest_commit_inner(&mut conn, &event("retry", 2, 0), &token).is_err());
    assert_eq!(counts(&conn), before);
    assert_eq!(revision(&mut conn, 0), token);
    assert!(read_digest(&conn, "b", 0).unwrap().is_none());
    conn.execute_batch("DROP TRIGGER reject_digest;").unwrap();
    book_digest_commit_inner(&mut conn, &event("retry", 2, 0), &token).unwrap();
    assert_eq!(counts(&conn), (before.0 + 1, before.1 + 1));
}
#[test]
fn digest_rejects_invalid_payload_target_revision_and_deleted_books() {
    let mut conn = db();
    let token = revision(&mut conn, 0);
    let before = counts(&conn);
    for mutate in [
        |e: &mut EventRow| {
            e.payload["chapterIndex"] = json!(-1);
        },
        |e: &mut EventRow| {
            e.payload["characters"] = json!([{"name":"Ada","aliases":"bad"}]);
        },
        |e: &mut EventRow| {
            e.payload["relations"] = json!([{"from":"Ada","kind":"knows","to":"Ben","extra":true}]);
        },
        |e: &mut EventRow| {
            e.payload["extra"] = json!(true);
        },
        |e: &mut EventRow| {
            e.aggregate_id = Some("other".into());
        },
    ] {
        let mut e = event("bad", 2, 0);
        mutate(&mut e);
        assert_eq!(
            book_digest_commit_inner(&mut conn, &e, &token)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    assert_eq!(
        book_digest_commit_inner(&mut conn, &event("bad-token", 2, 0), "bdg1:bad")
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    let mut wrong = event("wrong-flavor", 2, 0);
    wrong.payload["flavor"] = json!("expository");
    assert_eq!(
        book_digest_commit_inner(&mut conn, &wrong, &token)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(counts(&conn), before);
    let mut remove = event("remove", 3, 0);
    remove.event_type = "book.removed".into();
    remove.payload = json!({"bookId":"b"});
    commit_events_inner(&mut conn, &[remove]).unwrap();
    assert!(book_digest_inspect_inner(&mut conn, "b", 0)
        .unwrap()
        .is_none());
    assert_eq!(
        book_digest_commit_inner(&mut conn, &event("deleted", 4, 0), &token)
            .unwrap_err()
            .code,
        "reader/book-not-found"
    );
}
#[test]
fn digest_does_not_acknowledge_an_event_that_ordered_replay_supersedes() {
    let mut conn = db();
    let token = revision(&mut conn, 0);
    book_digest_commit_inner(&mut conn, &event("winner", 5, 0), &token).unwrap();
    let current = revision(&mut conn, 0);
    let before = counts(&conn);
    assert_eq!(
        book_digest_commit_inner(&mut conn, &event("older", 3, 0), &current)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(counts(&conn), before);
    assert_eq!(revision(&mut conn, 0), current);
    assert_eq!(read_digest(&conn, "b", 0).unwrap().unwrap().1, "winner");
}
