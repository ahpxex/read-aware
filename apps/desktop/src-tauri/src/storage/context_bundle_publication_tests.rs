use super::super::context_bundle_publication::*;
use super::*;
use serde_json::json;

fn candidate(conn: &Connection, id: &str, wall: i64) -> EventRow {
    let payload: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle.golden.json"
    ))
    .unwrap();
    let mut event = ev(id, wall, "context.bundlePublished", payload);
    event.aggregate_type = Some("contextBundle".into());
    event.aggregate_id = Some(event.payload["version"].as_str().unwrap().into());
    event.origin = Some("user".into());
    event.hlc.device_id = ensure_local_device(conn).unwrap();
    event
}
fn clock(conn: &mut Connection) -> String {
    context_bundle_source_revision_inner(conn).unwrap()
}
fn kv(conn: &Connection, value: &str) {
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('source',?1,'now') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", [value]).unwrap();
}
fn empty_publications(conn: &Connection) {
    for table in [
        "context_bundles",
        "context_bundle_items",
        "domain_events",
        "event_sync_state",
    ] {
        assert_eq!(
            scalar::<i64>(conn, &format!("SELECT count(*) FROM {table}")),
            0,
            "{table}"
        );
    }
}

#[test]
fn source_clock_tracks_every_declared_source_and_detects_aba_but_not_rollback() {
    let mut conn = migrated_conn();
    for table in SOURCE_TABLES {
        for action in ["INSERT", "UPDATE", "DELETE"] {
            let name = format!("context_source_{table}_{action}");
            assert_eq!(
                conn.query_row(
                    "SELECT tbl_name FROM sqlite_master WHERE type='trigger' AND name=?1",
                    [&name],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
                *table
            );
        }
    }
    let initial = clock(&mut conn);
    kv(&conn, "A");
    let a = clock(&mut conn);
    kv(&conn, "B");
    kv(&conn, "A");
    let aba = clock(&mut conn);
    assert_ne!(initial, a);
    assert_ne!(a, aba);
    {
        let tx = conn.transaction().unwrap();
        kv(&tx, "rolled back");
    }
    assert_eq!(clock(&mut conn), aba);
    let event = candidate(&conn, "stale", 1000);
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &a)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    empty_publications(&conn);
    conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES('goals','goals','book','{}','now')", []).unwrap();
    let inserted = clock(&mut conn);
    assert_ne!(inserted, aba);
    conn.execute("DELETE FROM plugin_documents", []).unwrap();
    conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES('goals','goals','book','{}','now')", []).unwrap();
    assert_ne!(clock(&mut conn), inserted);
}

#[test]
fn publication_is_atomic_deduplicated_and_does_not_invalidate_its_own_source_clock() {
    let mut conn = migrated_conn();
    let revision = clock(&mut conn);
    let first = candidate(&conn, "first", 1000);
    let receipt = context_bundle_publish_inner(&mut conn, &first, &revision).unwrap();
    assert!(receipt.changed);
    assert_eq!(receipt.persistence, "event-log");
    assert_eq!(clock(&mut conn), revision);
    let second = candidate(&conn, "second", 2000);
    assert!(
        !context_bundle_publish_inner(&mut conn, &second, &revision)
            .unwrap()
            .changed
    );
    kv(&conn, "unrelated");
    let fresh = clock(&mut conn);
    assert!(
        !context_bundle_publish_inner(&mut conn, &second, &fresh)
            .unwrap()
            .changed
    );
    for table in ["context_bundles", "domain_events", "event_sync_state"] {
        assert_eq!(
            scalar::<i64>(&conn, &format!("SELECT count(*) FROM {table}")),
            1
        );
    }
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundle_items"),
        2
    );
}

#[test]
fn publication_rejects_stale_uninitialized_and_forged_or_old_envelopes() {
    let mut conn = migrated_conn();
    let revision = clock(&mut conn);
    let event = candidate(&conn, "first", 1000);
    for field in [
        "type",
        "aggregate",
        "id",
        "created",
        "device",
        "actor",
        "origin",
        "schema",
        "hash",
    ] {
        let mut bad = event.clone();
        match field {
            "type" => bad.event_type = "profile.updated".into(),
            "aggregate" => bad.aggregate_type = None,
            "id" => bad.aggregate_id = Some("wrong".into()),
            "created" => bad.created_at = Some("historical".into()),
            "device" => bad.hlc.device_id = "foreign".into(),
            "actor" => bad.actor_id = Some("foreign".into()),
            "origin" => bad.origin = None,
            "schema" => bad.schema_version = Some(2),
            _ => bad.payload["version"] = json!("cb1:forged"),
        }
        assert_eq!(
            context_bundle_publish_inner(&mut conn, &bad, &revision)
                .unwrap_err()
                .code,
            "memory/invalid-input",
            "{field}"
        );
        empty_publications(&conn);
    }
    super::super::events::set_projections_stale_conn(&conn, true).unwrap();
    assert!(context_bundle_source_revision_inner(&mut conn).is_err());
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    super::super::events::set_projections_stale_conn(&conn, false).unwrap();
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-agent-profile','legacy','now')", []).unwrap();
    assert!(context_bundle_source_revision_inner(&mut conn).is_err());
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    conn.execute("DELETE FROM app_kv", []).unwrap();
    let fresh = clock(&mut conn);
    context_bundle_publish_inner(&mut conn, &event, &fresh).unwrap();
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &fresh)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    let old = candidate(&conn, "old", 999);
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &old, &fresh)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
}

