use super::super::{
    apply_connection_pragmas, commit_events_inner,
    identity_consolidation_commit::identity_commit_inner, register_sql_functions, run_migrations,
    EventRow, Hlc,
};
use super::*;
use serde_json::json;

fn prepare(conn: &mut Connection) {
    apply_connection_pragmas(conn).unwrap();
    register_sql_functions(conn).unwrap();
    run_migrations(conn).unwrap();
    conn.execute("INSERT OR IGNORE INTO local_device(id,device_id,created_at,last_opened_at) VALUES(1,'test','old','old')", []).unwrap();
}
fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    prepare(&mut conn);
    conn
}
fn event(id: &str, kind: &str, payload: Value, counter: i64) -> EventRow {
    let aggregate = if kind.starts_with("memory.") {
        Some(("memory", "memoryId"))
    } else if kind == "entity.resolved" {
        Some(("entity", "entityId"))
    } else if kind == "entity.merged" {
        Some(("entity", "keepId"))
    } else {
        None
    };
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        aggregate_type: aggregate.map(|(kind, _)| kind.into()),
        aggregate_id: aggregate.and_then(|(_, key)| payload[key].as_str().map(str::to_owned)),
        payload,
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        actor_id: None,
        origin: Some("agent".into()),
        created_at: None,
    }
}
fn source(id: &str, scope: &str, counter: i64) -> EventRow {
    event(
        &format!("seed-{id}"),
        "memory.promoted",
        json!({"memoryId":id,"content":format!("Reader works with {id}"),"scope":scope,"bookId":"book","kind":"fact","evidence":[{},{},{}]}),
        counter,
    )
}
fn seed(conn: &mut Connection) {
    commit_events_inner(
        conn,
        &[
            source("a", "user", 1),
            source("b", "global", 2),
            event(
                "curated",
                "profile.updated",
                json!({"summary":"Handwritten","displayName":"Reader","traits":{"language":"en"}}),
                3,
            ),
        ],
    )
    .unwrap();
}
fn snapshot(conn: &mut Connection) -> IdentityConsolidationSnapshot {
    identity_snapshot_inner(conn).unwrap()
}
fn entity(id: &str, counter: i64) -> EventRow {
    event(
        id,
        "entity.resolved",
        json!({"entityId":"person-a","kind":"person","canonicalName":"Alex","aliases":["A"]}),
        counter,
    )
}
fn plan(state: &IdentityConsolidationSnapshot, entities: &[EventRow], counter: i64) -> EventRow {
    event(
        &format!("profile-{counter}"),
        "profile.updated",
        json!({"traits":{"consolidated":{
            "version":1, "summary":if state.sources.is_empty() { "" } else { "Derived profile" },
            "sources":source_conditions(&state.sources),
            "entityEvidence":entities.iter().map(|event| json!({"eventId":event.id,"memoryIds":["a"]})).collect::<Vec<_>>()
        }}}),
        counter,
    )
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn complete_read_set_excludes_book_and_weak_memories_but_includes_explicit_pins() {
    let mut conn = db();
    seed(&mut conn);
    let mut weak = source("weak", "user", 4);
    weak.payload["evidence"] = json!([{}]);
    let mut pinned = source("pinned", "global", 5);
    pinned.payload["evidence"] = json!([{}]);
    commit_events_inner(
        &mut conn,
        &[
            weak,
            pinned,
            source("fiction", "book", 6),
            event(
                "pin",
                "memory.feedback",
                json!({"memoryId":"pinned","signal":"pin"}),
                7,
            ),
            event(
                "pin-book",
                "memory.feedback",
                json!({"memoryId":"fiction","signal":"pin"}),
                8,
            ),
        ],
    )
    .unwrap();
    let before = snapshot(&mut conn);
    assert_eq!(
        before
            .sources
            .iter()
            .map(|s| s.memory.id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b", "pinned"]
    );
    assert!(!before.settled);
    let entities = [entity("resolve", 10)];
    let proposed = plan(&before, &entities, 11);
    let receipt =
        identity_commit_inner(&mut conn, &before.revision, &proposed, &entities, true).unwrap();
    assert_eq!(receipt.emitted_event_ids, ["resolve", "profile-11"]);
    let after = snapshot(&mut conn);
    assert!(after.settled);
    assert_eq!(after.revision, receipt.revision);
    assert_ne!(before.revision, after.revision);
    assert_eq!(after.profile.summary.as_deref(), Some("Handwritten"));
    let context = super::super::profile_context::profile_context_inner(&mut conn).unwrap();
    assert_eq!(context.source_conditions, source_conditions(&after.sources));
    assert_eq!(context.profile.summary, after.profile.summary);
    assert_eq!(context.derived, after.derived);
    let wire = serde_json::to_value(context).unwrap();
    assert!(wire.get("sources").is_none());
    assert!(wire.get("entitiesRevision").is_none());
    assert_eq!(
        after.derived.unwrap(),
        proposed.payload["traits"]["consolidated"]
    );
    let fields: (String, String) = conn
        .query_row(
            "SELECT display_name,traits_json FROM user_profile",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(fields.0, "Reader");
    assert_eq!(
        serde_json::from_str::<Value>(&fields.1).unwrap()["language"],
        "en"
    );
    assert_eq!(
        count(&conn, "domain_events"),
        count(&conn, "event_sync_state")
    );
}

#[test]
fn every_relevant_change_invalidates_inference_including_equal_byte_events() {
    let changes = [
        source("new", "user", 5),
        event(
            "edit",
            "memory.revised",
            json!({"memoryId":"a","content":"Changed"}),
            5,
        ),
        event(
            "same",
            "memory.revised",
            json!({"memoryId":"a","content":"Reader works with a"}),
            5,
        ),
        event("forget", "memory.forgotten", json!({"memoryId":"a"}), 5),
        event(
            "supersede",
            "memory.superseded",
            json!({"memoryId":"a","bySupersedingId":"b"}),
            5,
        ),
        event(
            "scope",
            "memory.revised",
            json!({"memoryId":"a","scope":"book","bookId":"x"}),
            5,
        ),
        event(
            "threshold",
            "memory.revised",
            json!({"memoryId":"a","evidenceCount":2}),
            5,
        ),
        event(
            "manual",
            "profile.updated",
            json!({"displayName":"Changed"}),
            5,
        ),
        entity("other-identity", 5),
    ];
    for change in changes {
        let mut conn = db();
        seed(&mut conn);
        let before = snapshot(&mut conn);
        commit_events_inner(&mut conn, &[change]).unwrap();
        let size = count(&conn, "domain_events");
        let error = identity_commit_inner(
            &mut conn,
            &before.revision,
            &plan(&before, &[], 10),
            &[],
            true,
        )
        .unwrap_err();
        assert_eq!(error.code, "memory/conflict");
        assert_ne!(snapshot(&mut conn).revision, before.revision);
        assert_eq!(count(&conn, "domain_events"), size);
        assert_eq!(count(&conn, "identity_consolidation_checkpoint"), 0);
    }
}

#[test]
fn unpinning_weak_evidence_invalidates_the_complete_set() {
    let mut conn = db();
    seed(&mut conn);
    commit_events_inner(
        &mut conn,
        &[
            event(
                "weak",
                "memory.revised",
                json!({"memoryId":"a","evidenceCount":1}),
                4,
            ),
            event(
                "pin",
                "memory.feedback",
                json!({"memoryId":"a","signal":"pin"}),
                5,
            ),
        ],
    )
    .unwrap();
    let before = snapshot(&mut conn);
    assert_eq!(before.sources.len(), 2);
    commit_events_inner(
        &mut conn,
        &[event(
            "unpin",
            "memory.feedback",
            json!({"memoryId":"a","signal":"unpin"}),
            6,
        )],
    )
    .unwrap();
    assert_eq!(snapshot(&mut conn).sources.len(), 1);
    assert_eq!(
        identity_commit_inner(
            &mut conn,
            &before.revision,
            &plan(&before, &[], 10),
            &[],
            true
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
}

#[test]
fn faults_at_projection_outbox_and_completion_roll_back_the_whole_batch() {
    for trigger in [
        "CREATE TRIGGER fail_profile BEFORE UPDATE ON user_profile BEGIN SELECT RAISE(ABORT,'profile failure'); END;",
        "CREATE TRIGGER fail_outbox BEFORE INSERT ON event_sync_state WHEN NEW.event_id='profile-11' BEGIN SELECT RAISE(ABORT,'outbox failure'); END;",
        "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON identity_consolidation_checkpoint BEGIN SELECT RAISE(ABORT,'checkpoint failure'); END;",
    ] {
        let mut conn = db();
        seed(&mut conn);
        let before = snapshot(&mut conn);
        let size = count(&conn, "domain_events");
        conn.execute_batch(trigger).unwrap();
        let entities = [entity("resolve", 10)];
        assert!(identity_commit_inner(&mut conn, &before.revision, &plan(&before, &entities, 11), &entities, true).is_err());
        assert_eq!(snapshot(&mut conn).revision, before.revision);
        assert_eq!(count(&conn, "domain_events"), size);
        assert_eq!(count(&conn, "event_sync_state"), size);
        assert_eq!(count(&conn, "entities"), 0);
        assert_eq!(count(&conn, "identity_consolidation_checkpoint"), 0);
    }
}

#[test]
fn rejects_payload_authority_evidence_and_envelope_injection_without_writes() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let entities = [entity("resolve", 10)];
    let valid = plan(&before, &entities, 11);
    let mut invalid = Vec::new();
    for (pointer, value) in [
        ("/traits/consolidated/version", json!(2)),
        ("/traits/consolidated/summary", json!("x".repeat(16001))),
        ("/traits/consolidated/sources", json!([])),
        ("/traits/consolidated/entityEvidence", json!([])),
        (
            "/traits/consolidated/entityEvidence/0/eventId",
            json!("other"),
        ),
        ("/traits/consolidated/entityEvidence/0/memoryIds", json!([])),
        (
            "/traits/consolidated/entityEvidence/0/memoryIds",
            json!(["foreign"]),
        ),
        (
            "/traits/consolidated/entityEvidence/0/memoryIds",
            json!(["a", "a"]),
        ),
    ] {
        let mut candidate = valid.clone();
        *candidate.payload.pointer_mut(pointer).unwrap() = value;
        invalid.push(candidate);
    }
    for key in ["summary", "displayName", "unrelated"] {
        let mut candidate = valid.clone();
        candidate.payload[key] = json!("injection");
        invalid.push(candidate);
    }
    let mut candidate = valid.clone();
    candidate.payload["traits"]["language"] = json!("changed");
    invalid.push(candidate);
    let mut candidate = valid.clone();
    candidate.payload["traits"]["consolidated"]["extra"] = json!(true);
    invalid.push(candidate);
    let mut candidate = valid.clone();
    candidate.payload["traits"]["consolidated"]["sources"]
        .as_array_mut()
        .unwrap()
        .reverse();
    invalid.push(candidate);
    let mut candidate = valid.clone();
    candidate.origin = Some("user".into());
    invalid.push(candidate);
    let mut candidate = valid.clone();
    candidate.id = entities[0].id.clone();
    invalid.push(candidate);
    let mut candidate = valid.clone();
    candidate.hlc.counter = 9;
    invalid.push(candidate);
    for candidate in invalid {
        assert!(
            identity_commit_inner(&mut conn, &before.revision, &candidate, &entities, true)
                .is_err()
        );
        assert_eq!(count(&conn, "domain_events"), 3);
        assert_eq!(snapshot(&mut conn).revision, before.revision);
    }
    for mutate in 0..4 {
        let mut candidates = entities.to_vec();
        match mutate {
            0 => candidates[0].origin = Some("plugin:untrusted".into()),
            1 => candidates[0].hlc.device_id = "foreign".into(),
            2 => candidates[0].payload["summary"] = json!("injection"),
            _ => candidates[0].schema_version = Some(999),
        }
        assert!(
            identity_commit_inner(&mut conn, &before.revision, &valid, &candidates, true).is_err()
        );
        assert_eq!(count(&conn, "domain_events"), 3);
    }
}

#[test]
fn entity_batches_share_keeper_semantics_and_reject_late_invalid_decisions_atomically() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let mut second = entity("resolve-b", 11);
    second.aggregate_id = Some("person-b".into());
    second.payload["entityId"] = json!("person-b");
    second.payload["canonicalName"] = json!("Keeper");
    let mut entities = vec![
        entity("resolve-a", 10),
        second,
        event(
            "merge",
            "entity.merged",
            json!({"keepId":"person-b","mergedId":"person-a"}),
            12,
        ),
    ];
    let mut broken = entities.clone();
    broken[2].payload["mergedId"] = json!("unknown");
    assert!(identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &broken, 13),
        &broken,
        true
    )
    .is_err());
    assert_eq!(count(&conn, "entities"), 0);
    let repeated = event(
        "same-merge",
        "entity.merged",
        json!({"keepId":"person-a","mergedId":"person-b"}),
        13,
    );
    entities.push(repeated);
    let receipt = identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &entities, 14),
        &entities,
        true,
    )
    .unwrap();
    assert_eq!(
        receipt.emitted_event_ids,
        ["resolve-a", "resolve-b", "merge", "profile-14"]
    );
    assert_eq!(
        entity_registry::root(&conn, "person-a").unwrap().as_deref(),
        Some("person-b")
    );
    assert_eq!(count(&conn, "entities"), 2);
    assert_eq!(
        snapshot(&mut conn).derived.unwrap()["entityEvidence"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
}

#[test]
fn noops_and_partial_work_have_honest_receipts_and_empty_sources_clear_only_derived_data() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let proposed = plan(&before, &[], 10);
    let first = identity_commit_inner(&mut conn, &before.revision, &proposed, &[], false).unwrap();
    assert!(!first.settled);
    assert!(!snapshot(&mut conn).settled);
    let after = snapshot(&mut conn);
    let receipt = identity_commit_inner(
        &mut conn,
        &after.revision,
        &plan(&after, &[], 11),
        &[],
        true,
    )
    .unwrap();
    assert!(receipt.emitted_event_ids.is_empty());
    assert!(snapshot(&mut conn).settled);
    let after = snapshot(&mut conn);
    identity_commit_inner(
        &mut conn,
        &after.revision,
        &plan(&after, &[], 12),
        &[],
        false,
    )
    .unwrap();
    assert!(!snapshot(&mut conn).settled);
    commit_events_inner(
        &mut conn,
        &[
            event("forget-a", "memory.forgotten", json!({"memoryId":"a"}), 20),
            event("forget-b", "memory.forgotten", json!({"memoryId":"b"}), 21),
        ],
    )
    .unwrap();
    let empty = snapshot(&mut conn);
    assert!(empty.sources.is_empty());
    let mut bad = plan(&empty, &[], 22);
    bad.payload["traits"]["consolidated"]["summary"] = json!("Unsupported claim");
    assert!(identity_commit_inner(&mut conn, &empty.revision, &bad, &[], true).is_err());
    identity_commit_inner(
        &mut conn,
        &empty.revision,
        &plan(&empty, &[], 23),
        &[],
        true,
    )
    .unwrap();
    let cleared = snapshot(&mut conn);
    assert_eq!(cleared.derived.unwrap()["summary"], "");
    assert_eq!(cleared.profile.summary.as_deref(), Some("Handwritten"));
}

