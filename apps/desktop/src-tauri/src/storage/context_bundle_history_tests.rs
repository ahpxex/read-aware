use super::super::{context_bundle, context_bundle_history::*};
use super::*;
use serde_json::{json, Value};

fn golden() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle.golden.json"
    ))
    .unwrap()
}
fn history_golden() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle-history.golden.json"
    ))
    .unwrap()
}
fn selector() -> Value {
    history_golden()["selector"].clone()
}
fn read_query(version: &Value) -> Value {
    let mut value = selector();
    value["version"] = version.clone();
    value
}
fn signed(content: Value) -> Value {
    let content: context_bundle::Content = serde_json::from_value(content).unwrap();
    let bytes = context_bundle::canonical(&content).unwrap();
    json!({"version":format!("cb1:{:x}", Sha256::digest(bytes.as_bytes())),"content":content})
}
fn publish(conn: &mut Connection, id: &str, at: i64, bundle: Value) {
    commit_events_inner(conn, &[ev(id, at, "context.bundlePublished", bundle)]).unwrap();
}
fn seeded() -> Connection {
    let mut conn = migrated_conn();
    publish(&mut conn, "initial", 1000, golden());
    conn
}

#[test]
fn scoped_history_matches_shared_identity_and_reads_exact_artifact_without_live_sources() {
    let mut conn = seeded();
    publish(&mut conn, "duplicate", 2000, golden());
    conn.execute_batch("ALTER TABLE books RENAME TO unavailable_books; ALTER TABLE ai_messages RENAME TO unavailable_messages;
        ALTER TABLE memories RENAME TO unavailable_memories; ALTER TABLE app_kv RENAME TO unavailable_kv;").unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap(),
        history_golden()
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).unwrap(),
        golden()
    );
    // Metadata discovery does not materialize or claim to validate artifact bodies.
    conn.execute("UPDATE context_bundles SET content_json='corrupt'", [])
        .unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap(),
        history_golden()
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"]))
            .unwrap_err()
            .code,
        "db/error"
    );
}

#[test]
fn history_pages_cover_every_version_including_time_ties_and_reject_changed_sets() {
    let mut conn = migrated_conn();
    let mut versions = std::collections::HashSet::new();
    for i in 0..105 {
        let mut content = golden()["content"].clone();
        content["sourceRevision"] = json!(format!("source:{i}"));
        let bundle = signed(content);
        versions.insert(bundle["version"].as_str().unwrap().to_owned());
        let mut event = ev(
            &format!("p{i}"),
            1000 + i / 3,
            "context.bundlePublished",
            bundle,
        );
        event.hlc.counter = i % 3;
        commit_events_inner(&mut conn, &[event]).unwrap();
    }
    let mut query = selector();
    query["limit"] = json!(17);
    let mut seen = Vec::new();
    let mut expected_revision = None;
    loop {
        let page = context_bundle_history_inner(&mut conn, query.clone()).unwrap();
        assert_eq!(page["total"], 105);
        if let Some(revision) = &expected_revision {
            assert_eq!(&page["revision"], revision);
        } else {
            expected_revision = Some(page["revision"].clone());
        }
        for entry in page["items"].as_array().unwrap() {
            seen.push(entry["version"].as_str().unwrap().to_owned());
        }
        if page["nextOffset"].is_null() {
            break;
        }
        query["offset"] = page["nextOffset"].clone();
        query["expectedRevision"] = page["revision"].clone();
    }
    assert_eq!(seen.len(), 105);
    assert_eq!(
        seen.into_iter().collect::<std::collections::HashSet<_>>(),
        versions
    );
    let mut larger_page = selector();
    larger_page["limit"] = json!(100);
    larger_page["expectedRevision"] = expected_revision.clone().unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, larger_page).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        100
    );
    query["offset"] = json!(105);
    query["expectedRevision"] = expected_revision.clone().unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, query.clone()).unwrap()["items"],
        json!([])
    );
    query["offset"] = json!(106);
    assert_eq!(
        context_bundle_history_inner(&mut conn, query.clone())
            .unwrap_err()
            .code,
        "memory/invalid-query"
    );
    let mut other = golden()["content"].clone();
    other["scope"]["id"] = json!("other");
    publish(&mut conn, "other", 5000, signed(other));
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap()["revision"],
        expected_revision.unwrap()
    );
    publish(&mut conn, "new", 6000, golden());
    query["offset"] = json!(17);
    assert_eq!(
        context_bundle_history_inner(&mut conn, query)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
}

