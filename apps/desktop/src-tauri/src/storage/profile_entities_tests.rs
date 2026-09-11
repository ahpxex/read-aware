use super::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const TABLES: &[&str] = &[
    "user_profile",
    "entities",
    "entity_aliases",
    "entity_redirects",
];
fn snapshot(conn: &mut Connection) -> BTreeMap<String, BTreeMap<String, i64>> {
    let tx = conn.transaction().unwrap();
    apply::DIFF_SPECS
        .iter()
        .filter(|spec| TABLES.contains(&spec.table))
        .map(|spec| {
            (
                spec.table.into(),
                super::super::events::snapshot_table(&tx, spec).unwrap(),
            )
        })
        .collect()
}
fn resolve(id: &str, wall: i64, entity: &str, name: &str) -> EventRow {
    ev(
        id,
        wall,
        "entity.resolved",
        json!({"entityId":entity,"kind":"person","canonicalName":name,"aliases":[name,"Alias"]}),
    )
}
fn merge(id: &str, wall: i64, keep: &str, merged: &str) -> EventRow {
    ev(
        id,
        wall,
        "entity.merged",
        json!({"keepId":keep,"mergedId":merged}),
    )
}
fn sample() -> Vec<EventRow> {
    vec![
        ev(
            "p1",
            1000,
            "profile.updated",
            json!({"displayName":"Reader","summary":"Summary","traits":{"language":"en","nested":{"a":1}}}),
        ),
        resolve("a1", 1001, "a", "First"),
        resolve("b1", 1002, "b", "Keeper"),
        merge("m1", 1003, "b", "a"),
        resolve("a2", 1004, "a", "Late member name"),
        merge("m2", 1005, "c", "a"),
        resolve("c1", 1006, "c", "Final keeper"),
    ]
}

#[test]
fn profile_patches_preserve_omissions_and_distinguish_empty_text_from_clear() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &sample()[..1]).unwrap();
    commit_events_inner(
        &mut conn,
        &[ev(
            "p2",
            2000,
            "profile.updated",
            json!({"summary":"","traits":{"language":null,"nested":{"b":2},"new":false}}),
        )],
    )
    .unwrap();
    let row: (Option<String>, Option<String>, String, String, String) = conn
        .query_row(
            "SELECT display_name,summary,traits_json,created_at,updated_event_id FROM user_profile",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(row.0.as_deref(), Some("Reader"));
    assert_eq!(row.1.as_deref(), Some(""));
    assert_eq!(
        serde_json::from_str::<Value>(&row.2).unwrap(),
        json!({"nested":{"b":2},"new":false})
    );
    assert_eq!(row.3, apply::iso_from_millis(1000));
    assert_eq!(row.4, "p2");
    commit_events_inner(
        &mut conn,
        &[ev(
            "p3",
            3000,
            "profile.updated",
            json!({"summary":null,"displayName":null}),
        )],
    )
    .unwrap();
    assert!(scalar::<Option<String>>(&conn, "SELECT summary FROM user_profile").is_none());
    assert!(scalar::<Option<String>>(&conn, "SELECT display_name FROM user_profile").is_none());
    assert_eq!(scalar::<i64>(&conn, "SELECT count(*) FROM user_profile"), 1);
}

#[test]
fn entity_classes_keep_definitions_and_aliases_without_cycles_or_resurrection() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &sample()).unwrap();
    assert_eq!(
        scalar::<String>(&conn, "SELECT canonical_name FROM entities WHERE id='b'"),
        "Keeper"
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT canonical_name FROM entities WHERE id='c'"),
        "Final keeper"
    );
    assert_eq!(
        scalar::<i64>(
            &conn,
            "SELECT count(*) FROM entity_redirects WHERE keep_id='c'"
        ),
        2
    );
    assert_eq!(
        scalar::<i64>(
            &conn,
            "SELECT count(*) FROM entity_aliases WHERE entity_id='a'"
        ),
        3
    );
    let before = snapshot(&mut conn);
    let report = commit_events_inner(
        &mut conn,
        &[
            merge("reverse", 2000, "a", "c"),
            merge("duplicate", 2001, "b", "a"),
        ],
    )
    .unwrap();
    assert_eq!(report.appended, 2);
    assert_eq!(report.applied, 0);
    assert_eq!(snapshot(&mut conn), before);
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
}

#[test]
fn merges_before_resolution_keep_pending_root_without_inventing_a_definition() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[
            merge("m", 1000, "keeper", "member"),
            resolve("r", 1001, "member", "Member"),
        ],
    )
    .unwrap();
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM entities WHERE id='keeper'"),
        0
    );
    assert_eq!(
        scalar::<String>(
            &conn,
            "SELECT keep_id FROM entity_redirects WHERE merged_id='member'"
        ),
        "keeper"
    );
    commit_events_inner(&mut conn, &[resolve("k", 1002, "keeper", "Keeper")]).unwrap();
    assert_eq!(
        scalar::<String>(
            &conn,
            "SELECT canonical_name FROM entities WHERE id='keeper'"
        ),
        "Keeper"
    );
}

