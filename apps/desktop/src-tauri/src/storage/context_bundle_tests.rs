use super::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn golden() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle.golden.json"
    ))
    .unwrap()
}
fn signed(content: Value) -> Value {
    let content = serde_json::from_value::<super::super::context_bundle::Content>(content).unwrap();
    let canonical = super::super::context_bundle::canonical(&content).unwrap();
    json!({"version":format!("cb1:{:x}", Sha256::digest(canonical.as_bytes())),"content":content})
}
fn snapshot(conn: &mut Connection) -> BTreeMap<String, BTreeMap<String, i64>> {
    let tx = conn.transaction().unwrap();
    apply::DIFF_SPECS
        .iter()
        .filter(|spec| spec.table.starts_with("context_bundle"))
        .map(|spec| {
            (
                spec.table.into(),
                super::super::events::snapshot_table(&tx, spec).unwrap(),
            )
        })
        .collect()
}
fn publication(id: &str, wall: i64, payload: Value) -> EventRow {
    ev(id, wall, "context.bundlePublished", payload)
}

#[test]
fn shared_unicode_golden_and_all_recipe_scopes_validate_without_json_key_order_dependence() {
    let input = golden();
    let validated = super::super::context_bundle::validate(&input).unwrap();
    assert_eq!(serde_json::to_value(validated).unwrap(), input);
    for (kind, scope, item_kind) in [
        (
            "user_profile_context",
            json!({"kind":"user"}),
            "curated_profile",
        ),
        (
            "reading_intent_context",
            json!({"kind":"user"}),
            "reading_goal",
        ),
        (
            "reading_intent_context",
            json!({"kind":"book","id":"b"}),
            "memory",
        ),
        (
            "book_memory_context",
            json!({"kind":"book","id":"b"}),
            "chapter_digest",
        ),
        (
            "conversation_insights_context",
            json!({"kind":"book","id":"b"}),
            "conversation_insight",
        ),
        (
            "conversation_insights_context",
            json!({"kind":"conversation","id":"c"}),
            "conversation_insight",
        ),
    ] {
        let mut content = input["content"].clone();
        content["kind"] = json!(kind);
        content["scope"] = scope;
        content["items"] =
            json!([{"kind":item_kind,"id":"item","revision":"rev","label":"","text":""}]);
        content["omissions"] = json!([]);
        super::super::context_bundle::validate(&signed(content)).unwrap();
    }
}

#[test]
fn immutable_versions_deduplicate_and_ranked_sources_survive_replay_and_late_remote_publication() {
    let mut conn = migrated_conn();
    let mut next = golden()["content"].clone();
    next["items"][0]["text"] = json!("Revised observation");
    let events = [
        publication("first", 1000, golden()),
        publication("next", 2000, signed(next)),
        publication("repeat", 3000, golden()),
    ];
    let report = commit_events_inner(&mut conn, &events).unwrap();
    assert_eq!(report.appended, 3);
    assert_eq!(report.applied, 2);
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
        2
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundle_items"),
        4
    );
    assert_eq!(
        scalar::<String>(
            &conn,
            "SELECT source_id FROM context_bundle_items WHERE rank=0 LIMIT 1"
        ),
        "note:one"
    );
    let original: String = conn
        .query_row(
            "SELECT content_json FROM context_bundles WHERE version=?1",
            [golden()["version"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&original).unwrap(),
        golden()["content"]
    );
    let before = snapshot(&mut conn);
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
    let mut reverse = migrated_conn();
    for event in events.iter().rev() {
        apply_remote_events_inner(&mut reverse, &[event.clone()]).unwrap();
    }
    assert_eq!(snapshot(&mut reverse), before);
    assert_eq!(
        scalar::<i64>(&reverse, "SELECT count(*) FROM event_sync_state"),
        0
    );
}

#[test]
fn scope_schema_hash_duplicate_source_and_byte_limit_failures_are_atomic() {
    let base = golden();
    let mut bad = Vec::new();
    for (field, value) in [
        ("scope", json!({"kind":"user"})),
        ("kind", json!("raw_transcript")),
        ("schemaVersion", json!(2)),
        ("recipeVersion", json!(2)),
        ("sourceRevision", json!("")),
        (
            "items",
            json!([base["content"]["items"][0], base["content"]["items"][0]]),
        ),
        (
            "omissions",
            json!([{"kind":"memory","reason":"privacy","count":0}]),
        ),
        (
            "items",
            json!([{"kind":"annotation","id":"a","revision":"r","label":"","text":"x".repeat(1024*1024)}]),
        ),
        (
            "items",
            json!([{"kind":"annotation","id":"a","revision":"r","label":"","text":"\u{4e2d}".repeat(400_000)}]),
        ),
        (
            "items",
            json!([{"kind":"conversation_insight","id":"a","revision":"r","label":"","text":"private"}]),
        ),
    ] {
        let mut input = base.clone();
        input["content"][field] = value;
        bad.push(input);
    }
    let mut input = base.clone();
    input["content"]["scope"]["path"] = json!("/private");
    bad.push(input);
    let mut input = base.clone();
    input["content"]["items"][0]["text"] = json!("\0");
    bad.push(input);
    let mut input = base.clone();
    input["createdAt"] = json!("forged");
    bad.push(input);
    let mut input = base.clone();
    input["version"] = json!("cb1:forged");
    bad.push(input);
    let mut input = base.clone();
    input["content"]["items"][0]["revision"] = json!("changed");
    bad.push(input);
    for payload in bad {
        let mut conn = migrated_conn();
        let error = commit_events_inner(
            &mut conn,
            &[
                publication("good", 1000, base.clone()),
                publication("bad", 2000, payload),
            ],
        )
        .unwrap_err();
        assert_eq!(error.code, "memory/invalid-input");
        for table in [
            "context_bundles",
            "context_bundle_items",
            "domain_events",
            "event_sync_state",
        ] {
            assert_eq!(
                scalar::<i64>(&conn, &format!("SELECT count(*) FROM {table}")),
                0
            );
        }
    }
}