#[test]
fn selectors_and_tokens_are_closed_and_never_reveal_a_version_in_another_scope() {
    let mut conn = seeded();
    for (i, (kind, scope)) in [
        ("user_profile_context", json!({"kind":"user"})),
        ("reading_intent_context", json!({"kind":"user"})),
        ("reading_intent_context", json!({"kind":"book","id":"b"})),
        ("book_memory_context", json!({"kind":"book","id":"b"})),
        (
            "conversation_insights_context",
            json!({"kind":"book","id":"b"}),
        ),
        (
            "conversation_insights_context",
            json!({"kind":"conversation","id":"thread-b"}),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let mut content = golden()["content"].clone();
        content["kind"] = json!(kind);
        content["scope"] = scope.clone();
        content["items"] = json!([]);
        content["omissions"] = json!([]);
        let bundle = signed(content);
        publish(
            &mut conn,
            &format!("recipe{i}"),
            2000 + i as i64,
            bundle.clone(),
        );
        let selection = json!({"kind":kind,"scope":scope});
        assert_eq!(
            context_bundle_history_inner(&mut conn, selection.clone()).unwrap()["total"],
            1
        );
        let mut read = selection;
        read["version"] = bundle["version"].clone();
        assert_eq!(context_bundle_read_inner(&mut conn, read).unwrap(), bundle);
    }
    for extra in [
        json!({"limit":0}),
        json!({"limit":101}),
        json!({"offset":1}),
        json!({"offset":-1}),
        json!({"offset":null}),
        json!({"offset":9007199254740992_u64}),
        json!({"limit":null}),
        json!({"expectedRevision":null}),
        json!({"expectedRevision":"latest"}),
        json!({"sql":"SELECT *"}),
    ] {
        let mut query = selector();
        query
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(
            context_bundle_history_inner(&mut conn, query)
                .unwrap_err()
                .code,
            "memory/invalid-query"
        );
    }
    for bad in [
        json!({}),
        json!({"version":golden()["version"]}),
        json!({"kind":"book_memory_context","scope":{"kind":"user"}}),
    ] {
        assert_eq!(
            context_bundle_history_inner(&mut conn, bad.clone())
                .unwrap_err()
                .code,
            "memory/invalid-query"
        );
        assert_eq!(
            context_bundle_read_inner(&mut conn, bad).unwrap_err().code,
            "memory/invalid-query"
        );
    }
    let mut other = read_query(&golden()["version"]);
    other["scope"]["id"] = json!("other");
    assert_eq!(
        context_bundle_read_inner(&mut conn, other).unwrap(),
        Value::Null
    );
    let mut other_kind = read_query(&golden()["version"]);
    other_kind["kind"] = json!("reading_intent_context");
    assert_eq!(
        context_bundle_read_inner(&mut conn, other_kind).unwrap(),
        Value::Null
    );
    assert_eq!(
        context_bundle_read_inner(
            &mut conn,
            read_query(&json!(format!("cb1:{}", "0".repeat(64))))
        )
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&json!("latest")))
            .unwrap_err()
            .code,
        "memory/invalid-query"
    );
    let mut empty = selector();
    empty["scope"]["id"] = json!("other");
    let page = context_bundle_history_inner(&mut conn, empty).unwrap();
    assert_eq!(page["total"], 0);
    assert!(page["nextOffset"].is_null());
}

