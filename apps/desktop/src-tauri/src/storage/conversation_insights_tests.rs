use super::*;
use serde_json::{json, Value};

const KEY: &str = "read-aware-agent-insights";
fn golden() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle-insights.golden.json"
    ))
    .unwrap()
}
fn target(kind: &str, id: &str) -> Value {
    json!({"kind":kind,"id":id})
}
fn snapshot(conn: &mut Connection, input: Value) -> Value {
    serde_json::to_value(conversation_insights_snapshot_inner(conn, input).unwrap()).unwrap()
}
fn summaries(conn: &Connection, value: Value) {
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES(?1,?2,'now') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", rusqlite::params![KEY, value.to_string()]).unwrap();
}
fn thread(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO ai_conversations(id,created_at,updated_at) VALUES(?1,'old','old')",
        [id],
    )
    .unwrap();
}
fn seeded() -> Connection {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("book", 100, "book:one", "Book")]).unwrap();
    thread(&conn, "book:one");
    thread(&conn, "__global__");
    thread(&conn, "thread-other");
    conn
}

#[test]
fn durable_summary_matches_shared_unicode_identity_without_reading_messages_or_other_source_tables()
{
    let mut conn = seeded();
    summaries(
        &conn,
        json!({"book:book:one":golden()["summary"],"global":"private other thread"}),
    );
    conn.execute_batch("ALTER TABLE ai_messages RENAME TO hidden_messages; ALTER TABLE memories RENAME TO hidden_memories; ALTER TABLE entities RENAME TO hidden_entities;").unwrap();
    assert_eq!(snapshot(&mut conn, golden()["target"].clone()), golden());
    summaries(
        &conn,
        json!({"book:book:one":golden()["summary"],"global":"changed unrelated"}),
    );
    assert_eq!(snapshot(&mut conn, golden()["target"].clone()), golden());
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM domain_events"),
        1
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
        0
    );
}

#[test]
fn original_global_fallback_is_exact_and_empty_present_summary_is_not_absence() {
    let mut conn = seeded();
    summaries(&conn, json!({"global":"legacy", "book:book:one":"book"}));
    assert_eq!(
        snapshot(&mut conn, target("global", "__global__"))["summary"],
        "legacy"
    );
    let absent = snapshot(&mut conn, target("global", "thread-other"));
    assert_eq!(absent["status"], "absent");
    assert!(absent["summary"].is_null());
    summaries(
        &conn,
        json!({"global":"legacy", "global:__global__":"", "global:thread-other":""}),
    );
    let empty = snapshot(&mut conn, target("global", "thread-other"));
    assert_eq!(empty["status"], "present");
    assert_eq!(empty["summary"], "");
    assert_ne!(empty["revision"], absent["revision"]);
    assert_eq!(
        snapshot(&mut conn, target("global", "__global__"))["summary"],
        ""
    );
    conn.execute("DELETE FROM app_kv WHERE key=?1", [KEY])
        .unwrap();
    assert_eq!(
        snapshot(&mut conn, target("global", "thread-other")),
        absent
    );
}

#[test]
fn missing_books_wrong_kinds_and_unknown_fields_reject_and_orphan_or_cleared_summaries_never_resurrect(
) {
    let mut conn = seeded();
    summaries(
        &conn,
        json!({"book:book:one":"old summary", "global":"old global"}),
    );
    for input in [
        Value::Null,
        json!([]),
        target("global", "book:one"),
        target("book", "thread-other"),
        target("global", "thread-missing"),
        target("book", ""),
        target("book", "\0"),
        target("book", &"x".repeat(257)),
        json!({"kind":"book","id":"book:one","key":KEY}),
    ] {
        assert_eq!(
            conversation_insights_snapshot_inner(&mut conn, input)
                .unwrap_err()
                .code,
            "ui/invalid-target"
        );
    }
    assert_eq!(
        conversation_insights_snapshot_inner(&mut conn, target("book", "missing"))
            .unwrap_err()
            .code,
        "reader/book-not-found"
    );
    conn.execute("UPDATE ai_conversations SET cleared_at='clear'", [])
        .unwrap();
    let cleared = snapshot(&mut conn, target("book", "book:one"));
    assert_eq!(cleared["status"], "unavailable");
    assert!(cleared["summary"].is_null());
    assert!(!cleared.to_string().contains("old summary"));
    assert_eq!(
        snapshot(&mut conn, target("global", "__global__"))["status"],
        "unavailable"
    );
    conn.execute("DELETE FROM ai_conversations WHERE id='book:one'", [])
        .unwrap();
    assert_eq!(snapshot(&mut conn, target("book", "book:one")), cleared);
    summaries(&conn, json!({}));
    assert_eq!(
        snapshot(&mut conn, target("book", "book:one"))["status"],
        "absent"
    );
    conn.execute("DELETE FROM books WHERE id='book:one'", [])
        .unwrap();
    assert_eq!(
        conversation_insights_snapshot_inner(&mut conn, target("book", "book:one"))
            .unwrap_err()
            .code,
        "reader/book-not-found"
    );
}