#[test]
fn projection_and_outbox_faults_roll_back_publication_without_invalidating_sources() {
    for table in [
        "context_bundles",
        "context_bundle_items",
        "event_sync_state",
    ] {
        let mut conn = migrated_conn();
        let revision = clock(&mut conn);
        let event = candidate(&conn, "first", 1000);
        conn.execute_batch(&format!("CREATE TRIGGER fault BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'injected'); END;")).unwrap();
        assert!(context_bundle_publish_inner(&mut conn, &event, &revision).is_err());
        empty_publications(&conn);
        assert_eq!(clock(&mut conn), revision);
        conn.execute_batch("DROP TRIGGER fault").unwrap();
        assert!(
            context_bundle_publish_inner(&mut conn, &event, &revision)
                .unwrap()
                .changed
        );
    }
}

#[test]
fn second_connection_source_write_is_fenced_and_clock_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let observed = clock(&mut conn);
    let event = candidate(&conn, "first", 1000);
    let mut other = Connection::open(&path).unwrap();
    register_sql_functions(&other).unwrap();
    kv(&other, "concurrent");
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &observed)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    empty_publications(&conn);
    let fresh = clock(&mut other);
    drop(other);
    drop(conn);
    let mut conn = Connection::open(&path).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    assert_eq!(clock(&mut conn), fresh);
    assert!(
        context_bundle_publish_inner(&mut conn, &event, &fresh)
            .unwrap()
            .changed
    );
}

#[test]
fn replay_invalidates_clock_while_rolled_back_verification_does_not_and_wipe_changes_generation() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[ev(
            "profile",
            500,
            "profile.updated",
            json!({"summary":"A"}),
        )],
    )
    .unwrap();
    let before = clock(&mut conn);
    commit_events_inner(
        &mut conn,
        &[
            ev("profile-b", 600, "profile.updated", json!({"summary":"B"})),
            ev("profile-a", 700, "profile.updated", json!({"summary":"A"})),
        ],
    )
    .unwrap();
    let aba = clock(&mut conn);
    assert_ne!(aba, before);
    let event = candidate(&conn, "stale-profile", 1000);
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &before)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    {
        let tx = conn.transaction().unwrap();
        super::super::events::replay_into(&tx).unwrap();
    }
    assert_eq!(clock(&mut conn), aba);
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    let after = clock(&mut conn);
    assert_ne!(after, aba);
    assert!(!apply::DERIVED_TABLES.contains(&"context_bundle_source_clock"));
    assert!(!apply::DIFF_SPECS
        .iter()
        .any(|spec| spec.table == "context_bundle_source_clock"));
    let dir = tempfile::tempdir().unwrap();
    let checkpoint =
        super::super::checkpoints::create_checkpoint(&mut conn, dir.path(), "local", None).unwrap();
    let tx = conn.transaction().unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, dir.path(), &checkpoint).unwrap();
    tx.commit().unwrap();
    assert_ne!(clock(&mut conn), after);
    kv(&conn, "private");
    super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundle_source_clock"),
        0
    );
    let wiped = clock(&mut conn);
    assert_ne!(wiped.split(':').nth(1), before.split(':').nth(1));
}

#[test]
fn migration_preserves_sources_and_failed_clock_updates_fail_the_source_transaction() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 35).unwrap();
    kv(&conn, "old");
    run_migrations(&mut conn).unwrap();
    assert_eq!(
        scalar::<String>(&conn, "SELECT value_json FROM app_kv"),
        "old"
    );
    let revision = clock(&mut conn);
    conn.execute_batch("CREATE TRIGGER fault BEFORE UPDATE ON context_bundle_source_clock BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(conn
        .execute("UPDATE app_kv SET value_json='lost'", [])
        .is_err());
    assert_eq!(
        scalar::<String>(&conn, "SELECT value_json FROM app_kv"),
        "old"
    );
    assert_eq!(clock(&mut conn), revision);
    conn.execute_batch("DROP TRIGGER fault").unwrap();
    conn.execute(
        "UPDATE context_bundle_source_clock SET counter=9223372036854775807",
        [],
    )
    .unwrap();
    assert!(conn
        .execute("UPDATE app_kv SET value_json='overflow'", [])
        .is_err());
    assert_eq!(
        scalar::<String>(&conn, "SELECT value_json FROM app_kv"),
        "old"
    );
    let mut broken = test_conn();
    super::super::schema::run_migrations_up_to(&mut broken, 35).unwrap();
    broken
        .execute_batch("CREATE TABLE context_bundle_source_clock(id INTEGER)")
        .unwrap();
    assert!(run_migrations(&mut broken).is_err());
    assert_eq!(
        scalar::<i64>(&broken, "SELECT MAX(version) FROM schema_migrations"),
        35
    );
    assert_eq!(scalar::<i64>(&broken, "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'context_source_%'"), 0);
}
