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
        origin: None,
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
    // Tracks MIGRATIONS rather than a literal, so appending a migration can't
    // silently rot this test the way a hard-coded version did.
    let latest = MIGRATIONS.iter().map(|(v, _, _)| *v).max().unwrap();
    assert_eq!(version, latest);
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
        "reading_time_totals",
        "reading_time_daily",
        "reading_time_hourly",
        "plugin_documents",
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
fn blob_range_reads_only_the_requested_bytes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = migrated_conn();
    let payload = b"0123456789abcdef";
    put_blob_inner(
        &conn,
        dir.path(),
        "bookfile:range",
        Some("application/pdf"),
        payload,
    )
    .expect("put");

    let (_, info) = get_blob_record_inner(&conn, dir.path(), "bookfile:range")
        .expect("info")
        .expect("record");
    assert_eq!(info.byte_size, payload.len() as u64);
    assert_eq!(info.mime_type.as_deref(), Some("application/pdf"));
    assert_eq!(
        get_blob_range_inner(&conn, dir.path(), "bookfile:range", 4, 6).unwrap(),
        b"456789"
    );
    assert_eq!(
        get_blob_range_inner(&conn, dir.path(), "bookfile:range", 14, 20).unwrap(),
        b"ef"
    );
    assert!(
        get_blob_range_inner(&conn, dir.path(), "bookfile:range", 99, 4)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn blob_file_import_uses_native_copy_and_registers_hash() {
    let data_dir = tempfile::tempdir().expect("data dir");
    let source_dir = tempfile::tempdir().expect("source dir");
    let source_path = source_dir.path().join("large.epub");
    let payload = vec![0xA5; 3 * 1024 * 1024 + 17];
    std::fs::write(&source_path, &payload).expect("write source");
    let conn = migrated_conn();

    let result = put_blob_from_file_inner(
        &conn,
        data_dir.path(),
        "bookfile:streamed",
        Some("application/epub+zip"),
        &source_path,
    )
    .expect("stream import");

    assert_eq!(result.byte_size, payload.len() as i64);
    assert_eq!(
        result.sha256,
        format!("{:x}", Sha256::digest(&payload))
    );
    assert_eq!(
        get_blob_inner(&conn, data_dir.path(), "bookfile:streamed").unwrap(),
        payload
    );
    assert!(!data_dir.path().join("blobs/bookfile%3Astreamed.tmp").exists());
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

// ─── Event application, rebuild, and drift detection ─────────────────────────

fn ev(id: &str, wall: i64, kind: &str, payload: serde_json::Value) -> EventRow {
    EventRow {
        id: id.to_string(),
        event_type: kind.to_string(),
        hlc: Hlc {
            wall_ms: wall,
            counter: 0,
            device_id: "device-a".to_string(),
        },
        schema_version: None,
        aggregate_type: None,
        aggregate_id: None,
        actor_id: None,
        origin: None,
        created_at: None,
        payload,
    }
}

fn imported(id: &str, wall: i64, book: &str, title: &str) -> EventRow {
    ev(
        id,
        wall,
        "book.imported",
        serde_json::json!({
            "bookId": book, "title": title, "author": "作者",
            "format": "epub", "fileName": "b.epub", "fileSize": 42,
            "sourceBlobKey": format!("bookfile:{book}"),
        }),
    )
}

fn scalar<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn rust_and_sqlite_agree_on_event_timestamps() {
    // apply_event derives created_at in Rust; append_events derives it in SQL.
    // A mismatch would make replayed rows differ from live ones by timestamp
    // alone, which would look like drift forever.
    let conn = migrated_conn();
    for wall in [0_i64, 1, 1_700_000_000_123, 999_999_999_999, 1_500_000_000_000] {
        let sql: String = conn
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1 / 1000.0, 'unixepoch')",
                params![wall],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(apply::iso_from_millis(wall), sql, "wall={wall}");
    }
    assert_eq!(apply::iso_from_millis(0), "1970-01-01T00:00:00.000Z");
}

#[test]
fn commit_derives_projections_from_events_alone() {
    let mut conn = migrated_conn();
    let report = commit_events_inner(
        &mut conn,
        &[
            ev(
                "e0",
                1_000,
                "collection.created",
                serde_json::json!({ "collectionId": "c1", "name": "科幻" }),
            ),
            imported("e1", 1_001, "b1", "沙丘"),
            ev(
                "e2",
                1_002,
                "book.addedToCollection",
                serde_json::json!({ "bookId": "b1", "collectionId": "c1" }),
            ),
            ev(
                "e3",
                1_003,
                "highlight.created",
                serde_json::json!({
                    "highlightId": "h1", "bookId": "b1", "anchor": "epubcfi(/6/4)",
                    "text": "恐惧是思维杀手", "color": "yellow",
                }),
            ),
            ev(
                "e4",
                1_004,
                "reading.progressed",
                serde_json::json!({
                    "bookId": "b1", "locator": "epubcfi(/6/8)", "progressPercent": 37.5,
                    "status": "reading", "currentLocation": 30, "totalLocations": 80,
                }),
            ),
        ],
    )
    .unwrap();
    assert_eq!(report.appended, 5);
    assert_eq!(report.applied, 5);

    // No frontend write touched these tables — every row came from the log.
    assert_eq!(scalar::<String>(&conn, "SELECT title FROM books WHERE id='b1'"), "沙丘");
    assert_eq!(
        scalar::<String>(&conn, "SELECT collection_id FROM books WHERE id='b1'"),
        "c1"
    );
    assert_eq!(
        scalar::<f64>(&conn, "SELECT progress_percent FROM books WHERE id='b1'"),
        37.5
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT reading_status FROM books WHERE id='b1'"),
        "reading"
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT color FROM annotations WHERE id='h1'"),
        "yellow"
    );
    // The projection carries ReaderProgress verbatim, anchor included, and
    // encodes numbers the way the frontend's JSON.stringify does.
    let progress: String = scalar(&conn, "SELECT progress_json FROM books WHERE id='b1'");
    assert!(progress.contains("epubcfi(/6/8)"), "progress={progress}");
    assert!(progress.contains("\"progressPercent\":37.5"), "progress={progress}");
}

#[test]
fn redelivered_events_do_not_double_apply() {
    let mut conn = migrated_conn();
    let batch = vec![
        imported("e1", 1_000, "b1", "沙丘"),
        ev(
            "e2",
            1_001,
            "reading.timeRecorded",
            serde_json::json!({
                "bookId": "b1", "ms": 60_000, "atEpochMs": 1_700_000_000_000_i64,
                "localDay": "2023-11-15", "localHour": 6,
            }),
        ),
    ];
    let first = commit_events_inner(&mut conn, &batch).unwrap();
    let second = commit_events_inner(&mut conn, &batch).unwrap();

    assert_eq!(first.appended, 2);
    assert_eq!(second.appended, 0, "duplicate ids must be rejected by the log");
    // reading_time accumulates, so a second apply would silently double it.
    assert_eq!(
        scalar::<i64>(&conn, "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'"),
        60_000
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT ms FROM reading_time_daily WHERE book_id='b1'"),
        60_000
    );
}

#[test]
fn a_failed_event_rolls_back_the_whole_commit() {
    let mut conn = migrated_conn();
    let result = commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "b1", "沙丘"),
            // Missing `title`: a projection column that cannot be defaulted.
            ev(
                "e2",
                1_001,
                "book.imported",
                serde_json::json!({ "bookId": "b2", "format": "epub", "fileName": "x", "fileSize": 1 }),
            ),
        ],
    );
    assert!(result.is_err(), "malformed payload must fail the commit");
    // Atomicity: the good event in the same batch left no trace either.
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 0);
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM domain_events"), 0);
}

