use super::super::{
    apply_connection_pragmas, commit_events_inner, entity_mutations::entity_commit_inner,
    entity_queries::entity_query_inner, register_sql_functions, run_migrations, EventRow, Hlc,
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
fn event(id: &str, kind: &str, payload: Value, counter: i64) -> EventRow {
    let target = if kind == "entity.resolved" {
        "entityId"
    } else {
        "keepId"
    };
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: Some("entity".into()),
        aggregate_id: payload
            .get(target)
            .and_then(Value::as_str)
            .map(str::to_owned),
        actor_id: None,
        origin: Some("plugin:identity".into()),
        created_at: None,
        payload,
    }
}
fn resolve(id: &str, member: &str, name: &str, counter: i64) -> EventRow {
    event(
        id,
        "entity.resolved",
        json!({"entityId":member,"kind":"person","canonicalName":name,"aliases":["Shared alias", name]}),
        counter,
    )
}
fn merge(id: &str, keep: &str, merged: &str, counter: i64) -> EventRow {
    event(
        id,
        "entity.merged",
        json!({"keepId":keep,"mergedId":merged}),
        counter,
    )
}
fn commit(
    conn: &mut Connection,
    event: &EventRow,
) -> super::super::entity_mutations::EntityMutationReceipt {
    let token = revision(conn).unwrap();
    entity_commit_inner(conn, event, &token).unwrap()
}
fn page(conn: &mut Connection, query: Value) -> Value {
    serde_json::to_value(entity_query_inner(conn, &query).unwrap()).unwrap()
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn identity_pages_resolve_classes_and_search_members_and_aliases_literally() {
    let mut conn = db();
    commit(&mut conn, &resolve("a1", "a", "Original", 1));
    commit(&mut conn, &resolve("b1", "b", "Keeper", 2));
    commit(&mut conn, &resolve("c1", "c", "Third", 3));
    commit(&mut conn, &merge("m", "b", "a", 4));
    let first = page(&mut conn, json!({"kind":"identities","limit":1}));
    assert_eq!(first["total"], 2);
    assert_eq!(first["nextOffset"], 1);
    assert_eq!(
        first["items"],
        json!([{"id":"b","definition":{"kind":"person","canonicalName":"Keeper"}}])
    );
    let next = page(
        &mut conn,
        json!({"kind":"identities","limit":1,"offset":1,"expectedRevision":first["revision"]}),
    );
    assert_eq!(next["items"][0]["id"], "c");
    assert!(next["nextOffset"].is_null());
    for search in ["ORIGINAL", "Original", "a"] {
        let found = page(&mut conn, json!({"kind":"identities","search":search}));
        assert!(found["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == "b"));
    }
    assert_eq!(
        page(
            &mut conn,
            json!({"kind":"identities","search":"shared alias"})
        )["total"],
        2
    );
    for search in ["%", "_", "' OR 1=1 --"] {
        assert_eq!(
            page(&mut conn, json!({"kind":"identities","search":search}))["total"],
            0
        );
    }
}

#[test]
fn members_keep_original_definitions_and_alias_pages_keep_ownership() {
    let mut conn = db();
    commit(&mut conn, &resolve("a1", "a", "Original", 1));
    commit(&mut conn, &resolve("b1", "b", "Keeper", 2));
    commit(&mut conn, &merge("m", "b", "a", 3));
    let late = commit(&mut conn, &resolve("a2", "a", "Late member name", 4));
    assert_eq!(late.entity_id, "a");
    assert_eq!(late.canonical_id, "b");
    let members = page(&mut conn, json!({"kind":"members","entityId":"a"}));
    assert_eq!(members["canonicalId"], "b");
    assert_eq!(
        members["canonicalDefinition"],
        json!({"kind":"person","canonicalName":"Keeper"})
    );
    let first = page(
        &mut conn,
        json!({"kind":"members","entityId":"a","limit":1}),
    );
    assert_eq!(first["items"][0]["id"], "a");
    assert_eq!(first["canonicalDefinition"], members["canonicalDefinition"]);
    assert_eq!(
        members["items"],
        json!([
            {"id":"a","definition":{"kind":"person","canonicalName":"Late member name"}},
            {"id":"b","definition":{"kind":"person","canonicalName":"Keeper"}},
        ])
    );
    let aliases = page(
        &mut conn,
        json!({"kind":"aliases","entityId":"a","limit":2}),
    );
    assert_eq!(aliases["total"], 5);
    assert_eq!(
        aliases["canonicalDefinition"],
        members["canonicalDefinition"]
    );
    assert_eq!(aliases["nextOffset"], 2);
    let rest = page(
        &mut conn,
        json!({"kind":"aliases","entityId":"b","offset":2,"expectedRevision":aliases["revision"]}),
    );
    assert_eq!(
        rest["items"],
        json!([
            {"entityId":"a","alias":"Original"}, {"entityId":"a","alias":"Shared alias"}, {"entityId":"b","alias":"Shared alias"},
        ])
    );
    assert!(rest["nextOffset"].is_null());
}

#[test]
fn pending_roots_are_explicit_but_unknown_queries_never_invent_identities() {
    let mut conn = db();
    commit_events_inner(&mut conn, &[merge("historic", "pending", "member", 1)]).unwrap();
    assert_eq!(
        page(&mut conn, json!({"kind":"identities"}))["items"],
        json!([{"id":"pending","definition":null}])
    );
    let members = page(&mut conn, json!({"kind":"members","entityId":"member"}));
    assert!(members["canonicalDefinition"].is_null());
    assert_eq!(
        members["items"],
        json!([{"id":"member","definition":null},{"id":"pending","definition":null}])
    );
    for kind in ["members", "aliases"] {
        let unknown = page(&mut conn, json!({"kind":kind,"entityId":"unknown"}));
        assert!(unknown["canonicalId"].is_null());
        assert!(unknown["canonicalDefinition"].is_null());
        assert_eq!(unknown["items"], json!([]));
        assert_eq!(unknown["total"], 0);
    }
    assert_eq!(count(&conn, "entities"), 0);
}

#[test]
fn conditional_merges_require_known_resolved_roots_and_equivalent_classes_are_noops() {
    let mut conn = db();
    commit(&mut conn, &resolve("a1", "a", "A", 1));
    let old = revision(&conn).unwrap();
    assert_eq!(
        entity_commit_inner(&mut conn, &merge("missing", "a", "typo", 2), &old)
            .unwrap_err()
            .code,
        "memory/not-found"
    );
    commit_events_inner(&mut conn, &[merge("historic", "pending", "member", 2)]).unwrap();
    let token = revision(&conn).unwrap();
    assert_eq!(
        entity_commit_inner(&mut conn, &merge("pending", "a", "member", 3), &token)
            .unwrap_err()
            .code,
        "memory/not-found"
    );
    commit(&mut conn, &resolve("p", "pending", "Resolved", 3));
    let merged = commit(&mut conn, &merge("merge", "a", "member", 4));
    assert!(merged.changed);
    let reverse = commit(&mut conn, &merge("reverse", "member", "a", 5));
    assert!(!reverse.changed);
    assert_eq!(reverse.revision, merged.revision);
    assert_eq!(reverse.canonical_id, "a");
    assert_eq!(count(&conn, "domain_events"), 4);
    assert_eq!(count(&conn, "entity_redirects"), 2);
}

#[test]
fn identical_resolution_is_noop_but_new_aliases_change_the_revision() {
    let mut conn = db();
    let first = commit(&mut conn, &resolve("first", "a", "A", 1));
    let noop = commit(&mut conn, &resolve("same", "a", "A", 2));
    assert!(!noop.changed);
    assert_eq!(noop.revision, first.revision);
    let add = event(
        "alias",
        "entity.resolved",
        json!({"entityId":"a","kind":"person","canonicalName":"A","aliases":["New","New"]}),
        3,
    );
    let changed = commit(&mut conn, &add);
    assert!(changed.changed);
    assert_ne!(changed.revision, first.revision);
    assert_eq!(count(&conn, "entity_aliases"), 3);
    assert_eq!(count(&conn, "domain_events"), 2);
    assert_eq!(count(&conn, "event_sync_state"), 2);
}

#[test]
fn registry_identity_rejects_aba_stale_pages_and_old_decisions() {
    let mut conn = db();
    let first = commit(&mut conn, &resolve("first", "a", "A", 1));
    commit(&mut conn, &resolve("away", "a", "B", 2));
    commit(&mut conn, &resolve("back", "a", "A", 3));
    assert_ne!(revision(&conn).unwrap(), first.revision);
    assert_eq!(
        entity_query_inner(
            &mut conn,
            &json!({"kind":"identities","expectedRevision":first.revision})
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    assert_eq!(
        entity_commit_inner(&mut conn, &resolve("late", "a", "Late", 4), &first.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let before = revision(&conn).unwrap();
    // Equal bytes from a newly received event still invalidate an old decision.
    commit_events_inner(&mut conn, &[resolve("same-bytes-new-event", "a", "A", 4)]).unwrap();
    assert_ne!(revision(&conn).unwrap(), before);
    let fresh = revision(&conn).unwrap();
    let mut profile = event(
        "unrelated",
        "profile.updated",
        json!({"summary":"Other domain"}),
        5,
    );
    profile.aggregate_type = None;
    profile.aggregate_id = None;
    commit_events_inner(&mut conn, &[profile]).unwrap();
    assert_eq!(revision(&conn).unwrap(), fresh);
}

#[test]
fn two_sqlite_connections_cannot_commit_from_the_same_registry_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let mut first = Connection::open(&path).unwrap();
    prepare(&mut first);
    let mut second = Connection::open(&path).unwrap();
    apply_connection_pragmas(&second).unwrap();
    register_sql_functions(&second).unwrap();
    let observed = revision(&second).unwrap();
    commit(&mut first, &resolve("winner", "a", "A", 1));
    assert_eq!(
        entity_commit_inner(&mut second, &resolve("late", "b", "B", 2), &observed)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(count(&second, "entities"), 1);
}

#[test]
fn resolution_and_merge_failures_roll_back_log_outbox_and_all_projection_rows() {
    for trigger in [
        "CREATE TRIGGER fail BEFORE INSERT ON entity_aliases BEGIN SELECT RAISE(ABORT,'alias fault'); END;",
        "CREATE TRIGGER fail BEFORE INSERT ON event_sync_state BEGIN SELECT RAISE(ABORT,'outbox fault'); END;",
    ] {
        let mut conn = db();
        let observed = revision(&conn).unwrap();
        conn.execute_batch(trigger).unwrap();
        let change = resolve("change", "a", "A", 1);
        assert!(entity_commit_inner(&mut conn, &change, &observed).is_err());
        assert_eq!(revision(&conn).unwrap(), observed);
        for table in ["entities", "entity_aliases", "domain_events", "event_sync_state"] { assert_eq!(count(&conn, table), 0); }
        conn.execute_batch("DROP TRIGGER fail").unwrap();
        assert!(entity_commit_inner(&mut conn, &change, &observed).unwrap().changed);
    }
    let mut conn = db();
    commit(&mut conn, &resolve("a1", "a", "A", 1));
    commit(&mut conn, &resolve("b1", "b", "B", 2));
    commit(&mut conn, &resolve("c1", "c", "C", 3));
    commit(&mut conn, &merge("first", "b", "a", 4));
    let observed = revision(&conn).unwrap();
    conn.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON entity_redirects BEGIN SELECT RAISE(ABORT,'redirect fault'); END;").unwrap();
    assert!(entity_commit_inner(&mut conn, &merge("attempt", "c", "b", 5), &observed).is_err());
    assert_eq!(revision(&conn).unwrap(), observed);
    assert_eq!(root(&conn, "a").unwrap().as_deref(), Some("b"));
    assert_eq!(count(&conn, "domain_events"), 4);
    assert_eq!(count(&conn, "event_sync_state"), 4);
}

#[test]
fn queries_reject_injected_fields_invalid_modes_unpinned_offsets_and_excessive_limits() {
    let mut conn = db();
    for input in [
        json!(null),
        json!([]),
        json!({}),
        json!({"kind":"secrets"}),
        json!({"kind":"identities","entityId":"a"}),
        json!({"kind":"members","entityId":"a","search":"x"}),
        json!({"kind":"aliases"}),
        json!({"kind":"members","entityId":""}),
        json!({"kind":"identities","limit":0}),
        json!({"kind":"identities","limit":101}),
        json!({"kind":"identities","limit":1.5}),
        json!({"kind":"identities","limit":null}),
        json!({"kind":"identities","offset":1}),
        json!({"kind":"identities","offset":-1}),
        json!({"kind":"identities","expectedRevision":"bad"}),
        json!({"kind":"identities","search":"x".repeat(129)}),
        json!({"kind":"identities","confirmed":true}),
    ] {
        assert_eq!(
            entity_query_inner(&mut conn, &input).unwrap_err().code,
            "memory/invalid-query"
        );
    }
    let token = revision(&conn).unwrap();
    assert_eq!(
        entity_query_inner(
            &mut conn,
            &json!({"kind":"identities","offset":1,"expectedRevision":token})
        )
        .unwrap_err()
        .code,
        "memory/invalid-query"
    );
}

#[test]
fn decision_payloads_and_envelopes_are_narrow_and_cannot_spoof_authority() {
    let mut conn = db();
    let token = revision(&conn).unwrap();
    for payload in [
        json!({}),
        json!([]),
        json!({"entityId":"a","kind":"person"}),
        json!({"entityId":"a","kind":"","canonicalName":"A"}),
        json!({"entityId":"a","kind":"person","canonicalName":"A","aliases":null}),
        json!({"entityId":"a","kind":"person","canonicalName":"A","aliases":[42]}),
        json!({"entityId":"a","kind":"person","canonicalName":"A","aliases":[""]}),
        json!({"entityId":"a","kind":"person","canonicalName":"A","aliases":vec!["alias";33]}),
        json!({"entityId":"a","kind":"person","canonicalName":"A","scope":"user"}),
        json!({"entityId":"a","kind":"person","canonicalName":"x".repeat(513)}),
    ] {
        let candidate = event("bad", "entity.resolved", payload, 1);
        assert_eq!(
            entity_commit_inner(&mut conn, &candidate, &token)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    let valid = resolve("valid", "a", "A", 1);
    for alter in [
        |e: &mut EventRow| e.aggregate_id = Some("other".into()),
        |e: &mut EventRow| e.aggregate_type = None,
        |e: &mut EventRow| e.origin = None,
        |e: &mut EventRow| e.origin = Some("plugin:".into()),
        |e: &mut EventRow| e.actor_id = Some("other".into()),
        |e: &mut EventRow| e.schema_version = Some(2),
        |e: &mut EventRow| e.hlc.device_id = "other".into(),
    ] {
        let mut candidate = valid.clone();
        alter(&mut candidate);
        assert_eq!(
            entity_commit_inner(&mut conn, &candidate, &token)
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 0);
    let mut boundary = resolve("boundary", "a", &"\u{1f642}".repeat(256), 2);
    assert!(
        entity_commit_inner(&mut conn, &boundary, &token)
            .unwrap()
            .changed
    );
    boundary.payload["canonicalName"] = json!(format!("{}x", "\u{1f642}".repeat(256)));
    boundary.id = "too-long".into();
    boundary.hlc.counter = 3;
    let fresh = revision(&conn).unwrap();
    assert_eq!(
        entity_commit_inner(&mut conn, &boundary, &fresh)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
}

#[test]
fn stale_projections_duplicate_ids_and_old_clocks_do_not_write() {
    let mut conn = db();
    let first = commit(&mut conn, &resolve("first", "a", "A", 3));
    events::set_projections_stale_conn(&conn, true).unwrap();
    assert_eq!(
        entity_query_inner(&mut conn, &json!({"kind":"identities"}))
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(
        entity_commit_inner(&mut conn, &resolve("new", "b", "B", 4), &first.revision)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    events::set_projections_stale_conn(&conn, false).unwrap();
    assert_eq!(
        entity_commit_inner(&mut conn, &resolve("first", "b", "B", 4), &first.revision)
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    for counter in [2, 3] {
        assert_eq!(
            entity_commit_inner(
                &mut conn,
                &resolve("past", "b", "B", counter),
                &first.revision
            )
            .unwrap_err()
            .code,
            "memory/conflict"
        );
    }
    assert_eq!(count(&conn, "domain_events"), 1);
}

#[test]
fn reverse_remote_arrivals_and_replay_preserve_the_same_registry_revision() {
    let mut ordered = db();
    let mut reversed = db();
    let events = [
        resolve("a1", "a", "A", 1),
        resolve("b1", "b", "B", 2),
        merge("m", "b", "a", 3),
        resolve("a2", "a", "Late", 4),
    ];
    commit_events_inner(&mut ordered, &events).unwrap();
    let dir = tempfile::tempdir().unwrap();
    for event in events.iter().rev() {
        super::super::apply_remote_events_inner(&mut reversed, dir.path(), &[event.clone()], None)
            .unwrap();
    }
    assert_eq!(revision(&ordered).unwrap(), revision(&reversed).unwrap());
    assert_eq!(count(&reversed, "event_sync_state"), 0);
    let before = revision(&ordered).unwrap();
    let tx = ordered.transaction().unwrap();
    events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(revision(&ordered).unwrap(), before);
}

#[test]
fn bootstrap_uses_projection_revision_before_backfill_and_rejects_pre_frontier_writes() {
    let mut source = db();
    commit(&mut source, &resolve("a1", "a", "A", 1));
    commit(&mut source, &resolve("b1", "b", "B", 2));
    commit(&mut source, &merge("m", "b", "a", 3));
    let expected = revision(&source).unwrap();
    let source_dir = tempfile::tempdir().unwrap();
    let target_dir = tempfile::tempdir().unwrap();
    let info = super::super::checkpoints::create_checkpoint(
        &mut source,
        source_dir.path(),
        "local",
        Some(3),
    )
    .unwrap();
    let (path, _) = super::super::get_blob_record_inner(&source, source_dir.path(), &info.blob_key)
        .unwrap()
        .unwrap();
    let mut target = db();
    super::super::put_blob_inner(
        &target,
        target_dir.path(),
        &info.blob_key,
        Some("application/vnd.sqlite3"),
        &std::fs::read(path).unwrap(),
    )
    .unwrap();
    super::super::checkpoints::restore_bootstrap_checkpoint(
        &mut target,
        target_dir.path(),
        &info.blob_key,
    )
    .unwrap();
    assert_eq!(count(&target, "domain_events"), 0);
    assert_eq!(revision(&target).unwrap(), expected);
    assert_eq!(
        page(&mut target, json!({"kind":"members","entityId":"a"}))["total"],
        2
    );
    assert_eq!(
        entity_commit_inner(&mut target, &resolve("past", "c", "C", 2), &expected)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert!(
        entity_commit_inner(&mut target, &resolve("future", "c", "C", 4), &expected)
            .unwrap()
            .changed
    );
}