#[test]
fn checkpoint_survives_restart_but_another_connections_new_evidence_prevents_stale_commit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("identity.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    prepare(&mut conn);
    seed(&mut conn);
    let before = snapshot(&mut conn);
    identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &[], 10),
        &[],
        true,
    )
    .unwrap();
    drop(conn);
    let mut reader = Connection::open(&path).unwrap();
    prepare(&mut reader);
    let read = snapshot(&mut reader);
    assert!(read.settled);
    let mut writer = Connection::open(&path).unwrap();
    prepare(&mut writer);
    commit_events_inner(&mut writer, &[source("unseen", "global", 20)]).unwrap();
    assert_eq!(
        identity_commit_inner(
            &mut reader,
            &read.revision,
            &plan(&read, &[], 21),
            &[],
            true
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    assert!(!snapshot(&mut reader).settled);
}

#[test]
fn batch_limits_duplicate_ids_and_order_are_checked_even_for_noops() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let entities: Vec<_> = (0..33)
        .map(|i| entity(&format!("decision-{i}"), 10 + i))
        .collect();
    let valid = &entities[..32];
    assert!(identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &entities, 50),
        &entities,
        true
    )
    .is_err());
    let mut duplicate = valid.to_vec();
    duplicate[1].id = duplicate[0].id.clone();
    assert!(identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &duplicate, 50),
        &duplicate,
        true
    )
    .is_err());
    let mut unordered = valid.to_vec();
    unordered[1].hlc.counter = unordered[0].hlc.counter;
    assert!(identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &unordered, 50),
        &unordered,
        true
    )
    .is_err());
    assert_eq!(count(&conn, "domain_events"), 3);
    let receipt = identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, valid, 50),
        valid,
        true,
    )
    .unwrap();
    assert_eq!(receipt.emitted_event_ids, ["decision-0", "profile-50"]);
    assert_eq!(count(&conn, "entities"), 1);
}