#[test]
fn corrupt_maps_and_oversized_or_invalid_selected_text_are_not_empty_snapshots() {
    let mut conn = seeded();
    for raw in ["{", "null", "[]", "{\"global:thread-other\":42}"] {
        conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES(?1,?2,'now') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", rusqlite::params![KEY,raw]).unwrap();
        assert_eq!(
            conversation_insights_snapshot_inner(&mut conn, golden()["target"].clone())
                .unwrap_err()
                .code,
            "db/error"
        );
    }
    for text in [
        "x".repeat(1024 * 1024 + 1),
        "\u{4e2d}".repeat(400_000),
        "bad\0text".into(),
    ] {
        summaries(&conn, json!({"book:book:one":text}));
        assert_eq!(
            conversation_insights_snapshot_inner(&mut conn, golden()["target"].clone())
                .unwrap_err()
                .code,
            "memory/invalid-input"
        );
    }
    summaries(&conn, json!({}));
    super::super::events::set_projections_stale_conn(&conn, true).unwrap();
    assert_eq!(
        conversation_insights_snapshot_inner(&mut conn, golden()["target"].clone())
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    super::super::events::set_projections_stale_conn(&conn, false).unwrap();
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-agent-profile','legacy','old')", []).unwrap();
    assert_eq!(
        conversation_insights_snapshot_inner(&mut conn, golden()["target"].clone())
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    conn.execute(
        "DELETE FROM app_kv WHERE key='read-aware-agent-profile'",
        [],
    )
    .unwrap();
    conn.execute_batch("ALTER TABLE app_kv RENAME TO hidden_kv")
        .unwrap();
    assert!(conversation_insights_snapshot_inner(&mut conn, golden()["target"].clone()).is_err());
}

fn bundle_event(conn: &Connection, snapshot: &Value) -> EventRow {
    let content = json!({"format":"readaware.context","schemaVersion":1,"recipeVersion":1,"kind":"conversation_insights_context",
        "scope":snapshot["target"], "sourceRevision":snapshot["revision"], "omissions":[],
        "items":[{"kind":"conversation_insight","id":snapshot["target"]["id"],"revision":snapshot["revision"],"label":"Stored rolling conversation summary","text":snapshot["summary"]}]});
    let content = serde_json::from_value::<super::super::context_bundle::Content>(content).unwrap();
    let canonical = super::super::context_bundle::canonical(&content).unwrap();
    let version = format!("cb1:{:x}", Sha256::digest(canonical.as_bytes()));
    let mut event = ev(
        "published",
        1000,
        "context.bundlePublished",
        json!({"version":version,"content":content}),
    );
    event.aggregate_type = Some("contextBundle".into());
    event.aggregate_id = Some(version);
    event.origin = Some("user".into());
    event.hlc.device_id = ensure_local_device(conn).unwrap();
    event
}

#[test]
fn captured_durable_summary_publishes_but_concurrent_rewrite_clear_or_book_deletion_rejects() {
    for mutation in ["none", "rewrite", "clear", "delete-book"] {
        let mut conn = seeded();
        summaries(&conn, json!({"book:book:one":golden()["summary"]}));
        let observed = context_bundle_source_revision_inner(&mut conn).unwrap();
        let source = snapshot(&mut conn, golden()["target"].clone());
        let event = bundle_event(&conn, &source);
        match mutation {
            "rewrite" => {
                summaries(&conn, json!({"book:book:one":"changed"}));
                summaries(&conn, json!({"book:book:one":golden()["summary"]}));
            }
            "clear" => {
                conn.execute(
                    "UPDATE ai_conversations SET cleared_at='cleared' WHERE id='book:one'",
                    [],
                )
                .unwrap();
            }
            "delete-book" => {
                conn.execute("DELETE FROM books WHERE id='book:one'", [])
                    .unwrap();
            }
            _ => {}
        }
        let result = context_bundle_publish_inner(&mut conn, &event, &observed);
        if mutation == "none" {
            assert!(result.unwrap().changed);
            assert_eq!(
                scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
                1
            );
        } else {
            assert_eq!(result.unwrap_err().code, "memory/conflict");
            assert_eq!(
                scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
                0
            );
        }
    }
}

#[test]
fn snapshot_reads_durable_bytes_written_by_a_second_connection_and_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    thread(&conn, "thread-other");
    let other = Connection::open(&path).unwrap();
    register_sql_functions(&other).unwrap();
    summaries(&other, json!({"global:thread-other":"saved by peer"}));
    let value = snapshot(&mut conn, target("global", "thread-other"));
    assert_eq!(value["summary"], "saved by peer");
    drop(other);
    drop(conn);
    let mut reopened = Connection::open(&path).unwrap();
    register_sql_functions(&reopened).unwrap();
    run_migrations(&mut reopened).unwrap();
    assert_eq!(
        snapshot(&mut reopened, target("global", "thread-other")),
        value
    );
}
