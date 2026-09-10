use super::super::{
    apply_connection_pragmas,
    blobs::{get_blob_inner, put_blob_inner},
    commit_events_inner,
    library_cleanup::release_book_files_inner,
    register_sql_functions, run_migrations, Hlc,
};
use super::*;
use serde_json::json;

fn event(id: &str, kind: &str, book: &str, payload: serde_json::Value, counter: i64) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        payload,
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: Some("book".into()),
        aggregate_id: Some(book.into()),
        actor_id: None,
        origin: Some("plugin:merge".into()),
        created_at: None,
    }
}
fn db(dir: &Path) -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let sha = format!("{:x}", Sha256::digest(b"same book"));
    for (counter, id) in ["a", "b", "c"].iter().enumerate() {
        commit_events_inner(&mut conn, &[event(&format!("import-{id}"), "book.imported", id,
            json!({"bookId":id,"title":id,"format":"epub","fileName":"book.epub","sourceBlobKey":format!("bookfile:{id}"),"sourceSha256":sha,"fileSize":9}), counter as i64)]).unwrap();
    }
    put_blob_inner(&conn, dir, "bookfile:b", None, b"same book").unwrap();
    conn
}
fn merges(preview: &MergePreview) -> Vec<EventRow> {
    preview
        .merged
        .iter()
        .enumerate()
        .map(|(i, member)| {
            event(
                &format!("merge-{}", member.id),
                "book.merged",
                &preview.keep.id,
                json!({"keepId":preview.keep.id,"mergedId":member.id}),
                100 + i as i64,
            )
        })
        .collect()
}
fn count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM domain_events", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn same_content_preview_uses_deterministic_keeper_and_commit_preserves_local_original_and_aliases()
{
    let dir = tempfile::tempdir().unwrap();
    let mut conn = db(dir.path());
    let page = duplicate_page(&conn, 0, 20).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.groups[0].count, 3);
    let preview = merge_preview(&conn, "b").unwrap().unwrap();
    assert_eq!(preview.keep.id, "a");
    let receipt = merge_commit(
        &mut conn,
        dir.path(),
        "b",
        &preview.revision,
        &merges(&preview),
    )
    .unwrap();
    assert_eq!(receipt.redirects.len(), 2);
    assert_eq!(receipt.keep_id, "a");
    assert_eq!(
        conn.query_row("SELECT count(*) FROM books", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        get_blob_inner(&conn, dir.path(), "bookfile:a").unwrap(),
        b"same book"
    );
    assert!(merge_preview(&conn, "a").unwrap().is_none());
    assert!(merge_commit(
        &mut conn,
        dir.path(),
        "a",
        &preview.revision,
        &merges(&preview)
    )
    .is_err());
}

#[test]
fn stale_previews_forged_membership_and_partial_event_failure_do_not_merge_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = db(dir.path());
    let old = merge_preview(&conn, "a").unwrap().unwrap();
    let before = count(&conn);
    conn.execute("UPDATE books SET title='changed' WHERE id='b'", [])
        .unwrap();
    assert!(merge_commit(&mut conn, dir.path(), "a", &old.revision, &merges(&old)).is_err());
    let current = merge_preview(&conn, "a").unwrap().unwrap();
    let mut forged = merges(&current);
    forged[1].payload["mergedId"] = json!("unrelated");
    assert!(merge_commit(&mut conn, dir.path(), "a", &current.revision, &forged).is_err());
    conn.execute_batch("CREATE TRIGGER reject_second_merge BEFORE INSERT ON domain_events WHEN new.id='merge-c' BEGIN SELECT RAISE(ABORT,'reject'); END;").unwrap();
    assert!(merge_commit(
        &mut conn,
        dir.path(),
        "a",
        &current.revision,
        &merges(&current)
    )
    .is_err());
    assert_eq!(count(&conn), before);
    assert_eq!(
        conn.query_row("SELECT count(*) FROM books", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        get_blob_inner(&conn, dir.path(), "bookfile:b").unwrap(),
        b"same book"
    );
}

#[test]
fn inherited_cover_and_alias_assets_are_pinned_until_the_keeper_is_removed() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = db(dir.path());
    put_blob_inner(
        &conn,
        dir.path(),
        "cover:b",
        Some("image/png"),
        b"cover bytes",
    )
    .unwrap();
    commit_events_inner(
        &mut conn,
        &[event(
            "cover",
            "book.coverExtracted",
            "b",
            json!({"bookId":"b","status":"ready","coverBlobKey":"cover:b"}),
            50,
        )],
    )
    .unwrap();
    let preview = merge_preview(&conn, "a").unwrap().unwrap();
    merge_commit(
        &mut conn,
        dir.path(),
        "a",
        &preview.revision,
        &merges(&preview),
    )
    .unwrap();
    assert_eq!(
        conn.query_row("SELECT cover_blob_key FROM books WHERE id='a'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "cover:b"
    );
    assert!(release_book_files_inner(&mut conn, dir.path(), &["b".into()]).is_err());
    assert_eq!(
        get_blob_inner(&conn, dir.path(), "cover:b").unwrap(),
        b"cover bytes"
    );
    commit_events_inner(
        &mut conn,
        &[event(
            "remove",
            "book.removed",
            "a",
            json!({"bookId":"a"}),
            200,
        )],
    )
    .unwrap();
    release_book_files_inner(&mut conn, dir.path(), &["a".into(), "b".into(), "c".into()]).unwrap();
    assert!(get_blob_inner(&conn, dir.path(), "cover:b")
        .unwrap()
        .is_empty());
}
