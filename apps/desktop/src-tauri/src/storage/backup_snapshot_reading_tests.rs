//! A full-backup capture closes the open reading-time facts exactly once.
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
fn backup_reading_closes_current_facts_once_and_captured_events_deduplicate_on_reimport() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    tick(&conn, "b1", 20, 1000);
    assert_eq!(
        backup_snapshot::capture_fixture(&mut conn, root.path(), stage.path(), |_| Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
    let request = event(&conn, "b1", 10000);
    tick(&conn, "b1", 7, 1007);
    storage::reading_session_position_inner(
        &conn,
        "b1",
        "2026-09-12",
        15,
        1005,
        &serde_json::json!({"locator":"latest","progressPercent":20}),
    )
    .unwrap();
    let closed = close(&mut conn, vec![request.clone()]).unwrap();
    assert_eq!(closed.len(), 1);
    assert_eq!(closed[0].payload["ms"], 27);
    assert_eq!(closed[0].payload["startedAt"], 1000);
    assert_eq!(closed[0].payload["endedAt"], 1007);
    assert_eq!(closed[0].payload["progress"]["observedAt"], 1005);
    assert_eq!(closed[0].payload["progress"]["locator"], "latest");
    require_closed(&conn).unwrap();
    assert!(close(&mut conn, vec![request]).unwrap().is_empty());
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, root.path(), stage.path(), |_| Ok(())).unwrap();
    assert_eq!(snapshot.manifest.format, 2);
    assert_eq!(snapshot.manifest.tables["reading_sessions_pending"], 0);
    let captured = Connection::open(snapshot.directory().join("database.sqlite")).unwrap();
    assert_eq!(
        captured
            .query_row("SELECT id FROM domain_events", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        closed[0].id
    );
    let target_root = tempfile::tempdir().unwrap();
    let mut target = db(target_root.path());
    storage::commit_events_inner(&mut target, &closed).unwrap();
    storage::commit_events_inner(&mut target, &closed).unwrap();
    assert_eq!(
        target
            .query_row(
                "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        27
    );
    // Reading resumed after closure: capture must reject rather than omit it.
    tick(&conn, "b1", 5, 1010);
    assert_eq!(
        backup_snapshot::capture_fixture(&mut conn, root.path(), stage.path(), |_| Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
}