#[test]
fn rebuild_reproduces_projections_and_keeps_cover_cache() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "b1", "沙丘"),
            imported("e2", 1_001, "b2", "神经漫游者"),
            ev(
                "e3",
                1_002,
                "note.created",
                serde_json::json!({
                    "noteId": "n1", "bookId": "b1", "quotedText": "引用", "body": "笔记正文",
                }),
            ),
            ev("e4", 1_003, "book.removed", serde_json::json!({ "bookId": "b2" })),
        ],
    )
    .unwrap();
    // Covers are extracted locally from object-storage content, not replayed.
    conn.execute(
        "UPDATE books SET cover_url = 'data:image/png;base64,AAA', cover_checked = 1 WHERE id='b1'",
        [],
    )
    .unwrap();

    let before_books = scalar::<i64>(&conn, "SELECT COUNT(*) FROM books");
    let report = {
        let tx = conn.transaction().unwrap();
        let r = replay_into(&tx).unwrap();
        tx.commit().unwrap();
        r
    };

    assert_eq!(report.events_replayed, 4);
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), before_books);
    // book.removed replayed: b2 stays gone, and so do its annotations.
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books WHERE id='b2'"), 0);
    assert_eq!(
        scalar::<String>(&conn, "SELECT content FROM annotations WHERE id='n1'"),
        "笔记正文"
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT text FROM annotations WHERE id='n1'"),
        "引用"
    );
    // The local cache survived the wipe — no re-extraction pass needed.
    assert_eq!(
        scalar::<String>(&conn, "SELECT cover_url FROM books WHERE id='b1'"),
        "data:image/png;base64,AAA"
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT cover_checked FROM books WHERE id='b1'"),
        1
    );
}