#[test]
fn migration_preserves_v33_state_and_legacy_profile_must_be_initialized_first() {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    super::super::schema::run_migrations_up_to(&mut conn, 33).unwrap();
    seed(&mut conn);
    let profile = user_profile::read_snapshot(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let after = snapshot(&mut conn);
    assert_eq!(after.profile.revision, profile.revision);
    assert_eq!(count(&conn, "domain_events"), 3);
    assert!(!after.settled);
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-agent-profile','legacy','old')", []).unwrap();
    assert_eq!(
        identity_snapshot_inner(&mut conn).unwrap_err().code,
        "memory/conflict"
    );
    assert_eq!(
        identity_commit_inner(
            &mut conn,
            &after.revision,
            &plan(&after, &[], 10),
            &[],
            true
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
    assert_eq!(count(&conn, "identity_consolidation_checkpoint"), 0);
}

#[test]
fn derived_state_replays_while_completion_is_local_and_wiped() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let entities = [entity("resolve", 10)];
    identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &entities, 11),
        &entities,
        true,
    )
    .unwrap();
    let after = snapshot(&mut conn);
    assert!(!super::super::apply::DERIVED_TABLES.contains(&"identity_consolidation_checkpoint"));
    assert!(!super::super::apply::DIFF_SPECS
        .iter()
        .any(|s| s.table == "identity_consolidation_checkpoint"));
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    let replayed = snapshot(&mut conn);
    assert_eq!(replayed.revision, after.revision);
    assert_eq!(replayed.derived, after.derived);
    assert!(replayed.settled);
    let dir = tempfile::tempdir().unwrap();
    super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert_eq!(count(&conn, "identity_consolidation_checkpoint"), 0);
    assert_eq!(count(&conn, "user_profile"), 0);
    assert_eq!(count(&conn, "entities"), 0);
}
