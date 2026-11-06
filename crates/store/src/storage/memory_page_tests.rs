use super::*;
use serde_json::json;

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    super::super::apply_connection_pragmas(&conn).unwrap();
    super::super::register_sql_functions(&conn).unwrap();
    super::super::run_migrations(&mut conn).unwrap();
    let tx = conn.transaction().unwrap();
    for i in 0..1005 {
        tx.execute("INSERT INTO memories (id,scope,kind,content,importance,evidence_count,pinned,status,created_at,updated_at)
            VALUES (?1,'user','fact',?2,0.5,1,0,'active','2026-09-12','2026-09-12')",
            params![format!("m{i:04}"), format!("Reading evidence {i}")]).unwrap();
    }
    tx.commit().unwrap();
    conn
}

#[test]
fn native_pages_traverse_all_matches_without_duplicates_and_share_order() {
    let mut conn = db();
    conn.execute("UPDATE memories SET pinned=1 WHERE id='m1004'", [])
        .unwrap();
    let mut query = json!({"scopes":["user"], "limit":100});
    let mut ids = Vec::new();
    loop {
        let page = memory_page_inner(&mut conn, &query).unwrap();
        assert_eq!(page.total, 1005);
        assert!(page.items.len() <= 100);
        ids.extend(page.items.into_iter().map(|m| m.id));
        let Some(offset) = page.next_offset else {
            break;
        };
        query["offset"] = json!(offset);
        query["expectedRevision"] = json!(page.revision);
    }
    assert_eq!(ids.len(), 1005);
    assert_eq!(ids[0], "m1004");
    assert_eq!(ids[1], "m0000");
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 1005);
}

#[test]
fn changes_outside_the_page_invalidate_but_unrelated_scopes_do_not() {
    let mut conn = db();
    let first = memory_page_inner(&mut conn, &json!({"scopes":["user"],"limit":20})).unwrap();
    let next =
        json!({"scopes":["user","user"],"limit":20,"offset":20,"expectedRevision":first.revision});
    conn.execute("INSERT INTO memories (id,scope,kind,content,importance,evidence_count,pinned,status,created_at,updated_at) SELECT 'unrelated','global',kind,content,importance,evidence_count,pinned,status,created_at,updated_at FROM memories WHERE id='m0000'", []).unwrap();
    assert!(memory_page_inner(&mut conn, &next).is_ok());
    // A raw external/projection write need not advance an event clock or updated_at.
    conn.execute("UPDATE memories SET content='Changed' WHERE id='m1004'", [])
        .unwrap();
    assert_eq!(
        memory_page_inner(&mut conn, &next).unwrap_err().code,
        "memory/conflict"
    );
    let fresh = memory_page_inner(&mut conn, &json!({"scopes":["user"]})).unwrap();
    conn.execute(
        "UPDATE memories SET status='forgotten' WHERE id='m1004'",
        [],
    )
    .unwrap();
    assert_eq!(
        memory_page_inner(
            &mut conn,
            &json!({"scopes":["user"],"offset":20,"expectedRevision":fresh.revision})
        )
        .unwrap_err()
        .code,
        "memory/conflict"
    );
}

#[test]
fn search_preserves_case_cjk_whole_phrase_and_discriminative_token_matching() {
    let mut conn = db();
    conn.execute(
        "UPDATE memories SET content='ÉCOLE 窗户 東京 preference' WHERE id='m0000'",
        [],
    )
    .unwrap();
    for query in [
        "école",
        "窗户",
        "東京",
        "zz preference",
        "missing—窗户",
        "\u{feff}ÉCOLE\u{feff}",
    ] {
        let page = memory_page_inner(&mut conn, &json!({"scopes":["user"],"query":query})).unwrap();
        assert_eq!(page.total, 1, "{query}");
        assert_eq!(page.items[0].id, "m0000");
    }
    assert_eq!(
        memory_page_inner(&mut conn, &json!({"scopes":["user"],"query":"xx zz"}))
            .unwrap()
            .total,
        0
    );
    conn.execute(
        "UPDATE memories SET status='superseded' WHERE id='m0000'",
        [],
    )
    .unwrap();
    assert_eq!(
        memory_page_inner(&mut conn, &json!({"scopes":["user"],"query":"窗户"}))
            .unwrap()
            .total,
        0
    );
}

#[test]
fn invalid_requests_old_revisions_and_database_failures_are_not_empty_pages() {
    let mut conn = db();
    for query in [
        json!({"scopes":[]}),
        json!({"scopes":["book: "]}),
        json!({"scopes":["user"],"limit":101}),
        json!({"scopes":["user"],"offset":1}),
        json!({"scopes":["user"],"offset":-1}),
        json!({"scopes":["user"],"query":null}),
        json!({"scopes":["user"],"extra":true}),
    ] {
        assert_eq!(
            memory_page_inner(&mut conn, &query).unwrap_err().code,
            "memory/invalid-query"
        );
    }
    assert_eq!(memory_page_inner(&mut conn, &json!({"scopes":["user"],"offset":20,"expectedRevision":format!("mpg1:{}", "a".repeat(64))})).unwrap_err().code, "memory/conflict");
    let first = memory_page_inner(&mut conn, &json!({"scopes":["user"]})).unwrap();
    assert!(memory_page_inner(
        &mut conn,
        &json!({"scopes":["user"],"offset":1005,"expectedRevision":first.revision})
    )
    .unwrap()
    .items
    .is_empty());
    assert_eq!(
        memory_page_inner(
            &mut conn,
            &json!({"scopes":["user"],"offset":1006,"expectedRevision":first.revision})
        )
        .unwrap_err()
        .code,
        "memory/invalid-query"
    );
    conn.execute("DROP TABLE memories", []).unwrap();
    assert_eq!(
        memory_page_inner(&mut conn, &json!({"scopes":["user"]}))
            .unwrap_err()
            .code,
        "db/error"
    );
}

#[test]
fn byte_shortened_pages_keep_contiguous_offsets_and_full_result_revision() {
    let mut conn = db();
    conn.execute("DELETE FROM memories WHERE id >= 'm0020'", [])
        .unwrap();
    // UTF-8 byte accounting, not character counting; each item is about 90 KiB.
    conn.execute("UPDATE memories SET content=?1", ["字".repeat(30000)])
        .unwrap();
    let first = memory_page_inner(&mut conn, &json!({"scopes":["user"],"limit":100})).unwrap();
    assert_eq!(first.total, 20);
    assert!(!first.items.is_empty() && first.items.len() < 20);
    let offset = first.next_offset.unwrap();
    assert_eq!(offset, first.items.len());
    let second = memory_page_inner(
        &mut conn,
        &json!({"scopes":["user"],"limit":100,"offset":offset,"expectedRevision":first.revision}),
    )
    .unwrap();
    assert_eq!(second.revision, first.revision);
    assert_eq!(second.items[0].id, format!("m{offset:04}"));
    assert_eq!(offset + second.items.len(), 20);
    assert_eq!(second.next_offset, None);
    conn.execute(
        "UPDATE memories SET content=?1 WHERE id='m0019'",
        ["x".repeat(128 * 1024 + 1)],
    )
    .unwrap();
    assert_eq!(
        memory_page_inner(&mut conn, &json!({"scopes":["user"]}))
            .unwrap_err()
            .code,
        "memory/input-budget-exceeded"
    );
}
