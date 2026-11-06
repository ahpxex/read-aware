use super::*;
use crate::storage::{self, Hlc};
use std::path::Path;
fn db(root: &Path) -> Connection {
    let mut conn = Connection::open(root.join("db")).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn event(conn: &Connection, book: &str, clock: i64) -> EventRow {
    EventRow {
        id: uuid::Uuid::new_v4().to_string(),
        event_type: "book.sessionRecorded".into(),
        hlc: Hlc {
            wall_ms: clock,
            counter: 0,
            device_id: conn
                .query_row("SELECT device_id FROM local_device WHERE id=1", [], |row| {
                    row.get(0)
                })
                .unwrap(),
        },
        schema_version: Some(1),
        aggregate_type: Some("book".into()),
        aggregate_id: Some(book.into()),
        actor_id: Some("local".into()),
        origin: Some("system".into()),
        created_at: None,
        payload: serde_json::json!({"bookId":book,"localDay":"2026-09-12","localHour":15,"ms":999999,"startedAt":0,"endedAt":1}),
    }
}
fn tick(conn: &Connection, book: &str, ms: i64, at: i64) {
    storage::reading_session_accrue_inner(conn, book, "2026-09-12", 15, ms, at).unwrap();
}
#[test]
fn backup_reading_rolls_back_all_closed_facts_when_any_bucket_cannot_retire() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    tick(&conn, "a", 20, 1000);
    tick(&conn, "b", 30, 1000);
    let missing = vec![event(&conn, "a", 10000)];
    assert_eq!(
        close(&mut conn, missing).unwrap_err().code,
        "backup/changed"
    );
    conn.execute_batch("CREATE TRIGGER reject_retirement BEFORE DELETE ON reading_sessions_pending WHEN OLD.book_id='b' BEGIN SELECT RAISE(ABORT,'injected retirement failure'); END;").unwrap();
    let requests = vec![event(&conn, "a", 10000), event(&conn, "b", 10001)];
    assert!(close(&mut conn, requests).is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM domain_events", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row("SELECT sum(ms) FROM reading_sessions_pending", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        50
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM reading_time_totals", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn backup_reading_preserves_position_only_facts_and_rejects_foreign_or_old_envelopes() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    storage::reading_session_position_inner(
        &conn,
        "a",
        "2026-09-12",
        15,
        1000,
        &serde_json::json!({"locator":"only-position"}),
    )
    .unwrap();
    let mut foreign = event(&conn, "a", 10000);
    foreign.hlc.device_id = "foreign".into();
    assert_eq!(
        close(&mut conn, vec![foreign]).unwrap_err().code,
        "backup/changed"
    );
    let current = event(&conn, "a", 10000);
    let closed = close(&mut conn, vec![current.clone()]).unwrap();
    assert_eq!(closed[0].payload["ms"], 0);
    tick(&conn, "a", 10, 2000);
    assert_eq!(
        close(&mut conn, vec![current]).unwrap_err().code,
        "backup/changed"
    );
    assert_eq!(
        storage::reading_sessions_pending_inner(&conn).unwrap()[0].ms,
        10
    );
}