#[test]
fn verify_passes_when_every_row_came_from_the_log() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "b1", "沙丘"),
            ev(
                "e2",
                1_001,
                "highlight.created",
                serde_json::json!({ "highlightId": "h1", "bookId": "b1", "text": "片段" }),
            ),
            ev(
                "e3",
                1_002,
                "memory.promoted",
                serde_json::json!({
                    "memoryId": "m1", "kind": "preference", "scope": "book",
                    "bookId": "b1", "content": "偏好长句", "importance": 0.7,
                }),
            ),
        ],
    )
    .unwrap();

    let tx = conn.transaction().unwrap();
    let mut live = std::collections::BTreeMap::new();
    for spec in apply::DIFF_SPECS {
        live.insert(spec.table, snapshot_table(&tx, spec).unwrap());
    }
    replay_into(&tx).unwrap();
    for spec in apply::DIFF_SPECS {
        assert_eq!(
            snapshot_table(&tx, spec).unwrap(),
            live[spec.table],
            "table {} differs after replay",
            spec.table
        );
    }
    tx.rollback().unwrap();
}

#[test]
fn verify_detects_a_projection_write_the_log_never_saw() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("e1", 1_000, "b1", "沙丘")]).unwrap();
    // Exactly the old failure mode: a row written straight to the projection
    // while its event append was dropped.
    conn.execute(
        "INSERT INTO annotations (id, book_id, type, text, created_at, updated_at)
         VALUES ('ghost', 'b1', 'highlight', '幽灵高亮', '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let spec = apply::DIFF_SPECS
        .iter()
        .find(|s| s.table == "annotations")
        .unwrap();
    let tx = conn.transaction().unwrap();
    let live = snapshot_table(&tx, spec).unwrap();
    replay_into(&tx).unwrap();
    let replayed = snapshot_table(&tx, spec).unwrap();
    tx.rollback().unwrap();

    assert_eq!(live.len(), 1, "the ghost row is present live");
    assert!(replayed.is_empty(), "a replay cannot produce it");
    assert_ne!(live, replayed, "verify must flag this as drift");
}

#[test]
fn unknown_and_unprojected_events_are_accepted_but_change_nothing() {
    let mut conn = migrated_conn();
    let report = commit_events_inner(
        &mut conn,
        &[
            // A type only a newer build knows about.
            ev("e1", 1_000, "book.teleported", serde_json::json!({ "bookId": "b9" })),
            ev("e2", 1_001, "profile.updated", serde_json::json!({ "displayName": "破晓" })),
            ev(
                "e3",
                1_002,
                "book.coverExtracted",
                serde_json::json!({ "bookId": "b9", "status": "ready" }),
            ),
        ],
    )
    .unwrap();
    assert_eq!(report.appended, 3, "the log keeps everything");
    assert_eq!(report.applied, 0, "none of them owns a projection row");
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 0);
}

#[test]
fn whole_percentages_serialize_without_a_fractional_part() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "b1", "沙丘"),
            ev(
                "e2",
                1_001,
                "reading.progressed",
                serde_json::json!({
                    "bookId": "b1", "locator": "epubcfi(/6/2)", "progressPercent": 63,
                    "currentLocation": 10, "totalLocations": 16,
                }),
            ),
        ],
    )
    .unwrap();
    let progress: String = scalar(&conn, "SELECT progress_json FROM books WHERE id='b1'");
    // JS writes `63`; Rust must not write `63.0` for the same value, or every
    // historical row would read as drift purely over formatting.
    assert!(progress.contains("\"progressPercent\":63"), "progress={progress}");
    assert!(!progress.contains("63.0"), "progress={progress}");
}

