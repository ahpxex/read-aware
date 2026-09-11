use super::*;

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}
fn change(collection: &str, id: &str, revision: Option<&str>, kind: &str) -> PluginDocumentMutation {
    serde_json::from_value(serde_json::json!({
        "collection": collection, "id": id, "expectedRevision": revision, "kind": kind, "json": "{\"ok\":true}"
    })).unwrap()
}
fn apply(conn: &mut Connection, changes: Vec<PluginDocumentMutation>) -> Vec<PluginDocumentReceipt> {
    match plugin_docs_apply_inner(conn, "sample", changes).unwrap() {
        PluginDocumentCommitResult::Applied { documents } => documents,
        _ => panic!("expected commit"),
    }
}
fn page(conn: &mut Connection, collection: &str, cursor: Option<String>, oldest: bool) -> (Vec<PluginDocumentRow>, Option<String>) {
    match plugin_docs_page_inner(conn, "sample", collection, PluginDocumentPageQuery {
        limit: Some(1), oldest_first: Some(oldest), cursor, ..Default::default()
    }).unwrap() {
        PluginDocumentPageResult::Ready { items, next_cursor } => (items, next_cursor),
        _ => panic!("expected page"),
    }
}

#[test]
fn plugin_documents_atomic_compare_cross_collection_and_rollback() {
    let mut conn = database();
    let first = apply(&mut conn, vec![change("a", "one", None, "put"), change("b", "two", None, "put")]);
    let revision = first[0].revision.as_deref().unwrap();
    assert_eq!(revision.len(), 32);
    let conflict = plugin_docs_apply_inner(&mut conn, "sample", vec![
        change("a", "new", None, "put"), change("b", "two", None, "delete")
    ]).unwrap();
    assert!(matches!(conflict, PluginDocumentCommitResult::Conflict { index: 1 }));
    assert_eq!(page(&mut conn, "a", None, false).0.len(), 1);
    let next = apply(&mut conn, vec![change("a", "one", Some(revision), "put")]);
    assert_ne!(next[0].revision, first[0].revision);
    assert!(matches!(plugin_docs_apply_inner(&mut conn, "sample", vec![change("a", "one", Some(revision), "delete")]).unwrap(),
        PluginDocumentCommitResult::Conflict { index: 0 }));
    let check = apply(&mut conn, vec![change("a", "one", next[0].revision.as_deref(), "check"), change("a", "missing", None, "check")]);
    assert_eq!(check[0].revision, next[0].revision);
    assert_eq!(check[1].revision, None);
    conn.execute_batch("CREATE TRIGGER fail_document BEFORE INSERT ON plugin_documents WHEN new.id='fail' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    let error = plugin_docs_apply_inner(&mut conn, "sample", vec![change("a", "one", next[0].revision.as_deref(), "delete"), change("b", "fail", None, "put")]).unwrap_err();
    assert_eq!(error.code, "db/error");
    assert_eq!(page(&mut conn, "a", None, false).0[0].revision, next[0].revision.as_deref().unwrap());
    let deleted = apply(&mut conn, vec![change("a", "one", next[0].revision.as_deref(), "delete")]);
    assert_eq!(deleted[0].revision, None);
    let recreated = apply(&mut conn, vec![change("a", "one", None, "put")]);
    assert_ne!(recreated[0].revision, next[0].revision);
}

#[test]
fn plugin_documents_pages_bind_scope_and_reject_concurrent_changes() {
    let mut conn = database();
    apply(&mut conn, vec![change("a", "a", None, "put"), change("a", "b", None, "put"), change("a", "c", None, "put")]);
    conn.execute("UPDATE plugin_documents SET updated_at='same'", []).unwrap();
    for oldest in [true, false] {
        let (first, cursor) = page(&mut conn, "a", None, oldest);
        let (second, cursor2) = page(&mut conn, "a", cursor.clone(), oldest);
        let (third, end) = page(&mut conn, "a", cursor2, oldest);
        assert_eq!(vec![first[0].id.as_str(), second[0].id.as_str(), third[0].id.as_str()],
            if oldest { vec!["a", "b", "c"] } else { vec!["c", "b", "a"] });
        assert!(end.is_none());
        for (plugin, collection, book, order) in [("other", "a", None, oldest), ("sample", "b", None, oldest),
            ("sample", "a", Some("book".into()), oldest), ("sample", "a", None, !oldest)] {
            let error = plugin_docs_page_inner(&mut conn, plugin, collection, PluginDocumentPageQuery {
                cursor: cursor.clone(), book_id: book, oldest_first: Some(order), ..Default::default()
            }).unwrap_err();
            assert_eq!(error.code, "plugin/invalid-argument");
        }
    }
    let (_, cursor) = page(&mut conn, "a", None, false);
    // Writes to another collection do not invalidate this cursor.
    apply(&mut conn, vec![change("other", "x", None, "put")]);
    page(&mut conn, "a", cursor.clone(), false);
    conn.execute("UPDATE plugin_documents SET json=json WHERE collection='a' AND id='a'", []).unwrap();
    assert!(matches!(plugin_docs_page_inner(&mut conn, "sample", "a", PluginDocumentPageQuery { cursor, ..Default::default() }).unwrap(), PluginDocumentPageResult::StaleCursor));
    let (_, cursor) = page(&mut conn, "a", None, false);
    let snapshot = super::super::plugin_docs::plugin_docs_snapshot_inner(&conn, "sample").unwrap();
    let old_revision = page(&mut conn, "a", None, false).0[0].revision.clone();
    super::super::plugin_docs::plugin_docs_restore_inner(&mut conn, "sample", snapshot).unwrap();
    assert_ne!(page(&mut conn, "a", None, false).0[0].revision, old_revision);
    assert!(matches!(plugin_docs_page_inner(&mut conn, "sample", "a", PluginDocumentPageQuery { cursor, ..Default::default() }).unwrap(), PluginDocumentPageResult::StaleCursor));
}

#[test]
fn plugin_documents_invalid_input_and_byte_bounded_pages() {
    let mut conn = database();
    assert!(plugin_docs_apply_inner(&mut conn, "sample", vec![]).is_err());
    assert!(plugin_docs_apply_inner(&mut conn, "sample", vec![change("a", "a", None, "put"), change("a", "a", None, "delete")]).is_err());
    assert!(plugin_docs_apply_inner(&mut conn, "sample", vec![change("../a", "a", None, "put")]).is_err());
    for limit in [0, 201] {
        assert!(plugin_docs_page_inner(&mut conn, "sample", "a", PluginDocumentPageQuery { limit: Some(limit), ..Default::default() }).is_err());
    }
    let mut huge = change("a", "huge", None, "put");
    huge.operation = PluginDocumentOperation::Put { json: format!("\"{}\"", "x".repeat(PAGE_BYTES)), book_id: None, anchor: None };
    assert_eq!(plugin_docs_apply_inner(&mut conn, "sample", vec![huge]).unwrap_err().code, "plugin/quota-exceeded");
    let mut changes = vec![];
    for id in ["a", "b"] {
        let mut entry = change("a", id, None, "put");
        entry.operation = PluginDocumentOperation::Put { json: format!("\"{}\"", "x".repeat(PAGE_BYTES / 2)), book_id: Some("book".into()), anchor: None };
        changes.push(entry);
    }
    apply(&mut conn, changes);
    let result = plugin_docs_page_inner(&mut conn, "sample", "a", PluginDocumentPageQuery { book_id: Some("book".into()), ..Default::default() }).unwrap();
    match result {
        PluginDocumentPageResult::Ready { items, next_cursor } => { assert_eq!(items.len(), 1); assert!(next_cursor.is_some()); }
        _ => panic!("expected byte-limited page"),
    }
    let other = plugin_docs_page_inner(&mut conn, "other", "a", Default::default()).unwrap();
    assert!(matches!(other, PluginDocumentPageResult::Ready { items, next_cursor: None } if items.is_empty()));
}

#[test]
fn plugin_documents_migrate_legacy_rows_and_wipe_generations() {
    let mut conn = Connection::open_in_memory().unwrap();
    register_sql_functions(&conn).unwrap();
    conn.execute_batch(MIGRATIONS.iter().find(|(v, _, _)| *v == 10).unwrap().2).unwrap();
    conn.execute("INSERT INTO plugin_documents VALUES ('sample','a','legacy','{}',NULL,NULL,'old')", []).unwrap();
    conn.execute_batch(include_str!("plugin_docs_v32.sql")).unwrap();
    assert_eq!(page(&mut conn, "a", None, false).0[0].revision.len(), 32);
    let mut conn = database();
    apply(&mut conn, vec![change("a", "x", None, "put")]);
    let dir = tempfile::tempdir().unwrap();
    wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    let count: i64 = conn.query_row("SELECT count(*) FROM plugin_document_generations", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
    apply(&mut conn, vec![change("a", "x", None, "put")]);
}

fn search_page(conn: &mut Connection, query: &str, cursor: Option<String>) -> Result<PluginDocumentPageResult, CommandError> {
    plugin_docs_page_inner(conn, "sample", "search", PluginDocumentPageQuery {
        query: Some(query.into()), limit: Some(2), oldest_first: Some(true), cursor, ..Default::default()
    })
}

#[test]
fn plugin_documents_search_precedes_paging_and_binds_the_cursor() {
    let mut conn = database();
    for index in 0..108 {
        let mut entry = change("search", &format!("item-{index:03}"), None, "put");
        entry.operation = PluginDocumentOperation::Put {
            json: serde_json::json!({"nested": [{"title": if index >= 101 { "ÉCOLE 中文" } else { "unrelated" }}]}).to_string(),
            book_id: Some("book".into()), anchor: None,
        };
        apply(&mut conn, vec![entry]);
    }
    let mut cursor = None;
    let mut ids = Vec::new();
    let mut sizes = Vec::new();
    loop {
        let PluginDocumentPageResult::Ready { items, next_cursor } = search_page(&mut conn, " école 中文 ", cursor).unwrap() else { panic!("ready"); };
        sizes.push(items.len()); ids.extend(items.iter().map(|item| item.id.clone()));
        if next_cursor.is_none() { break; }
        assert_eq!(search_page(&mut conn, "unrelated", next_cursor.clone()).unwrap_err().code, "plugin/invalid-argument");
        cursor = next_cursor;
    }
    assert_eq!(sizes, [2, 2, 2, 1]);
    assert_eq!(ids, (101..108).map(|i| format!("item-{i:03}")).collect::<Vec<_>>());
    let PluginDocumentPageResult::Ready { next_cursor, .. } = search_page(&mut conn, "école 中文", None).unwrap() else { panic!("ready"); };
    apply(&mut conn, vec![change("search", "new", None, "put")]);
    assert!(matches!(search_page(&mut conn, "ÉCOLE 中文", next_cursor).unwrap(), PluginDocumentPageResult::StaleCursor));
    let other = plugin_docs_page_inner(&mut conn, "other", "search", PluginDocumentPageQuery { query: Some("école 中文".into()), ..Default::default() }).unwrap();
    assert!(matches!(other, PluginDocumentPageResult::Ready { items, .. } if items.is_empty()));
    let book = plugin_docs_page_inner(&mut conn, "sample", "search", PluginDocumentPageQuery { query: Some("école 中文".into()), book_id: Some("another".into()), ..Default::default() }).unwrap();
    assert!(matches!(book, PluginDocumentPageResult::Ready { items, .. } if items.is_empty()));
}

#[test]
fn plugin_documents_searches_decoded_keys_and_scalar_values_without_sql_wildcards() {
    let mut conn = database();
    let mut entry = change("search", "one", None, "put");
    entry.operation = PluginDocumentOperation::Put {
        json: r#"{"École":{"nested":["\u4e2d\u6587",42,true,null,"100%_literal","quote\"slash\\"]}}"#.into(),
        book_id: None, anchor: None,
    };
    apply(&mut conn, vec![entry]);
    for query in ["éCOLE", "中文", "42", "true", "null", "%_", "quote\"slash\\", "  "] {
        assert!(matches!(search_page(&mut conn, query, None).unwrap(), PluginDocumentPageResult::Ready { items, .. } if items.len() == 1), "{query}");
    }
    for query in ["missing", "ecole", "中文 42", "' OR 1=1 --", "one"] {
        assert!(matches!(search_page(&mut conn, query, None).unwrap(), PluginDocumentPageResult::Ready { items, .. } if items.is_empty()), "{query}");
    }
    for query in ["x".repeat(1025), "中".repeat(342), "bad\nquery".into()] {
        assert_eq!(search_page(&mut conn, &query, None).unwrap_err().code, "plugin/invalid-argument");
    }
    conn.execute("UPDATE plugin_documents SET json='broken' WHERE collection='search'", []).unwrap();
    assert_eq!(search_page(&mut conn, "missing", None).unwrap_err().code, "db/error");
}
