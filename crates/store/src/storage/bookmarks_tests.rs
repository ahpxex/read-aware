use super::super::{
    apply_connection_pragmas, commit_events_inner, events::verify_inner, register_sql_functions,
    run_migrations, Db, EventRow, Hlc,
};
use super::*;
use serde_json::json;

fn conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}

fn event(id: &str, counter: i64, kind: &str, payload: Value) -> EventRow {
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
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

fn import(id: &str, book: &str, counter: i64) -> EventRow {
    event(
        id,
        counter,
        "book.imported",
        json!({ "bookId": book, "title": book, "format": "epub", "fileName": "b.epub" }),
    )
}

fn created(id: &str, counter: i64, bookmark: &str, book: &str, target: Value) -> EventRow {
    event(
        id,
        counter,
        "bookmark.created",
        json!({ "bookmarkId": bookmark, "bookId": book, "name": "Mark", "kind": "location", "target": target }),
    )
}

#[test]
fn bookmarks_project_create_rename_remove_in_order() {
    let mut conn = conn();
    commit_events_inner(
        &mut conn,
        &[
            import("i1", "b1", 0),
            created(
                "c1",
                1,
                "m1",
                "b1",
                json!({ "contentVersion": "v1", "cfi": "epubcfi(/6/4!/4/2:0)" }),
            ),
            created(
                "c2",
                2,
                "m2",
                "b1",
                json!({ "contentVersion": "v1", "fraction": 0.5 }),
            ),
            event(
                "r1",
                3,
                "bookmark.renamed",
                json!({ "bookmarkId": "m1", "bookId": "b1", "name": "Chapter one" }),
            ),
            event(
                "d1",
                4,
                "bookmark.removed",
                json!({ "bookmarkId": "m2", "bookId": "b1" }),
            ),
        ],
    )
    .unwrap();
    let rows = bookmarks_list_inner(&conn, Some("b1")).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Chapter one");
    assert_eq!(
        rows[0].target,
        json!({ "contentVersion": "v1", "cfi": "epubcfi(/6/4!/4/2:0)" })
    );
    assert!(bookmarks_list_inner(&conn, Some("other"))
        .unwrap()
        .is_empty());
    // A replay rebuilds exactly what the live commits projected.
    let db = Db::new(conn);
    let report = verify_inner(&db).unwrap();
    assert!(report.consistent, "{:?}", report.drift);
}

#[test]
fn bookmarks_follow_their_book_through_merge_and_removal() {
    let mut conn = conn();
    commit_events_inner(
        &mut conn,
        &[
            import("i1", "keep", 0),
            import("i2", "dup", 1),
            created(
                "c1",
                2,
                "m1",
                "dup",
                json!({ "contentVersion": "v1", "href": "ch1.xhtml" }),
            ),
            event(
                "g1",
                3,
                "book.merged",
                json!({ "keepId": "keep", "mergedId": "dup" }),
            ),
            // A device that has not seen the merge still addresses the old id.
            created(
                "c2",
                4,
                "m2",
                "dup",
                json!({ "contentVersion": "v1", "href": "ch2.xhtml" }),
            ),
        ],
    )
    .unwrap();
    let ids: Vec<_> = bookmarks_list_inner(&conn, Some("keep"))
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert_eq!(ids, ["m1", "m2"]);
    commit_events_inner(
        &mut conn,
        &[event("x1", 5, "book.removed", json!({ "bookId": "keep" }))],
    )
    .unwrap();
    assert!(bookmarks_list_inner(&conn, None).unwrap().is_empty());
}

#[test]
fn malformed_bookmarks_never_commit() {
    let mut conn = conn();
    commit_events_inner(&mut conn, &[import("i1", "b1", 0)]).unwrap();
    let cases = [
        // Two locators at once.
        json!({ "contentVersion": "v1", "cfi": "epubcfi(/6/2)", "href": "a.xhtml" }),
        // No locator.
        json!({ "contentVersion": "v1" }),
        // Out-of-range fraction.
        json!({ "contentVersion": "v1", "fraction": 1.5 }),
        // Missing content version.
        json!({ "href": "a.xhtml" }),
        // Unknown key (a book id belongs to the bookmark, not its target).
        json!({ "contentVersion": "v1", "href": "a.xhtml", "bookId": "b1" }),
        // Quote without text.
        json!({ "contentVersion": "v1", "href": "a.xhtml", "textQuote": { "exact": " " } }),
    ];
    for (index, target) in cases.into_iter().enumerate() {
        let error = commit_events_inner(
            &mut conn,
            &[created(&format!("bad{index}"), 1, "m", "b1", target)],
        )
        .unwrap_err();
        assert_eq!(error.code, "bookmarks/invalid-input", "case {index}");
    }
    let selection_without_cfi = event(
        "s1",
        2,
        "bookmark.created",
        json!({ "bookmarkId": "m", "bookId": "b1", "name": "x", "kind": "selection",
                "target": { "contentVersion": "v1", "href": "a.xhtml" } }),
    );
    assert!(commit_events_inner(&mut conn, &[selection_without_cfi]).is_err());
    let blank_name = event(
        "n1",
        3,
        "bookmark.created",
        json!({ "bookmarkId": "m", "bookId": "b1", "name": "  ", "kind": "location",
                "target": { "contentVersion": "v1", "href": "a.xhtml" } }),
    );
    assert!(commit_events_inner(&mut conn, &[blank_name]).is_err());
    assert!(bookmarks_list_inner(&conn, None).unwrap().is_empty());
}

#[test]
fn target_keeps_only_canonical_fields() {
    let payload = json!({ "target": {
        "contentVersion": "v1", "cfi": "epubcfi(/6/2!/4/1:3)",
        "textQuote": { "exact": "word", "prefix": "a ", "suffix": "" }
    }});
    let stored: Value = serde_json::from_str(&target_json(&payload, "selection").unwrap()).unwrap();
    assert_eq!(
        stored,
        json!({ "contentVersion": "v1", "cfi": "epubcfi(/6/2!/4/1:3)",
                "textQuote": { "exact": "word", "prefix": "a ", "suffix": "" } })
    );
}

#[test]
fn adopting_plugin_documents_moves_them_in_one_transaction() {
    let mut conn = conn();
    commit_events_inner(&mut conn, &[import("i1", "b1", 0), import("i2", "dup", 1)]).unwrap();
    commit_events_inner(
        &mut conn,
        &[event(
            "g1",
            2,
            "book.merged",
            json!({ "keepId": "b1", "mergedId": "dup" }),
        )],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO plugin_documents (plugin_id, collection, id, json, book_id, updated_at)
         VALUES ('jumper', 'bookmarks', 'd1', '{}', 'b1', '2026-01-01T00:00:00Z'),
                ('jumper', 'bookmarks', 'd2', '{}', 'dup', '2026-01-01T00:00:00Z'),
                ('jumper', 'bookmarks', 'd3', '{}', 'gone', '2026-01-01T00:00:00Z'),
                ('jumper', 'other', 'd1', '{}', 'b1', '2026-01-01T00:00:00Z');",
    )
    .unwrap();
    let docs = |conn: &Connection| -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT collection || '/' || id FROM plugin_documents WHERE plugin_id = 'jumper' ORDER BY 1")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let adopt = |document: &str, event: EventRow| BookmarkAdoption {
        document_id: document.into(),
        event,
    };
    let href = |href: &str| json!({ "contentVersion": "v1", "href": href });

    // A bad bookmark aborts the whole move: nothing committed, nothing deleted.
    let bad = created(
        "a0",
        3,
        "jumper-d1",
        "b1",
        json!({ "contentVersion": "v1" }),
    );
    assert!(
        adopt_plugin_documents_inner(&mut conn, "jumper", "bookmarks", &[adopt("d1", bad)])
            .is_err()
    );
    assert_eq!(docs(&conn).len(), 4);
    assert!(bookmarks_list_inner(&conn, None).unwrap().is_empty());
    // Only bookmark creations may ride along.
    let other = event(
        "a1",
        4,
        "bookmark.removed",
        json!({ "bookmarkId": "x", "bookId": "b1" }),
    );
    assert!(
        adopt_plugin_documents_inner(&mut conn, "jumper", "bookmarks", &[adopt("d1", other)])
            .is_err()
    );

    let adopted = adopt_plugin_documents_inner(
        &mut conn,
        "jumper",
        "bookmarks",
        &[
            adopt("d1", created("a2", 5, "jumper-d1", "b1", href("a.xhtml"))),
            // Addressed to a merged-away book: follows the alias.
            adopt("d2", created("a3", 6, "jumper-d2", "dup", href("b.xhtml"))),
            // Its book is gone: neither adopted nor deleted.
            adopt("d3", created("a4", 7, "jumper-d3", "gone", href("c.xhtml"))),
        ],
    )
    .unwrap();
    assert_eq!(adopted, 2);
    let rows = bookmarks_list_inner(&conn, Some("b1")).unwrap();
    assert_eq!(
        rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["jumper-d1", "jumper-d2"]
    );
    assert_eq!(docs(&conn), ["bookmarks/d3", "other/d1"]);
}
