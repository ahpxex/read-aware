use super::*;

#[test]
fn atomic_domains_roll_back_together_and_reject_changed_preview() {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let revision = atomic_aggregate_revision(&conn, "book", "book").unwrap();
    let input = |expected: Option<&str>| {
        serde_json::from_value::<AtomicCommitInput>(serde_json::json!({
        "journal": {"id":"receipt", "owner":"agent:book", "metadata":{"undo":"host-plan"}},
        "guards": [{"aggregateType":"book","aggregateId":"book","revision":revision}],
        "events": [{"id":"atomic-event","type":"book.imported","hlc":{"wallMs":1000,"counter":0,"deviceId":"test"},
            "aggregateType":"book","aggregateId":"book","payload":{"bookId":"book","title":"Atomic book","author":"A","format":"epub","fileName":"book.epub","fileSize":42,"sourceBlobKey":"bookfile:book"}}],
        "settings": [{"key":"read-aware-theme","expected":null,"value":"\"paper\""}],
        "documents": [{"pluginId":"sample","changes":[{"collection":"notes","id":"one","expectedRevision":expected,
            "kind":"put","json":"{}","bookId":"book"}]}]
    })).unwrap()
    };
    // The document conflict occurs after event/projection and setting writes.
    assert!(matches!(
        atomic_commit_inner(&mut conn, input(Some("00000000000000000000000000000000"))).unwrap(),
        AtomicCommitResult::Conflict { .. }
    ));
    for table in ["domain_events", "books", "plugin_documents"] {
        assert_eq!(
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert!(conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-theme'",
            [],
            |row| row.get::<_, String>(0)
        )
        .optional()
        .unwrap()
        .is_none());
    assert!(matches!(
        atomic_commit_inner(&mut conn, input(None)).unwrap(),
        AtomicCommitResult::Applied { .. }
    ));
    assert_ne!(
        atomic_aggregate_revision(&conn, "book", "book").unwrap(),
        revision
    );
    // Exact retry returns the durable receipt without appending another event.
    assert!(matches!(
        atomic_commit_inner(&mut conn, input(None)).unwrap(),
        AtomicCommitResult::Applied { .. }
    ));
    let mut next = input(None);
    next.journal.as_mut().unwrap().id = "next".into();
    assert!(matches!(
        atomic_commit_inner(&mut conn, next).unwrap(),
        AtomicCommitResult::Conflict { .. }
    ));
    assert_eq!(
        conn.query_row("SELECT count(*) FROM atomic_receipts", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT title FROM books WHERE id='book'", [], |row| row
            .get::<_, String>(
            0
        ))
        .unwrap(),
        "Atomic book"
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM plugin_documents", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    let mut guarded = input(None);
    guarded.events.clear();
    guarded.guards.clear();
    guarded.documents.clear();
    guarded.journal.as_mut().unwrap().id = "guarded".into();
    guarded.settings[0].expected = Some("\"paper\"".into());
    guarded.settings[0].value = Some("\"night\"".into());
    guarded.setting_guards.push(AtomicSettingChange {
        key: "reader-baseline".into(),
        expected: Some("old".into()),
        value: None,
    });
    assert!(
        matches!(atomic_commit_inner(&mut conn, guarded).unwrap(), AtomicCommitResult::Conflict { domain, .. } if domain == "settings")
    );
    assert_eq!(
        conn.query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-theme'",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "\"paper\""
    );
}

#[test]
fn atomic_roaming_settings_commit_their_preference_event_without_a_separate_guard() {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let key = "read-aware-app-settings";
    let input = |id: &str, event_key: &str, expected: Option<&str>| {
        serde_json::from_value::<AtomicCommitInput>(serde_json::json!({
        "journal": null, "guards": [],
        "events": [{"id":id,"type":"preference.changed","hlc":{"wallMs":1000,"counter":0,"deviceId":"test"},
            "aggregateType":"preference","aggregateId":event_key,"payload":{"key":event_key,"value":{"theme":"dark"}}}],
        "settings": [{"key":key,"expected":expected,"value":"{\"theme\":\"dark\"}"}],
        "documents": []
    })).unwrap()
    };
    let logged = |conn: &Connection| {
        conn.query_row("SELECT count(*) FROM domain_events", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap()
    };
    // An unguarded event for a key this transaction does not write is still refused.
    assert!(atomic_commit_inner(&mut conn, input("other", "read-aware-other", None)).is_err());
    // A KV conflict rolls the preference event back with the setting.
    assert!(matches!(
        atomic_commit_inner(&mut conn, input("stale", key, Some("{}"))).unwrap(),
        AtomicCommitResult::Conflict { .. }
    ));
    assert_eq!(logged(&conn), 0);
    assert!(matches!(
        atomic_commit_inner(&mut conn, input("roamed", key, None)).unwrap(),
        AtomicCommitResult::Applied { .. }
    ));
    assert_eq!(logged(&conn), 1);
    assert!(conn
        .query_row(
            "SELECT value_json FROM synced_preferences WHERE key=?1",
            [key],
            |row| row.get::<_, String>(0)
        )
        .unwrap()
        .contains("dark"));
}
