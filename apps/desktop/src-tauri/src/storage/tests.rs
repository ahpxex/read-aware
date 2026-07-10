//! storage 的单元测试（`mod tests` 的独立文件形态 —— 仍是单元测试作用域，
//! 可访问父模块私有项；集成测试才放 crate 根的 tests/ 目录）。
use super::*;

fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    apply_connection_pragmas(&conn).expect("pragmas");
    register_sql_functions(&conn).expect("sql functions");
    conn
}

fn migrated_conn() -> Connection {
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("migrate");
    conn
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![name],
        |row| row.get(0),
    )
    .unwrap()
}

fn event(id: &str, wall: i64, counter: i64) -> EventRow {
    EventRow {
        id: id.to_string(),
        event_type: "book.imported".to_string(),
        hlc: Hlc {
            wall_ms: wall,
            counter,
            device_id: "device-a".to_string(),
        },
        schema_version: None,
        aggregate_type: Some("book".to_string()),
        aggregate_id: Some(format!("agg-{id}")),
        actor_id: None,
        created_at: None,
        payload: serde_json::json!({ "bookId": format!("agg-{id}") }),
    }
}

#[test]
fn fresh_migrate_reaches_latest_and_retires_interim_tables() {
    let conn = migrated_conn();
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, 7);
    for table in [
        "domain_events",
        "event_sync_state",
        "blob_objects",
        "blob_sync_state",
        "annotations_fts",
        "books",
        "annotations",
        "memories",
        "ai_conversations",
        "ai_messages",
        "app_kv",
        "local_device",
    ] {
        assert!(table_exists(&conn, table), "missing table {table}");
    }
    // The bare v1 `events` table is retired by v3; `blobs` survives until
    // `externalize_inline_blobs` runs (it needs the filesystem root).
    assert!(!table_exists(&conn, "events"));
    assert!(table_exists(&conn, "blobs"));
}

#[test]
fn v3_carries_old_events_forward() {
    let mut conn = test_conn();
    run_migrations_up_to(&mut conn, 2).expect("stage v2");
    conn.execute(
        "INSERT INTO events (id, type, hlc_wall, hlc_counter, hlc_device, payload)
             VALUES ('old-1', 'book.imported', 1700000000000, 0, 'dev', '{\"bookId\":\"b1\"}')",
        [],
    )
    .unwrap();
    run_migrations(&mut conn).expect("migrate to v3");
    let (event_type, created_at): (String, String) = conn
        .query_row(
            "SELECT type, created_at FROM domain_events WHERE id = 'old-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(event_type, "book.imported");
    assert!(created_at.starts_with("2023-11-14T"), "got {created_at}");
    assert!(!table_exists(&conn, "events"));
}

#[test]
fn ai_chat_replace_orders_by_seq_and_clear_leaves_tombstone() {
    let conn = migrated_conn();
    let insert_message = |id: &str, seq: i64, content: &str| {
        conn.execute(
            "INSERT INTO ai_messages
                (id, conversation_id, role, seq, content, created_at, attachments_json, parts_json)
             VALUES (?1, 'book-1', 'assistant', ?2, ?3, '2026-07-06T00:00:00Z', NULL, NULL)",
            params![id, seq, content],
        )
        .unwrap();
    };
    conn.execute(
        "INSERT INTO ai_conversations (id, created_at, updated_at)
         VALUES ('book-1', '2026-07-06T00:00:00Z', '2026-07-06T00:00:00Z')",
        [],
    )
    .unwrap();
    insert_message("m2", 1, "second");
    insert_message("m1", 0, "first");

    let mut stmt = conn
        .prepare("SELECT * FROM ai_messages WHERE conversation_id = 'book-1' ORDER BY seq")
        .unwrap();
    let contents: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>("content"))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(contents, vec!["first".to_string(), "second".to_string()]);

    // 同一 (conversation, seq) 唯一
    let dup = conn.execute(
        "INSERT INTO ai_messages
            (id, conversation_id, role, seq, content, created_at)
         VALUES ('m3', 'book-1', 'user', 0, 'dup', '2026-07-06T00:00:00Z')",
        [],
    );
    assert!(dup.is_err());

    // 清空：消息删除，会话行留墓碑
    conn.execute(
        "DELETE FROM ai_messages WHERE conversation_id = 'book-1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE ai_conversations SET cleared_at = '2026-07-06T01:00:00Z' WHERE id = 'book-1'",
        [],
    )
    .unwrap();
    let (count, cleared): (i64, Option<String>) = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = 'book-1'),
                    cleared_at
             FROM ai_conversations WHERE id = 'book-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(count, 0);
    assert!(cleared.is_some());
}

