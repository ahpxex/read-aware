use super::super::{
    apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
};
use super::*;
use serde_json::{json, Value};

fn prepare(conn: &mut Connection) {
    apply_connection_pragmas(conn).unwrap();
    register_sql_functions(conn).unwrap();
    run_migrations(conn).unwrap();
    conn.execute("INSERT INTO local_device(id,device_id,created_at,last_opened_at) VALUES(1,'test','old','old')", []).unwrap();
}

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    prepare(&mut conn);
    conn
}

fn event(id: &str, payload: Value, counter: i64) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: "profile.updated".into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: None,
        aggregate_id: None,
        actor_id: None,
        origin: Some("system".into()),
        created_at: None,
        payload,
    }
}

fn legacy(conn: &Connection, summary: &str) {
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES(?1,?2,'old')",
        rusqlite::params![LEGACY_KEY, summary],
    )
    .unwrap();
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn snapshot(conn: &mut Connection) -> ProfileSnapshot {
    profile_inspect_inner(conn).unwrap()
}

fn change(conn: &mut Connection, id: &str, summary: &str, counter: i64) -> ProfileMutationReceipt {
    let revision = snapshot(conn).revision;
    profile_commit_inner(
        conn,
        &event(id, json!({"summary": summary}), counter),
        &revision,
    )
    .unwrap()
}

