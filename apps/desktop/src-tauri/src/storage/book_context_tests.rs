use super::super::book_context::book_context_snapshot_inner;
use super::super::context_bundle_publication::{
    context_bundle_publish_inner, context_bundle_source_revision_inner,
};
use super::*;
use serde_json::{json, Value};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle-book.fixture.json"
    ))
    .unwrap()
}
fn seeded() -> Connection {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("book", 100, "book-one", "Book")]).unwrap();
    let source = fixture();
    conn.execute(
        "UPDATE books SET reading_status='reading',progress_json=?1 WHERE id='book-one'",
        [json!({"href":source["href"]}).to_string()],
    )
    .unwrap();
    conn.execute("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES('m1','book:book-one','insight','Book observation',0.5,1,'now','now')", []).unwrap();
    conn.execute("INSERT INTO annotations(id,book_id,type,chapter_href,text,content,created_at,updated_at) VALUES('a1','book-one','note','c1.xhtml#note','Quoted passage',?1,'now','now')", [source["annotations"][0]["note"].as_str().unwrap()]).unwrap();
    conn.execute("INSERT INTO chapter_digests(book_id,chapter_index,chapter_href,summary,characters_json,relations_json,digest_version,updated_at) VALUES('book-one',0,'c1.xhtml','Opening chapter',?1,?2,2,'now')",
        rusqlite::params![source["digests"][0]["characters"].as_str().unwrap(), source["digests"][0]["relations"].as_str().unwrap()]).unwrap();
    conn
}

#[test]
fn book_snapshot_matches_shared_fixture_and_excludes_other_scopes_and_inactive_memories() {
    let mut conn = seeded();
    for (id, scope, status) in [
        ("user", "user", "active"),
        ("other", "book:other", "active"),
        ("forgotten", "book:book-one", "forgotten"),
        ("superseded", "book:book-one", "superseded"),
    ] {
        conn.execute("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,status,created_at,updated_at) VALUES(?1,?2,'fact','PRIVATE',0.5,1,?3,'now','now')", rusqlite::params![id,scope,status]).unwrap();
    }
    conn.execute_batch("ALTER TABLE ai_messages RENAME TO hidden_messages;")
        .unwrap();
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "book-one").unwrap(),
        fixture()
    );
    assert_eq!(
        scalar::<i64>(&conn, "SELECT count(*) FROM context_bundles"),
        0
    );
}

#[test]
fn book_snapshot_rejects_missing_bad_scope_corrupt_position_and_actual_read_failure() {
    let mut conn = seeded();
    for id in ["", " ", "bad\0id"] {
        assert_eq!(
            book_context_snapshot_inner(&mut conn, id).unwrap_err().code,
            "memory/invalid-input"
        );
    }
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "other")
            .unwrap_err()
            .code,
        "reader/book-not-found"
    );
    assert_eq!(
        book_context_snapshot_inner(&mut conn, &"x".repeat(257))
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    for raw in ["broken", "[]", "{\"href\":1}"] {
        conn.execute("UPDATE books SET progress_json=?1", [raw])
            .unwrap();
        assert!(book_context_snapshot_inner(&mut conn, "book-one").is_err());
    }
    conn.execute("UPDATE books SET progress_json=NULL", [])
        .unwrap();
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "book-one").unwrap()["href"],
        Value::Null
    );
    conn.execute("ALTER TABLE annotations RENAME TO hidden_annotations", [])
        .unwrap();
    assert!(book_context_snapshot_inner(&mut conn, "book-one").is_err());
}

#[test]
fn book_snapshot_has_explicit_source_bounds_not_a_silent_limit() {
    let mut conn = seeded();
    conn.execute(
        "UPDATE memories SET content=?1",
        ["x".repeat(8 * 1024 * 1024 + 1)],
    )
    .unwrap();
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "book-one")
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
    conn.execute("UPDATE memories SET content='small'", [])
        .unwrap();
    conn.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<8193)
        INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) SELECT 'row-'||x,'book:book-one','fact','small',0.5,1,'now','now' FROM n;").unwrap();
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "book-one")
            .unwrap_err()
            .code,
        "memory/invalid-input"
    );
}

#[test]
fn blob_registry_changes_including_aba_and_removal_fence_publication_and_rollback_does_not() {
    let mut conn = seeded();
    let dir = tempfile::tempdir().unwrap();
    put_blob_inner(&conn, dir.path(), "booktext:book-one", None, b"A").unwrap();
    let before = context_bundle_source_revision_inner(&mut conn).unwrap();
    let snapshot = book_context_snapshot_inner(&mut conn, "book-one").unwrap();
    assert!(snapshot["textHash"].as_str().unwrap().len() == 64);
    put_blob_inner(&conn, dir.path(), "booktext:book-one", None, b"B").unwrap();
    put_blob_inner(&conn, dir.path(), "booktext:book-one", None, b"A").unwrap();
    let after = context_bundle_source_revision_inner(&mut conn).unwrap();
    assert_ne!(before, after);
    let payload: Value = serde_json::from_str(include_str!(
        "../../../../../packages/core/src/context-bundle.golden.json"
    ))
    .unwrap();
    let mut event = ev("bundle", 1000, "context.bundlePublished", payload);
    event.aggregate_type = Some("contextBundle".into());
    event.aggregate_id = Some(event.payload["version"].as_str().unwrap().into());
    event.origin = Some("user".into());
    event.hlc.device_id = ensure_local_device(&conn).unwrap();
    assert_eq!(
        context_bundle_publish_inner(&mut conn, &event, &before)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    {
        let tx = conn.transaction().unwrap();
        tx.execute("DELETE FROM blob_objects", []).unwrap();
    }
    assert_eq!(
        context_bundle_source_revision_inner(&mut conn).unwrap(),
        after
    );
    delete_blob_inner(&conn, dir.path(), "booktext:book-one").unwrap();
    assert_ne!(
        context_bundle_source_revision_inner(&mut conn).unwrap(),
        after
    );
    assert_eq!(
        book_context_snapshot_inner(&mut conn, "book-one").unwrap()["textHash"],
        Value::Null
    );
}

#[test]
fn v37_installs_blob_guards_on_existing_databases_atomically() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 36).unwrap();
    run_migrations(&mut conn).unwrap();
    for action in ["INSERT", "UPDATE", "DELETE"] {
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                [format!("context_source_blob_objects_{action}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    assert_eq!(
        scalar::<i64>(&conn, "SELECT MAX(version) FROM schema_migrations"),
        37
    );
    let mut broken = test_conn();
    super::super::schema::run_migrations_up_to(&mut broken, 36).unwrap();
    broken.execute("CREATE TRIGGER context_source_blob_objects_UPDATE AFTER UPDATE ON blob_objects BEGIN SELECT 1; END", []).unwrap();
    assert!(run_migrations(&mut broken).is_err());
    assert_eq!(
        scalar::<i64>(&broken, "SELECT MAX(version) FROM schema_migrations"),
        36
    );
    assert_eq!(
        scalar::<i64>(
            &broken,
            "SELECT count(*) FROM sqlite_master WHERE name='context_source_blob_objects_INSERT'"
        ),
        0
    );
}
