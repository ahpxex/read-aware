use super::*;
use crate::storage::{
    self,
    backup_archive::{self, AuthenticatedBackup},
    backup_snapshot,
};
use std::path::Path;
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
};

fn database(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn insert(conn: &Connection, id: &str, wall: i64, device: &str, payload: &str) {
    conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES (?1,'future.fact',?2,0,?3,?4,'now')", params![id,wall,device,payload]).unwrap();
}
fn source(events: &[(&str, i64, &str, &str)]) -> PreflightedBackup {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut conn = database(&root.path().join("db"));
    for (id, wall, device, payload) in events {
        insert(&conn, id, *wall, device, payload);
    }
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, root.path(), staging.path(), |_| Ok(()))
            .unwrap();
    let directory = tempfile::tempdir().unwrap();
    fs::copy(
        snapshot.directory().join("database.sqlite"),
        directory.path().join("database.sqlite"),
    )
    .unwrap();
    backup_archive::preflight(
        AuthenticatedBackup {
            directory: crate::storage::backup_staging::BackupDirectory::fixture(directory),
            manifest: snapshot.manifest.clone(),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap()
}

#[test]
fn backup_event_plan_distinguishes_duplicate_id_clock_and_double_conflicts_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut target = database(&root.path().join("db"));
    insert(
        &target,
        "b-existing",
        20,
        "source",
        r#" {"b":{"y":null,"x":true},"a":1} "#,
    );
    target
        .execute("UPDATE domain_events SET ingested_at='another day'", [])
        .unwrap();
    insert(&target, "c-id", 31, "target", r#"{"different":true}"#);
    insert(&target, "target-clock", 40, "source", "{}");
    insert(&target, "e-both", 51, "target", "{}");
    insert(&target, "target-both", 50, "source", "{}");
    let source = source(&[
        ("a-new", 10, "source", "{}"),
        (
            "b-existing",
            20,
            "source",
            r#"{"a":1,"b":{"x":true,"y":null}}"#,
        ),
        ("c-id", 30, "source", "{}"),
        ("d-clock", 40, "source", "{}"),
        ("e-both", 50, "source", "{}"),
    ]);
    let source_path = source.archive().directory().to_owned();
    let plan = backup_archive::plan_events_fixture(source, &mut target, staging.path(), || Ok(()))
        .unwrap();
    let plan_path = plan._directory.path().to_owned();
    assert_eq!(
        (
            plan.report.new_events,
            plan.report.existing_events,
            plan.report.conflicting_events,
            plan.report.id_conflicts,
            plan.report.clock_conflicts
        ),
        (1, 1, 3, 2, 2)
    );
    let mut cursor = None;
    let mut matches = Vec::new();
    loop {
        let page = plan.page(cursor.as_deref(), 2).unwrap();
        matches.extend(page.entries);
        cursor = page.next_after;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(
        matches.iter().map(|entry| entry.kind).collect::<Vec<_>>(),
        [
            EventMatchKind::New,
            EventMatchKind::Existing,
            EventMatchKind::IdConflict,
            EventMatchKind::ClockConflict,
            EventMatchKind::IdAndClockConflict
        ]
    );
    assert_eq!(
        matches[1].id_target_digest.as_deref(),
        Some(matches[1].source_digest.as_str())
    );
    assert_ne!(
        matches[2].id_target_digest.as_deref(),
        Some(matches[2].source_digest.as_str())
    );
    assert_eq!(matches[3].clock_target_id.as_deref(), Some("target-clock"));
    assert!(matches[3].clock_target_digest.is_some());
    assert!(plan.page(None, 101).is_err());
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM domain_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        5
    );
    assert_eq!(plan.source().report.events, 5);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    plan.verify_target(&tx, || Ok(())).unwrap();
    tx.rollback().unwrap();
    drop(plan);
    assert!(!source_path.exists());
    assert!(!plan_path.exists());
}

#[test]
fn backup_event_plan_full_database_revision_covers_private_state_schema_types_and_same_count_updates(
) {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut target = database(&root.path().join("db"));
    target.execute_batch("CREATE TABLE extra_local(id TEXT PRIMARY KEY, value); INSERT INTO extra_local VALUES ('one',X'6162');").unwrap();
    let plan =
        backup_archive::plan_events_fixture(source(&[]), &mut target, staging.path(), || Ok(()))
            .unwrap();
    for sql in [
        "UPDATE extra_local SET value='ab'", // same bytes, different SQLite type
        "UPDATE local_device SET device_id='changed'",
        "INSERT INTO app_kv VALUES ('private-change','secret value','now')",
        "CREATE TABLE extra_after_preview(value TEXT)",
        "INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES ('new','future.fact',100,0,'new-device','{}','now')",
    ] {
        let tx = target.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).unwrap();
        plan.verify_target(&tx, || Ok(())).unwrap();
        tx.execute_batch(sql).unwrap();
        assert_eq!(plan.verify_target(&tx, || Ok(())).unwrap_err().code, "backup/changed", "{sql}");
        tx.rollback().unwrap();
    }
}

#[test]
fn backup_event_plan_uses_one_wal_view_and_rejects_a_changed_target_at_decision_time() {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut target = database(&path);
    insert(&target, "same", 10, "device", "{}");
    let writer = Connection::open(&path).unwrap();
    let mut steps = 0;
    let plan = backup_archive::plan_events_fixture(
        source(&[("same", 10, "device", "{}")]),
        &mut target,
        staging.path(),
        || {
            steps += 1;
            // The schema row has been read before its fields are hashed; the read
            // transaction is pinned. A separate real WAL connection commits now.
            if steps == 5 {
                writer
                    .execute(
                        "UPDATE domain_events SET payload_json='{\"new\":true}' WHERE id='same'",
                        [],
                    )
                    .unwrap();
            }
            Ok(())
        },
    )
    .unwrap();
    assert!(steps > 5);
    assert_eq!(plan.report.existing_events, 1);
    assert_eq!(plan.report.conflicting_events, 0);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    assert_eq!(
        plan.verify_target(&tx, || Ok(())).unwrap_err().code,
        "backup/changed"
    );
    tx.rollback().unwrap();
}

#[test]
fn backup_event_plan_cancellation_and_malformed_target_never_publish_partial_plans() {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut target = database(&root.path().join("db"));
    // Model an already-corrupted database. Normal writes now parse JSON in the
    // change-feed trigger, so bypass triggers only while constructing the fixture.
    let triggers = rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER;
    let enabled = target.db_config(triggers).unwrap();
    target.set_db_config(triggers, false).unwrap();
    insert(&target, "bad", 1, "device", "not JSON");
    target.set_db_config(triggers, enabled).unwrap();
    let source = source(&[("bad", 1, "device", "{}")]);
    let source_path = source.archive().directory().to_owned();
    assert_eq!(
        backup_archive::plan_events_fixture(source, &mut target, staging.path(), || Ok(()))
            .unwrap_err()
            .code,
        "db/error"
    );
    assert!(!source_path.exists());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert!(target.is_autocommit());
    target.execute("DELETE FROM domain_events", []).unwrap();
    let rows: Vec<_> = (0..200)
        .map(|index| (format!("event-{index:04}"), index + 1))
        .collect();
    let source = self::source(
        &rows
            .iter()
            .map(|(id, wall)| (id.as_str(), *wall, "device", "{}"))
            .collect::<Vec<_>>(),
    );
    let source_path = source.archive().directory().to_owned();
    let mut saw_partial = false;
    let error = backup_archive::plan_events_fixture(source, &mut target, staging.path(), || {
        // Cancel during actual comparison, after the private plan DB exists.
        if crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .any(|entry| {
                entry
                    .unwrap()
                    .path()
                    .join("event-plan.sqlite-journal")
                    .exists()
            })
        {
            saw_partial = true;
            return Err(CommandError::new("backup/cancelled", "cancelled"));
        }
        Ok(())
    })
    .unwrap_err();
    assert!(saw_partial);
    assert_eq!(error.code, "backup/cancelled");
    assert!(!source_path.exists());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert!(target.is_autocommit());
}

#[test]
fn backup_event_plan_normalizes_json_spelling_but_preserves_large_numbers_arrays_and_origins() {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut target = database(&root.path().join("db"));
    insert(&target, "decimal", 1, "device", r#"{"a":1,"b":1000,"z":0}"#);
    insert(
        &target,
        "large",
        2,
        "device",
        r#"{"value":9007199254740992}"#,
    );
    insert(&target, "array", 3, "device", r#"{"items":[2,1]}"#);
    insert(&target, "origin", 4, "device", "{}");
    target
        .execute(
            "UPDATE domain_events SET origin='agent' WHERE id='origin'",
            [],
        )
        .unwrap();
    let plan = backup_archive::plan_events_fixture(
        source(&[
            ("decimal", 1, "device", r#"{"z":-0.0,"b":1e3,"a":1.0}"#),
            ("large", 2, "device", r#"{"value":9007199254740993}"#),
            ("array", 3, "device", r#"{"items":[1,2]}"#),
            ("origin", 4, "device", "{}"),
        ]),
        &mut target,
        staging.path(),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(plan.report.existing_events, 1);
    assert_eq!(plan.report.id_conflicts, 3);
    assert_eq!(plan.report.clock_conflicts, 0);
    let page = plan.page(None, 100).unwrap();
    assert_eq!(
        page.entries
            .iter()
            .find(|entry| entry.source_id == "decimal")
            .unwrap()
            .kind,
        EventMatchKind::Existing
    );
    // The cursor query is a bounded index seek, rather than scanning every
    // earlier event again for each page of a large retained log.
    let explanation: String = plan.entries.query_row("EXPLAIN QUERY PLAN SELECT source_id FROM event_matches WHERE source_id>?1 ORDER BY source_id LIMIT 3", ["large"], |row| row.get(3)).unwrap();
    assert!(explanation.contains("SEARCH"), "{explanation}");
}

#[test]
fn backup_event_plan_requires_target_to_close_its_own_pending_reading_first() {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut target = database(&root.path().join("db"));
    target.execute("INSERT INTO reading_sessions_pending(book_id,local_day,local_hour,ms,started_at,last_at) VALUES ('book','2026-09-12',10,20,1000,1020)", []).unwrap();
    let source = source(&[]);
    let source_path = source.archive().directory().to_owned();
    assert_eq!(
        backup_archive::plan_events_fixture(source, &mut target, staging.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
    assert!(!source_path.exists());
    assert_eq!(
        target
            .query_row("SELECT ms FROM reading_sessions_pending", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        20
    );
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM domain_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
}