#[test]
fn read_revalidates_content_scope_and_ranked_provenance_and_stale_or_failed_reads_are_not_absence()
{
    for sql in ["UPDATE context_bundles SET content_json='{}'", "UPDATE context_bundle_items SET source_revision='wrong'",
        "DELETE FROM context_bundle_items WHERE rank=0", "UPDATE context_bundle_items SET rank=99 WHERE rank=0",
        "INSERT INTO context_bundle_items SELECT bundle_version,99,'memory','extra','extra' FROM context_bundle_items WHERE rank=0"] {
        let mut conn = seeded(); conn.execute(sql, []).unwrap();
        assert_eq!(context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).unwrap_err().code, "db/error");
    }
    let mut conn = seeded();
    conn.execute("UPDATE context_bundles SET scope_id='other'", [])
        .unwrap();
    let mut query = read_query(&golden()["version"]);
    query["scope"]["id"] = json!("other");
    assert_eq!(
        context_bundle_read_inner(&mut conn, query)
            .unwrap_err()
            .code,
        "db/error"
    );
    conn.execute(
        "INSERT INTO sync_profile(id,projections_stale,updated_at) VALUES(1,1,'now')",
        [],
    )
    .unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector())
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"]))
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    conn.execute("UPDATE sync_profile SET projections_stale=0", [])
        .unwrap();
    conn.execute("ALTER TABLE context_bundles RENAME TO missing_history", [])
        .unwrap();
    assert!(context_bundle_history_inner(&mut conn, selector()).is_err());
    assert!(context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).is_err());
}

#[test]
fn pinned_archive_survives_replay_checkpoint_restore_and_wipe() {
    let mut conn = seeded();
    let dir = tempfile::tempdir().unwrap();
    let checkpoint =
        super::super::checkpoints::create_checkpoint(&mut conn, dir.path(), "local", None).unwrap();
    let tx = conn.transaction().unwrap();
    super::super::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap(),
        history_golden()
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).unwrap(),
        golden()
    );
    for table in apply::DERIVED_TABLES {
        conn.execute(&format!("DELETE FROM {table}"), []).unwrap();
    }
    let tx = conn.transaction().unwrap();
    super::super::checkpoints::restore_checkpoint(&tx, dir.path(), &checkpoint).unwrap();
    tx.commit().unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap(),
        history_golden()
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).unwrap(),
        golden()
    );
    super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut conn, selector()).unwrap()["total"],
        0
    );
    assert_eq!(
        context_bundle_read_inner(&mut conn, read_query(&golden()["version"])).unwrap(),
        Value::Null
    );
}

#[test]
fn another_connection_and_reopening_preserve_archive_identity_and_invalidate_continuation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let open = || {
        let conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        conn
    };
    let mut first = open();
    run_migrations(&mut first).unwrap();
    publish(&mut first, "first", 1000, golden());
    let page = context_bundle_history_inner(&mut first, selector()).unwrap();
    let mut second = open();
    run_migrations(&mut second).unwrap();
    let mut content = golden()["content"].clone();
    content["sourceRevision"] = json!("changed");
    publish(&mut second, "second", 2000, signed(content));
    let mut continuation = selector();
    continuation["offset"] = json!(1);
    continuation["expectedRevision"] = page["revision"].clone();
    assert_eq!(
        context_bundle_history_inner(&mut first, continuation)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    let fresh = context_bundle_history_inner(&mut first, selector()).unwrap();
    drop(first);
    drop(second);
    let mut reopened = open();
    run_migrations(&mut reopened).unwrap();
    assert_eq!(
        context_bundle_history_inner(&mut reopened, selector()).unwrap(),
        fresh
    );
    assert_eq!(
        context_bundle_read_inner(&mut reopened, read_query(&golden()["version"])).unwrap(),
        golden()
    );
}
