use super::super::{apply_connection_pragmas, register_sql_functions, run_migrations};
use super::*;
use serde_json::json;
fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}
fn binding(owner: &str) -> VirtualBinding {
    VirtualBinding {
        plugin_id: owner.into(),
        provider_id: "feed".into(),
        key: "source".into(),
    }
}
fn events(id: &str, owner: &str) -> Vec<EventRow> {
    [("book.imported", json!({"bookId":id,"title":"Feed","format":"virtual","fileName":"","fileSize":0,"sourceBlobKey":""})),
     ("book.coverExtracted", json!({"bookId":id,"status":"none"}))].into_iter().enumerate().map(|(i,(kind,payload))| EventRow {
        id: format!("{id}-{i}"), event_type:kind.into(), hlc:Hlc { wall_ms:1780000000000,counter:i as i64,device_id:id.into() },
        schema_version:None, aggregate_type:Some("book".into()), aggregate_id:Some(id.into()), actor_id:None,
        origin:Some(format!("plugin:{owner}")), created_at:None, payload,
    }).collect()
}
fn raw(id: &str, owner: &str) -> String {
    serde_json::to_string(&BTreeMap::from([(id, binding(owner))])).unwrap()
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[test]
fn virtual_book_creation_commits_events_projection_and_binding_or_none() {
    for reject in [false, true] {
        let mut conn = db();
        if reject {
            conn.execute_batch("CREATE TRIGGER reject_binding BEFORE INSERT ON app_kv WHEN NEW.key='read-aware-virtual-books' BEGIN SELECT RAISE(ABORT,'no binding write'); END;").unwrap();
        }
        let result = create_inner(
            &mut conn,
            &events("book", "owner"),
            "book",
            &binding("owner"),
            None,
            &raw("book", "owner"),
        );
        if reject {
            assert!(result.is_err());
            assert_eq!(count(&conn, "books"), 0);
            assert_eq!(count(&conn, "domain_events"), 0);
            assert_eq!(count(&conn, "event_sync_state"), 0);
            assert_eq!(current(&conn).unwrap(), None);
        } else {
            assert_eq!(result.unwrap().appended, 2);
            assert_eq!(count(&conn, "books"), 1);
            assert_eq!(current(&conn).unwrap(), Some(raw("book", "owner")));
        }
    }
}
#[test]
fn virtual_book_creation_rejects_stale_registry_duplicate_binding_and_forged_other_owner() {
    let mut conn = db();
    let first = raw("one", "owner");
    create_inner(
        &mut conn,
        &events("one", "owner"),
        "one",
        &binding("owner"),
        None,
        &first,
    )
    .unwrap();
    assert!(create_inner(
        &mut conn,
        &events("two", "other"),
        "two",
        &binding("other"),
        None,
        &raw("two", "other")
    )
    .is_err());
    let mut next = registry(Some(&first)).unwrap();
    next.insert("two".into(), binding("owner"));
    assert!(create_inner(
        &mut conn,
        &events("two", "owner"),
        "two",
        &binding("owner"),
        Some(&first),
        &serde_json::to_string(&next).unwrap()
    )
    .is_err());
    assert!(create_inner(
        &mut conn,
        &events("two", "other"),
        "two",
        &binding("owner"),
        Some(&first),
        &raw("two", "owner")
    )
    .is_err());
    assert_eq!(count(&conn, "books"), 1);
    assert_eq!(current(&conn).unwrap(), Some(first));
}
#[test]
fn virtual_book_recovery_prunes_only_missing_books_with_exact_registry_guard() {
    let mut conn = db();
    let first = raw("live", "owner");
    create_inner(
        &mut conn,
        &events("live", "owner"),
        "live",
        &binding("owner"),
        None,
        &first,
    )
    .unwrap();
    let mut stale = registry(Some(&first)).unwrap();
    stale.insert("orphan".into(), binding("other"));
    let stale = serde_json::to_string(&stale).unwrap();
    conn.execute(
        "UPDATE app_kv SET value_json=?1 WHERE key=?2",
        params![stale, KEY],
    )
    .unwrap();
    assert!(prune_inner(
        &mut conn,
        &["live".into()],
        Some(&stale),
        &raw("orphan", "other")
    )
    .is_err());
    assert!(prune_inner(&mut conn, &["orphan".into()], Some(&first), &first).is_err());
    prune_inner(&mut conn, &["orphan".into()], Some(&stale), &first).unwrap();
    assert_eq!(current(&conn).unwrap(), Some(first));
    assert_eq!(count(&conn, "books"), 1);
    assert!(registry(Some("{broken")).is_err());
}
#[test]
fn virtual_book_binding_survives_wal_reopen_and_recovery_does_not_recreate_a_deleted_book() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("books.sqlite");
    {
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        create_inner(
            &mut conn,
            &events("kept", "owner"),
            "kept",
            &binding("owner"),
            None,
            &raw("kept", "owner"),
        )
        .unwrap();
    }
    let mut conn = Connection::open(&path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    let saved = current(&conn).unwrap().unwrap();
    assert_eq!(saved, raw("kept", "owner"));
    assert_eq!(count(&conn, "books"), 1);
    let mut removed = events("kept", "owner").remove(0);
    removed.id = "removed".into();
    removed.event_type = "book.removed".into();
    removed.hlc.counter = 10;
    removed.payload = json!({"bookId":"kept"});
    commit_events_inner(&mut conn, &[removed]).unwrap();
    assert_eq!(count(&conn, "books"), 0);
    drop(conn);
    let mut conn = Connection::open(&path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    prune_inner(&mut conn, &["kept".into()], Some(&saved), "{}").unwrap();
    assert_eq!(count(&conn, "books"), 0);
    assert_eq!(current(&conn).unwrap(), Some("{}".into()));
}