#[test]
fn reading_time_genesis_reproduces_the_aggregates_exactly() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("e1", 1_000, "b1", "沙丘")]).unwrap();
    // Pre-event-era state: aggregates written directly, no events behind them.
    for (day, ms) in [("2026-07-01", 3_600_000_i64), ("2026-07-02", 1_800_000)] {
        conn.execute(
            "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES ('b1', ?1, ?2)",
            params![day, ms],
        )
        .unwrap();
    }
    for (hour, ms) in [(9_i64, 4_000_000_i64), (22, 1_400_000)] {
        conn.execute(
            "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES ('b1', ?1, ?2)",
            params![hour, ms],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
         VALUES ('b1', 5400000, 1751328000000, 1751500000000)",
        [],
    )
    .unwrap();

    fn aggregates(c: &Connection) -> (i64, i64, i64, Vec<(String, i64)>, Vec<(i64, i64)>) {
        let (total, first, last) = c
            .query_row(
                "SELECT total_ms, first_started_at, last_read_at
                   FROM reading_time_totals WHERE book_id = 'b1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let mut d = c
            .prepare("SELECT local_day, ms FROM reading_time_daily ORDER BY local_day")
            .unwrap();
        let days = d
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let mut h = c
            .prepare("SELECT local_hour, ms FROM reading_time_hourly ORDER BY local_hour")
            .unwrap();
        let hours = h
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        (total, first, last, days, hours)
    }
    let original = aggregates(&conn);

    let synthesized = reading_time_genesis_inner(&mut conn).unwrap();
    assert!(synthesized > 0, "expected synthesized ticks");
    assert_eq!(
        aggregates(&conn),
        original,
        "reconstruction must leave every statistic untouched"
    );

    // Second run is a no-op: the log now covers the aggregates exactly, so the
    // deficit it computes is zero. (A count-based guard would be wrong here —
    // a library can hold a FEW real timeRecorded events from the old path.)
    assert_eq!(reading_time_genesis_inner(&mut conn).unwrap(), 0);

    // And now the log stands on its own: wipe the tables, replay, same numbers.
    // This is what makes rebuild_projections safe on a library with history.
    let tx = conn.transaction().unwrap();
    replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(aggregates(&conn), original, "a full replay must reproduce them");
}

#[test]
fn reading_time_genesis_tops_up_around_events_already_in_the_log() {
    let mut conn = migrated_conn();
    // One real tick made it into the log through the old best-effort path...
    commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "b1", "沙丘"),
            ev(
                "e2",
                1_001,
                "reading.timeRecorded",
                serde_json::json!({
                    "bookId": "b1", "ms": 600_000, "atEpochMs": 1_751_328_000_000_i64,
                    "localDay": "2026-07-01", "localHour": 9,
                }),
            ),
        ],
    )
    .unwrap();
    // ...while the projection accumulated far more that never got logged.
    conn.execute(
        "UPDATE reading_time_daily SET ms = 3600000 WHERE book_id='b1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE reading_time_hourly SET ms = 3600000 WHERE book_id='b1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE reading_time_totals SET total_ms = 3600000 WHERE book_id='b1'",
        [],
    )
    .unwrap();

    let synthesized = reading_time_genesis_inner(&mut conn).unwrap();
    assert!(synthesized > 0);

    // Replaying everything must land on the projection's value — not on
    // 3_600_000 + 600_000, which is what synthesizing the full amount on top of
    // the already-logged tick would produce.
    let tx = conn.transaction().unwrap();
    replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(
        scalar::<i64>(&conn, "SELECT ms FROM reading_time_daily WHERE book_id='b1'"),
        3_600_000
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'"),
        3_600_000
    );
}

// ─── Secret storage ──────────────────────────────────────────────────────────

#[test]
fn secrets_round_trip_and_are_useless_without_the_key_file() {
    use crate::secrets::{decrypt, encrypt};
    let dir = tempfile::tempdir().unwrap();
    let sealed = encrypt(dir.path(), "sk-live-abc123").unwrap();

    // Never at rest in the clear — that is the whole point of this backend.
    assert!(!sealed.contains("sk-live"), "sealed={sealed}");
    assert_eq!(decrypt(dir.path(), &sealed).unwrap(), "sk-live-abc123");

    // Fresh nonce per write: the same plaintext must not seal to the same blob.
    let again = encrypt(dir.path(), "sk-live-abc123").unwrap();
    assert_ne!(sealed, again);
    assert_eq!(decrypt(dir.path(), &again).unwrap(), "sk-live-abc123");

    // Walking off with the database alone yields ciphertext and nothing else.
    let elsewhere = tempfile::tempdir().unwrap();
    assert!(decrypt(elsewhere.path(), &sealed).is_err());

    // Tampering is detected rather than silently decrypting to garbage (GCM).
    let mut corrupted = sealed.clone().into_bytes();
    let last = corrupted.len() - 2;
    corrupted[last] = if corrupted[last] == b'A' { b'B' } else { b'A' };
    assert!(decrypt(dir.path(), &String::from_utf8(corrupted).unwrap()).is_err());
}

#[test]
fn the_secret_key_file_is_owner_only() {
    use crate::secrets::encrypt;
    let dir = tempfile::tempdir().unwrap();
    encrypt(dir.path(), "x").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join("secret.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "got {:o}", mode & 0o777);
    }
}