#[test]
fn initialization_mints_one_event_from_durable_bytes_and_retries_idempotently() {
    let mut conn = db();
    let absent = snapshot(&mut conn);
    let text = "legacy\n\"quoted\"\\path";
    legacy(&conn, text);
    assert_eq!(
        profile_inspect_inner(&mut conn).unwrap_err().code,
        "memory/conflict"
    );
    assert_eq!(
        profile_commit_inner(
            &mut conn,
            &event("early", json!({"summary":"new"}), 1),
            &absent.revision
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    let envelope = event("migration", json!({}), 2);
    let result = profile_initialize_inner(&mut conn, &envelope).unwrap();
    assert!(result.migrated);
    assert_eq!(result.snapshot.summary.as_deref(), Some(text));
    assert!(legacy_summary(&conn).unwrap().is_none());
    assert_eq!(count(&conn, "domain_events"), 1);
    assert_eq!(count(&conn, "event_sync_state"), 1);
    let row: (String, String) = conn
        .query_row("SELECT payload_json,origin FROM domain_events", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&row.0).unwrap(),
        json!({"summary":text})
    );
    assert_eq!(row.1, "system");
    let again = profile_initialize_inner(&mut conn, &envelope).unwrap();
    assert!(!again.migrated);
    assert_eq!(again.snapshot.revision, result.snapshot.revision);
    assert_eq!(count(&conn, "domain_events"), 1);
}

#[test]
fn prior_summary_decisions_including_clear_win_but_name_only_does_not() {
    for (payload, expected, migrated) in [
        (json!({"summary":"event"}), Some("event"), false),
        (json!({"summary":""}), Some(""), false),
        (json!({"summary":null}), None, false),
        (
            json!({"displayName":"Reader","traits":{"a":1}}),
            Some("legacy"),
            true,
        ),
    ] {
        let mut conn = db();
        commit_events_inner(&mut conn, &[event("prior", payload, 1)]).unwrap();
        legacy(&conn, "legacy");
        let result =
            profile_initialize_inner(&mut conn, &event("migration", json!({}), 2)).unwrap();
        assert_eq!(result.migrated, migrated);
        assert_eq!(result.snapshot.summary.as_deref(), expected);
        assert!(legacy_summary(&conn).unwrap().is_none());
        assert_eq!(count(&conn, "domain_events"), if migrated { 2 } else { 1 });
        if migrated {
            let fields: (String, String) = conn
                .query_row(
                    "SELECT display_name,traits_json FROM user_profile",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(fields, ("Reader".into(), "{\"a\":1}".into()));
        }
    }
}

#[test]
fn initialization_keeps_absent_empty_and_oversized_historical_summaries_distinct() {
    let mut conn = db();
    let absent = profile_initialize_inner(&mut conn, &event("unused", json!({}), 1)).unwrap();
    assert!(!absent.migrated);
    assert!(absent.snapshot.summary.is_none());
    assert_eq!(count(&conn, "domain_events"), 0);
    for text in [String::new(), "x".repeat(SUMMARY_LIMIT + 1)] {
        let mut conn = db();
        legacy(&conn, &text);
        let result =
            profile_initialize_inner(&mut conn, &event("migration", json!({}), 1)).unwrap();
        assert!(result.migrated);
        assert_eq!(result.snapshot.summary, Some(text));
        assert_ne!(result.snapshot.revision, absent.snapshot.revision);
    }
}

#[test]
fn initialization_sql_failures_roll_back_event_outbox_and_key_retirement() {
    for trigger in [
        "CREATE TRIGGER fail BEFORE INSERT ON user_profile BEGIN SELECT RAISE(ABORT,'profile fault'); END;",
        "CREATE TRIGGER fail BEFORE INSERT ON event_sync_state BEGIN SELECT RAISE(ABORT,'outbox fault'); END;",
        "CREATE TRIGGER fail BEFORE DELETE ON app_kv BEGIN SELECT RAISE(ABORT,'key retirement fault'); END;",
    ] {
        let mut conn = db();
        legacy(&conn, "keep me");
        conn.execute_batch(trigger).unwrap();
        let envelope = event("migration", json!({}), 1);
        assert!(profile_initialize_inner(&mut conn, &envelope).is_err());
        assert_eq!(legacy_summary(&conn).unwrap().as_deref(), Some("keep me"));
        for table in ["domain_events", "event_sync_state", "user_profile"] {
            assert_eq!(count(&conn, table), 0);
        }
        conn.execute_batch("DROP TRIGGER fail").unwrap();
        assert!(profile_initialize_inner(&mut conn, &envelope).unwrap().migrated);
    }
}

#[test]
fn initialization_waits_for_complete_history_and_fresh_projection() {
    let mut conn = db();
    legacy(&conn, "legacy");
    let envelope = event("migration", json!({}), 2);
    checkpoints::set_log_complete(&conn, false).unwrap();
    assert_eq!(
        profile_initialize_inner(&mut conn, &envelope)
            .unwrap_err()
            .code,
        "sync/log-incomplete"
    );
    commit_events_inner(
        &mut conn,
        &[event("backfilled-clear", json!({"summary":null}), 1)],
    )
    .unwrap();
    checkpoints::set_log_complete(&conn, true).unwrap();
    events::set_projections_stale_conn(&conn, true).unwrap();
    assert_eq!(
        profile_initialize_inner(&mut conn, &envelope)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(legacy_summary(&conn).unwrap().as_deref(), Some("legacy"));
    events::set_projections_stale_conn(&conn, false).unwrap();
    let result = profile_initialize_inner(&mut conn, &envelope).unwrap();
    assert!(!result.migrated);
    assert!(result.snapshot.summary.is_none());
    assert_eq!(count(&conn, "domain_events"), 1);
}

#[test]
fn revisions_match_javascript_json_hashes_and_equal_text_write_is_a_noop() {
    let mut conn = db();
    assert_eq!(
        snapshot(&mut conn).revision,
        "profile2:95cb9b4f84ceff132cc7a875d8c192bf4997016a939ee64141c1fd628c0e8738"
    );
    let empty = change(&mut conn, "empty", "", 1);
    assert!(empty.changed);
    assert_eq!(empty.persistence, "event-log");
    assert_eq!(
        empty.revision,
        "profile2:2752489527d1a5bf09b2a33bc0717669fee43cd4be25e647da573d7e9c94be05"
    );
    let no_op = change(&mut conn, "unused", "", 2);
    assert!(!no_op.changed);
    assert_eq!(no_op.revision, empty.revision);
    assert_eq!(count(&conn, "domain_events"), 1);
    let unicode = change(
        &mut conn,
        "unicode",
        "line\n\"\\\0\u{2028}\u{2029}\u{1f642}",
        3,
    );
    assert_eq!(
        unicode.revision,
        "profile2:5ee26de549c1b20e5e0a6ab3b628ccaa991fc5aa03bcd302cb5af046519abdbc"
    );
}

#[test]
fn event_identity_rejects_aba_and_other_profile_field_changes() {
    let mut conn = db();
    let old = change(&mut conn, "a", "A", 1);
    change(&mut conn, "b", "B", 2);
    change(&mut conn, "a-again", "A", 3);
    let attempt = event("attempt", json!({"summary":"C"}), 5);
    assert_eq!(
        profile_commit_inner(&mut conn, &attempt, &old.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let current = snapshot(&mut conn).revision;
    commit_events_inner(
        &mut conn,
        &[event("trait", json!({"traits":{"theme":"quiet"}}), 4)],
    )
    .unwrap();
    assert_eq!(
        profile_commit_inner(&mut conn, &attempt, &current)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(snapshot(&mut conn).summary.as_deref(), Some("A"));
    assert_eq!(count(&conn, "domain_events"), 4);
}

#[test]
fn two_connections_cannot_commit_decisions_from_the_same_revision() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut first = Connection::open(&path).unwrap();
    prepare(&mut first);
    let mut second = Connection::open(&path).unwrap();
    apply_connection_pragmas(&second).unwrap();
    register_sql_functions(&second).unwrap();
    let observed = snapshot(&mut second).revision;
    change(&mut first, "winner", "New", 1);
    assert_eq!(
        profile_commit_inner(
            &mut second,
            &event("late", json!({"summary":"Late"}), 2),
            &observed
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    assert_eq!(snapshot(&mut second).summary.as_deref(), Some("New"));
    assert_eq!(count(&first, "domain_events"), 1);
}

#[test]
fn edit_sql_failure_rolls_back_and_reuses_the_uncommitted_decision() {
    let mut conn = db();
    let old = change(&mut conn, "original", "Original", 1);
    conn.execute_batch("CREATE TRIGGER fail BEFORE UPDATE ON user_profile BEGIN SELECT RAISE(ABORT,'profile fault'); END;").unwrap();
    let mut edit = event("edit", json!({"summary":"New"}), 2);
    edit.origin = Some("plugin:memory-desk".into());
    assert!(profile_commit_inner(&mut conn, &edit, &old.revision).is_err());
    assert_eq!(snapshot(&mut conn).revision, old.revision);
    assert_eq!(count(&conn, "domain_events"), 1);
    assert_eq!(count(&conn, "event_sync_state"), 1);
    conn.execute_batch("DROP TRIGGER fail").unwrap();
    assert!(
        profile_commit_inner(&mut conn, &edit, &old.revision)
            .unwrap()
            .changed
    );
    let origin: String = conn
        .query_row(
            "SELECT origin FROM domain_events WHERE id='edit'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(origin, "plugin:memory-desk");
}

#[test]
fn normal_edits_count_utf16_and_restore_keeps_large_archive_text_without_actor_override() {
    let mut conn = db();
    let limit = "\u{1f642}".repeat(SUMMARY_LIMIT / 2);
    change(&mut conn, "limit", &limit, 1);
    let revision = snapshot(&mut conn).revision;
    let mut oversized = event("archive", json!({"summary":format!("{limit}x")}), 2);
    assert_eq!(
        profile_commit_inner(&mut conn, &oversized, &revision)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    for origin in ["system", "agent", "plugin:memory-desk"] {
        oversized.origin = Some(origin.into());
        assert_eq!(
            profile_restore_inner(&mut conn, &oversized, &revision)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    oversized.origin = Some("user".into());
    assert!(
        profile_restore_inner(&mut conn, &oversized, &revision)
            .unwrap()
            .changed
    );
    assert_eq!(
        snapshot(&mut conn).summary.unwrap().encode_utf16().count(),
        SUMMARY_LIMIT + 1
    );
    let mut stale_restore = oversized.clone();
    stale_restore.id = "late-restore".into();
    stale_restore.hlc.counter = 3;
    assert_eq!(
        profile_restore_inner(&mut conn, &stale_restore, &revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
}

#[test]
fn malformed_payloads_revisions_and_envelopes_never_append() {
    let mut conn = db();
    let revision = snapshot(&mut conn).revision;
    for payload in [
        json!(null),
        json!([]),
        json!({}),
        json!({"summary":null}),
        json!({"summary":42}),
        json!({"summary":"x","traits":{}}),
        json!({"summary":"x","allowLarge":true}),
    ] {
        assert_eq!(
            profile_commit_inner(&mut conn, &event("bad", payload, 1), &revision)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    let valid = event("valid", json!({"summary":"x"}), 1);
    for token in [
        "",
        "profile1:abc",
        "profile2:no",
        &format!("profile2:{}", "A".repeat(64)),
    ] {
        assert_eq!(
            profile_commit_inner(&mut conn, &valid, token)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    for alter in [
        |e: &mut EventRow| e.id.clear(),
        |e: &mut EventRow| e.event_type = "entity.resolved".into(),
        |e: &mut EventRow| e.aggregate_type = Some("profile".into()),
        |e: &mut EventRow| e.aggregate_id = Some("local".into()),
        |e: &mut EventRow| e.actor_id = Some("peer".into()),
        |e: &mut EventRow| e.schema_version = Some(2),
        |e: &mut EventRow| e.origin = None,
        |e: &mut EventRow| e.origin = Some("plugin:".into()),
        |e: &mut EventRow| e.hlc.counter = -1,
        |e: &mut EventRow| e.hlc.wall_ms = 9_007_199_254_740_992,
        |e: &mut EventRow| e.hlc.device_id = "peer".into(),
    ] {
        let mut bad = valid.clone();
        alter(&mut bad);
        assert_eq!(
            profile_commit_inner(&mut conn, &bad, &revision)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 0);
}

#[test]
fn migration_rejects_caller_supplied_summary_and_non_system_origin() {
    let mut conn = db();
    legacy(&conn, "durable");
    let mut envelope = event("migration", json!({"summary":"caller cache"}), 1);
    assert_eq!(
        profile_initialize_inner(&mut conn, &envelope)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    envelope.payload = json!({});
    envelope.origin = Some("user".into());
    assert_eq!(
        profile_initialize_inner(&mut conn, &envelope)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    assert_eq!(legacy_summary(&conn).unwrap().as_deref(), Some("durable"));
    assert_eq!(count(&conn, "domain_events"), 0);
}

#[test]
fn stale_projections_duplicate_ids_and_past_log_clocks_cannot_commit() {
    let mut conn = db();
    change(&mut conn, "seed", "Original", 2);
    let revision = snapshot(&mut conn).revision;
    events::set_projections_stale_conn(&conn, true).unwrap();
    let edit = event("new", json!({"summary":"New"}), 3);
    assert_eq!(
        profile_inspect_inner(&mut conn).unwrap_err().code,
        "memory/conflict"
    );
    assert_eq!(
        profile_commit_inner(&mut conn, &edit, &revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    events::set_projections_stale_conn(&conn, false).unwrap();
    let mut duplicate = edit.clone();
    duplicate.id = "seed".into();
    assert_eq!(
        profile_commit_inner(&mut conn, &duplicate, &revision)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    for counter in [1, 2] {
        let past = event("past", json!({"summary":"Past"}), counter);
        assert_eq!(
            profile_commit_inner(&mut conn, &past, &revision)
                .unwrap_err()
                .code,
            "memory/conflict"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 1);
}

#[test]
fn bootstrap_snapshot_keeps_revision_and_rejects_events_before_its_frontier() {
    let mut source = db();
    let committed = change(&mut source, "profile", "Synced", 3);
    let dir = tempfile::tempdir().unwrap();
    let info = checkpoints::create_checkpoint(&mut source, dir.path(), "local", Some(1)).unwrap();
    let mut target = db();
    let target_dir = tempfile::tempdir().unwrap();
    let (path, _) = super::super::get_blob_record_inner(&source, dir.path(), &info.blob_key)
        .unwrap()
        .unwrap();
    super::super::put_blob_inner(
        &target,
        target_dir.path(),
        &info.blob_key,
        Some("application/vnd.sqlite3"),
        &std::fs::read(path).unwrap(),
    )
    .unwrap();
    checkpoints::restore_bootstrap_checkpoint(&mut target, target_dir.path(), &info.blob_key)
        .unwrap();
    assert!(!checkpoints::log_complete(&target).unwrap());
    assert_eq!(count(&target, "domain_events"), 0);
    assert_eq!(snapshot(&mut target).revision, committed.revision);
    let past = event("past", json!({"summary":"Past"}), 2);
    assert_eq!(
        profile_commit_inner(&mut target, &past, &committed.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let next = event("next", json!({"summary":"Next"}), 4);
    assert!(
        profile_commit_inner(&mut target, &next, &committed.revision)
            .unwrap()
            .changed
    );
    assert_eq!(count(&target, "domain_events"), 1);
}

#[test]
fn migration_rejects_old_clock_without_retiring_the_durable_key() {
    let mut conn = db();
    commit_events_inner(
        &mut conn,
        &[event("name", json!({"displayName":"Reader"}), 5)],
    )
    .unwrap();
    legacy(&conn, "Legacy");
    assert_eq!(
        profile_initialize_inner(&mut conn, &event("migration", json!({}), 4))
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(legacy_summary(&conn).unwrap().as_deref(), Some("Legacy"));
    assert_eq!(count(&conn, "domain_events"), 1);
    assert!(
        profile_initialize_inner(&mut conn, &event("migration", json!({}), 6))
            .unwrap()
            .migrated
    );
}

#[test]
fn initialized_and_edited_summary_replays_to_the_same_revision() {
    let mut conn = db();
    legacy(&conn, "Original");
    profile_initialize_inner(&mut conn, &event("migration", json!({}), 1)).unwrap();
    let committed = change(&mut conn, "edited", "Edited", 2);
    let tx = conn.transaction().unwrap();
    events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut conn).revision, committed.revision);
    assert_eq!(snapshot(&mut conn).summary.as_deref(), Some("Edited"));
    assert!(legacy_summary(&conn).unwrap().is_none());
    assert_eq!(count(&conn, "domain_events"), 2);
}