#[test]
fn projection_or_outbox_failure_rolls_back_entire_publication() {
    for table in [
        "context_bundles",
        "context_bundle_items",
        "event_sync_state",
    ] {
        let mut conn = migrated_conn();
        conn.execute_batch(&format!("CREATE TRIGGER fail_insert BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'injected'); END;")).unwrap();
        assert!(commit_events_inner(&mut conn, &[publication("p", 1000, golden())]).is_err());
        for name in [
            "context_bundles",
            "context_bundle_items",
            "domain_events",
            "event_sync_state",
        ] {
            assert_eq!(
                scalar::<i64>(&conn, &format!("SELECT count(*) FROM {name}")),
                0
            );
        }
    }
}

#[test]
fn checkpoint_restore_preserves_versions_and_items_while_drift_and_wipe_cover_both_tables() {
    let mut conn = migrated_conn();
    let dir = tempfile::tempdir().unwrap();
    commit_events_inner(&mut conn, &[publication("p", 1000, golden())]).unwrap();
    let before = snapshot(&mut conn);
    let checkpoint =
        super::super::checkpoints::create_checkpoint(&mut conn, dir.path(), "local", None).unwrap();
    conn.execute("UPDATE context_bundles SET content_json='{}'", [])
        .unwrap();
    conn.execute(
        "UPDATE context_bundle_items SET source_revision='drift'",
        [],
    )
    .unwrap();
    assert_ne!(snapshot(&mut conn), before);
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
    for table in apply::DERIVED_TABLES {
        conn.execute(&format!("DELETE FROM {table}"), []).unwrap();
    }
    let tx = conn.transaction().unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, dir.path(), &checkpoint).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
    super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert!(snapshot(&mut conn).values().all(|rows| rows.is_empty()));
}

fn historical(conn: &mut Connection, payload: Value) {
    super::super::schema::run_migrations_up_to(conn, 34).unwrap();
    let tx = conn.transaction().unwrap();
    super::super::events::insert_event_row(
        &tx,
        &publication("historical", 1000, payload),
        super::super::events::EventSource::Local,
    )
    .unwrap();
    tx.commit().unwrap();
}
#[test]
fn upgrade_recovers_previously_unknown_events_and_preserves_unrelated_legacy_state() {
    let mut conn = test_conn();
    historical(&mut conn, golden());
    conn.execute(
        "INSERT INTO collections(id,name,created_at) VALUES ('unlogged','Keep','old')",
        [],
    )
    .unwrap();
    run_migrations(&mut conn).unwrap();
    let before = snapshot(&mut conn);
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
        1
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT name FROM collections"),
        "Keep"
    );
    run_migrations(&mut conn).unwrap();
    assert_eq!(snapshot(&mut conn), before);
    let mut conn = test_conn();
    historical(&mut conn, json!({}));
    assert!(run_migrations(&mut conn).is_err());
    assert_eq!(
        scalar::<i64>(&conn, "SELECT MAX(version) FROM schema_migrations"),
        34
    );
    assert!(!table_exists(&conn, "context_bundles"));
}

#[test]
fn incomplete_checkpoint_upgrade_remains_stale_until_backfill_finishes() {
    let mut conn = test_conn();
    historical(&mut conn, golden());
    super::super::checkpoints::set_log_complete(&conn, false).unwrap();
    run_migrations(&mut conn).unwrap();
    assert!(super::super::events::projections_stale_conn(&conn).unwrap());
    assert!(finalize_staged_events_inner(&mut conn).unwrap().is_none());
    super::super::checkpoints::set_log_complete(&conn, true).unwrap();
    assert!(finalize_staged_events_inner(&mut conn).unwrap().is_some());
    assert!(!super::super::events::projections_stale_conn(&conn).unwrap());
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
        1
    );
}

#[test]
fn reopening_sqlite_retains_exact_version_and_source_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    commit_events_inner(&mut conn, &[publication("p", 1000, golden())]).unwrap();
    let before = snapshot(&mut conn);
    drop(conn);
    let mut reopened = Connection::open(&path).unwrap();
    register_sql_functions(&reopened).unwrap();
    run_migrations(&mut reopened).unwrap();
    assert_eq!(snapshot(&mut reopened), before);
}