#[test]
fn ai_message_error_column_roundtrips() {
    let conn = migrated_conn();
    conn.execute(
        "INSERT INTO ai_conversations (id, created_at, updated_at)
         VALUES ('book-1', '2026-07-10T00:00:00Z', '2026-07-10T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ai_messages
            (id, conversation_id, role, seq, content, created_at, error)
         VALUES ('m1', 'book-1', 'assistant', 0, '', '2026-07-10T00:00:00Z', 'network reset')",
        [],
    )
    .unwrap();
    let error: Option<String> = conn
        .query_row(
            "SELECT error FROM ai_messages WHERE id = 'm1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(error.as_deref(), Some("network reset"));
    // 旧行（无 error）读出 NULL
    conn.execute(
        "INSERT INTO ai_messages
            (id, conversation_id, role, seq, content, created_at)
         VALUES ('m2', 'book-1', 'user', 1, 'q', '2026-07-10T00:00:00Z')",
        [],
    )
    .unwrap();
    let none: Option<String> = conn
        .query_row(
            "SELECT error FROM ai_messages WHERE id = 'm2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(none.is_none());
}

#[test]
fn memory_upsert_roundtrips_and_updates() {
    let conn = migrated_conn();
    let insert = |importance: f64, evidence: i64| {
        conn.execute(
            "INSERT INTO memories
                    (id, scope, kind, content, importance, evidence_count, pinned, status,
                     created_at, updated_at)
                 VALUES ('m1','user','preference','喜欢陀思妥耶夫斯基',?1,?2,0,'active',
                         '2026-07-01T00:00:00Z','2026-07-01T00:00:00Z')
                 ON CONFLICT(id) DO UPDATE SET
                    importance=excluded.importance, evidence_count=excluded.evidence_count",
            params![importance, evidence],
        )
        .unwrap();
    };
    insert(0.35, 1);
    insert(0.5, 2); // reinforce 语义：同 id 覆盖

    let memory = conn
        .query_row("SELECT * FROM memories WHERE id = 'm1'", [], row_to_memory)
        .unwrap();
    assert_eq!(memory.scope, "user");
    assert_eq!(memory.evidence_count, 2);
    assert!(!memory.pinned);
    assert_eq!(memory.status, "active");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn externalize_moves_inline_blobs_to_files_and_drops_table() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut conn = test_conn();
    run_migrations(&mut conn).expect("migrate");
    conn.execute(
        "INSERT INTO blobs (key, data) VALUES ('bookfile:b1', X'DEADBEEF')",
        [],
    )
    .unwrap();

    externalize_inline_blobs(&conn, dir.path()).expect("externalize");

    assert!(!table_exists(&conn, "blobs"));
    let bytes = get_blob_inner(&conn, dir.path(), "bookfile:b1").unwrap();
    assert_eq!(bytes, vec![0xDE, 0xAD, 0xBE, 0xEF]);
    let (kind, size, sha, uri): (String, i64, String, String) = conn
        .query_row(
            "SELECT kind, byte_size, sha256, storage_uri FROM blob_objects
                 WHERE key = 'bookfile:b1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(kind, "book_source");
    assert_eq!(size, 4);
    assert_eq!(
        sha,
        "5f78c33274e43fa9de5659265c1d917e25c03722dcb0b8d27db8d5feaa813953"
    );
    assert_eq!(uri, "blobs/bookfile%3Ab1");
    assert!(dir.path().join(&uri).is_file());
    // Externalized user blobs enter the push outbox.
    let pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM blob_sync_state WHERE blob_key = 'bookfile:b1'
                 AND push_state = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 1);
    // Second run is a no-op (table gone).
    externalize_inline_blobs(&conn, dir.path()).expect("idempotent");
}

#[test]
fn blob_put_get_delete_roundtrip() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = migrated_conn();
    let payload = b"hello book".to_vec();

    let result = put_blob_inner(
        &conn,
        dir.path(),
        "bookfile:b2",
        Some("application/epub+zip"),
        &payload,
    )
    .expect("put");
    assert_eq!(result.byte_size, 10);
    assert_eq!(
        get_blob_inner(&conn, dir.path(), "bookfile:b2").unwrap(),
        payload
    );

    delete_blob_inner(&conn, dir.path(), "bookfile:b2").expect("delete");
    assert!(get_blob_inner(&conn, dir.path(), "bookfile:b2")
        .unwrap()
        .is_empty());
    // Tombstone survives; bytes and outbox row are gone.
    let (deleted_at, uri): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT deleted_at, storage_uri FROM blob_objects WHERE key = 'bookfile:b2'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert!(deleted_at.is_some());
    assert!(uri.is_none());
    let outbox: i64 = conn
        .query_row("SELECT COUNT(*) FROM blob_sync_state", [], |row| row.get(0))
        .unwrap();
    assert_eq!(outbox, 0);
    // Re-putting the same key clears the tombstone (a re-import revives it).
    put_blob_inner(&conn, dir.path(), "bookfile:b2", None, &payload).expect("re-put");
    assert_eq!(
        get_blob_inner(&conn, dir.path(), "bookfile:b2").unwrap(),
        payload
    );
}

#[test]
fn append_events_fills_envelope_and_outbox_once() {
    let mut conn = migrated_conn();
    append_events_inner(&mut conn, &[event("e1", 1_700_000_000_000, 0)]).expect("append");
    // Duplicate delivery (same id) is ignored and does not re-enter the outbox.
    append_events_inner(&mut conn, &[event("e1", 1_700_000_000_000, 0)]).expect("re-append");

    let (schema_version, actor, created_at, aggregate_id): (i64, String, String, String) = conn
        .query_row(
            "SELECT schema_version, actor_id, created_at, aggregate_id
                 FROM domain_events WHERE id = 'e1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(schema_version, 1);
    assert_eq!(actor, "local");
    assert!(created_at.starts_with("2023-11-14T"), "got {created_at}");
    assert_eq!(aggregate_id, "agg-e1");

    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM domain_events", [], |row| row.get(0))
        .unwrap();
    let outbox: i64 = conn
        .query_row("SELECT COUNT(*) FROM event_sync_state", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(events, 1);
    assert_eq!(outbox, 1);
}

#[test]
fn ensure_local_device_is_stable() {
    let conn = migrated_conn();
    let first = ensure_local_device(&conn).expect("first");
    let second = ensure_local_device(&conn).expect("second");
    assert_eq!(first, second);
    assert!(!first.is_empty());
}

#[test]
fn fts_segment_bigrams_cjk_and_keeps_words() {
    assert_eq!(fts_segment("养成好习惯"), "养成 成好 好习 习惯");
    assert_eq!(fts_segment("read 好书 now"), "read 好书 now");
    assert_eq!(fts_segment("书"), "书");
    assert_eq!(fts_segment("読み方"), "読み み方"); // kana + han mix is one run
    assert_eq!(fts_segment("a,b"), "a b");
    assert_eq!(fts_segment("!!"), "");
}

#[test]
fn fts_match_expr_phrases_and_prefixes() {
    assert_eq!(fts_match_expr("习惯").as_deref(), Some("\"习惯\""));
    assert_eq!(fts_match_expr("养成好").as_deref(), Some("\"养成 成好\""));
    assert_eq!(fts_match_expr("hab").as_deref(), Some("\"hab\"*"));
    assert_eq!(fts_match_expr("习").as_deref(), Some("\"习\"*"));
    assert_eq!(
        fts_match_expr("习惯 habit").as_deref(),
        Some("\"习惯\" \"habit\"*")
    );
    // fts5 operators in user input are neutralized by quoting.
    assert_eq!(fts_match_expr("AND").as_deref(), Some("\"AND\"*"));
    assert_eq!(fts_match_expr("!!").as_deref(), None);
}

fn insert_annotation(conn: &Connection, id: &str, kind: &str, text: &str, content: Option<&str>) {
    conn.execute(
        "INSERT INTO annotations
                (id, book_id, type, text, content, created_at, updated_at)
             VALUES (?1, 'book-1', ?2, ?3, ?4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, kind, text, content],
    )
    .expect("insert annotation");
}

fn search_ids(conn: &Connection, query: &str) -> Vec<String> {
    annotations_search_inner(conn, query, None, None)
        .expect("search")
        .into_iter()
        .map(|a| a.id)
        .collect()
}

#[test]
fn fts_search_matches_chinese_and_english_via_triggers() {
    let conn = migrated_conn();
    insert_annotation(&conn, "h1", "highlight", "养成好习惯需要时间", None);
    insert_annotation(
        &conn,
        "n1",
        "note",
        "quoted passage",
        Some("thoughts on habits"),
    );
    insert_annotation(&conn, "a1", "ask", "什么是复利效应", None);

    assert_eq!(search_ids(&conn, "习惯"), vec!["h1"]);
    assert_eq!(search_ids(&conn, "习"), vec!["h1"]); // 1-char prefix hits bigram
    assert_eq!(search_ids(&conn, "habit"), vec!["n1"]); // note CONTENT indexed, prefix
    assert_eq!(search_ids(&conn, "复利"), vec!["a1"]);
    assert!(search_ids(&conn, "不存在的词").is_empty());
    assert!(search_ids(&conn, "??").is_empty());

    // Filters compose with MATCH.
    let only_notes = annotations_search_inner(&conn, "habit", None, Some("note")).unwrap();
    assert_eq!(only_notes.len(), 1);
    let wrong_book = annotations_search_inner(&conn, "习惯", Some("book-2"), None).unwrap();
    assert!(wrong_book.is_empty());

    // Update re-indexes; delete drops the row from the index.
    conn.execute(
        "UPDATE annotations SET text = '完全不同的内容' WHERE id = 'h1'",
        [],
    )
    .unwrap();
    assert!(search_ids(&conn, "习惯").is_empty());
    assert_eq!(search_ids(&conn, "不同"), vec!["h1"]);
    conn.execute("DELETE FROM annotations WHERE id = 'h1'", [])
        .unwrap();
    assert!(search_ids(&conn, "不同").is_empty());
}

#[test]
fn fts_migration_populates_existing_rows() {
    let mut conn = test_conn();
    run_migrations_up_to(&mut conn, 3).expect("stage v3");
    insert_annotation(&conn, "old-h", "highlight", "旧数据里的习惯养成", None);
    run_migrations(&mut conn).expect("migrate to v4");
    assert_eq!(search_ids(&conn, "习惯"), vec!["old-h"]);
}

#[test]
fn blob_file_names_are_safe_and_injective() {
    assert_eq!(blob_file_name("bookfile:b1"), "bookfile%3Ab1");
    assert_ne!(blob_file_name("a:b"), blob_file_name("a%3Ab"));
    assert!(blob_file_name("font:https://x/y?z=1")
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._-%".contains(c)));
}