#[test]
fn malformed_known_payloads_roll_back_projections_log_and_outbox() {
    for (kind, payload) in [
        ("profile.updated", json!({"displayName":42})),
        ("profile.updated", json!({"summary":[]})),
        ("profile.updated", json!({"traits":null})),
        ("profile.updated", json!([])),
        (
            "entity.resolved",
            json!({"entityId":"a","kind":"person","canonicalName":"Name","aliases":[42]}),
        ),
        (
            "entity.resolved",
            json!({"entityId":"a","kind":"person","canonicalName":"Name","aliases":"bad"}),
        ),
        ("entity.merged", json!({"keepId":"","mergedId":"b"})),
    ] {
        let mut conn = migrated_conn();
        let error = commit_events_inner(
            &mut conn,
            &[sample().remove(0), ev("bad", 2000, kind, payload)],
        )
        .unwrap_err();
        assert_eq!(error.code, "memory/invalid-input");
        for table in [
            "user_profile",
            "entities",
            "entity_aliases",
            "entity_redirects",
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
fn late_remote_arrivals_replay_to_the_same_profile_and_identity_graph() {
    let events = sample();
    let mut ordered = migrated_conn();
    let mut reversed = migrated_conn();
    commit_events_inner(&mut ordered, &events).unwrap();
    for event in events.iter().rev() {
        apply_remote_events_inner(&mut reversed, &[event.clone()]).unwrap();
    }
    assert_eq!(snapshot(&mut reversed), snapshot(&mut ordered));
    assert_eq!(
        scalar::<i64>(&reversed, "SELECT count(*) FROM event_sync_state"),
        0
    );
    assert_eq!(
        apply_remote_events_inner(&mut reversed, &events)
            .unwrap()
            .appended,
        0
    );
}

#[test]
fn checkpoints_restore_all_identity_tables_without_cascading_away_aliases() {
    let mut conn = migrated_conn();
    let dir = tempfile::tempdir().unwrap();
    commit_events_inner(&mut conn, &sample()).unwrap();
    let before = snapshot(&mut conn);
    let info =
        super::super::checkpoints::create_checkpoint(&mut conn, dir.path(), "local", None).unwrap();
    assert_eq!(info.schema_version, super::super::schema::SCHEMA_VERSION);
    commit_events_inner(&mut conn, &[resolve("new", 2000, "a", "Newer")]).unwrap();
    let tx = conn.transaction().unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, dir.path(), &info).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
    for table in apply::DERIVED_TABLES {
        conn.execute(&format!("DELETE FROM {table}"), []).unwrap();
    }
    let tx = conn.transaction().unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, dir.path(), &info).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
}

#[test]
fn verification_detects_drift_and_wipe_removes_new_tables() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &sample()).unwrap();
    let before = snapshot(&mut conn);
    conn.execute("UPDATE user_profile SET summary='Unlogged'", [])
        .unwrap();
    conn.execute("UPDATE entity_redirects SET keep_id='Unlogged'", [])
        .unwrap();
    assert_ne!(snapshot(&mut conn), before);
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn), before);
    let dir = tempfile::tempdir().unwrap();
    super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    for rows in snapshot(&mut conn).values() {
        assert!(rows.is_empty());
    }
}

fn historical(conn: &mut Connection, events: &[EventRow]) {
    super::super::schema::run_migrations_up_to(conn, 32).unwrap();
    let tx = conn.transaction().unwrap();
    for event in events {
        super::super::events::insert_event_row(
            &tx,
            event,
            super::super::events::EventSource::Local,
        )
        .unwrap();
    }
    tx.commit().unwrap();
}

#[test]
fn migration_backfills_old_events_without_rewriting_unrelated_or_local_rows() {
    let mut conn = test_conn();
    historical(&mut conn, &sample());
    conn.execute(
        "INSERT INTO app_kv (key,value_json,updated_at) VALUES ('read-aware-agent-profile','legacy summary','old')",
        [],
    )
    .unwrap();
    conn.execute("INSERT INTO collections(id,name,created_at) VALUES ('unlogged','Keep','old')", []).unwrap();
    run_migrations(&mut conn).unwrap();
    let mut expected = migrated_conn();
    commit_events_inner(&mut expected, &sample()).unwrap();
    assert_eq!(snapshot(&mut conn), snapshot(&mut expected));
    assert_eq!(
        scalar::<String>(&conn, "SELECT name FROM collections WHERE id='unlogged'"),
        "Keep"
    );
    assert_eq!(
        scalar::<String>(
            &conn,
            "SELECT value_json FROM app_kv WHERE key='read-aware-agent-profile'"
        ),
        "legacy summary"
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM domain_events"),
        sample().len() as i64
    );
    run_migrations(&mut conn).unwrap();
    assert_eq!(snapshot(&mut conn), snapshot(&mut expected));
}

#[test]
fn failed_historical_projection_does_not_commit_the_migration() {
    let mut conn = test_conn();
    historical(&mut conn, &[ev("bad", 1000, "entity.merged", json!({}))]);
    assert!(run_migrations(&mut conn).is_err());
    assert_eq!(
        scalar::<i64>(&conn, "SELECT MAX(version) FROM schema_migrations"),
        32
    );
    assert!(!table_exists(&conn, "user_profile"));
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM domain_events"),
        1
    );
}

#[test]
fn incomplete_bootstrap_upgrade_stays_stale_until_full_history_can_replay() {
    let mut conn = test_conn();
    historical(&mut conn, &sample());
    super::super::checkpoints::set_log_complete(&conn, false).unwrap();
    run_migrations(&mut conn).unwrap();
    assert!(super::super::events::projections_stale_conn(&conn).unwrap());
    assert!(finalize_staged_events_inner(&mut conn).unwrap().is_none());
    super::super::checkpoints::set_log_complete(&conn, true).unwrap();
    assert!(finalize_staged_events_inner(&mut conn).unwrap().is_some());
    assert!(!super::super::events::projections_stale_conn(&conn).unwrap());
    assert_eq!(scalar::<i64>(&conn, "SELECT count(*) FROM entities"), 3);
}
