use super::super::{
    apply_connection_pragmas, commit_events_inner, register_sql_functions, run_migrations, Hlc,
};
use super::*;
use serde_json::json;

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    prepare(&mut conn);
    conn
}
fn prepare(conn: &mut Connection) {
    apply_connection_pragmas(conn).unwrap();
    register_sql_functions(conn).unwrap();
    run_migrations(conn).unwrap();
}
fn event(id: &str, kind: &str, annotation: &str, body: &str, counter: i64) -> EventRow {
    let (aggregate, key) = if kind.starts_with("note.") {
        ("note", "noteId")
    } else if kind.starts_with("ask.") {
        ("ask", "askId")
    } else {
        ("highlight", "highlightId")
    };
    let payload = if kind.ends_with(".created") || kind == "ask.recorded" {
        json!({key:annotation, "bookId":"book", "body":body, "text":body})
    } else if kind == "note.updated" {
        json!({key:annotation,"body":body})
    } else if kind == "highlight.recolored" {
        json!({key:annotation,"color":body,"style":"underline"})
    } else {
        json!({key:annotation})
    };
    EventRow {
        id: id.into(),
        event_type: kind.into(),
        hlc: Hlc {
            wall_ms: 1_780_000_000_000,
            counter,
            device_id: "test".into(),
        },
        schema_version: None,
        aggregate_type: Some(aggregate.into()),
        aggregate_id: Some(annotation.into()),
        actor_id: None,
        origin: Some("plugin:batch-test".into()),
        created_at: None,
        payload,
    }
}
fn condition(conn: &mut Connection, id: &str) -> AnnotationCondition {
    AnnotationCondition {
        annotation_id: id.into(),
        expected_revision: annotation_inspect_inner(conn, id)
            .unwrap()
            .unwrap()
            .revision,
    }
}
fn body(conn: &mut Connection, id: &str) -> String {
    annotation_inspect_inner(conn, id)
        .unwrap()
        .unwrap()
        .annotation
        .content
        .unwrap()
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn native_observed_rows_share_inspect_tokens_and_detect_equal_millisecond_aba() {
    let mut conn = db();
    commit_events_inner(&mut conn, &[event("n", "note.created", "n", "original", 1)]).unwrap();
    let rows = super::super::annotations::annotations_observe_inner(&mut conn, Some("book")).unwrap();
    assert_eq!(rows.len(), 1);
    let observed = &rows[0];
    assert_eq!(observed.revision, condition(&mut conn, "n").expected_revision);
    let json = serde_json::to_value(observed).unwrap();
    assert_eq!(json["id"], "n");
    assert_eq!(json["type"], "note");
    assert_eq!(json["bookId"], "book");
    assert!(json.get("annotation").is_none());
    assert!(json["revision"].as_str().unwrap().starts_with("ann1:"));
    commit_events_inner(&mut conn, &[
        event("away", "note.updated", "n", "changed", 2),
        event("back", "note.updated", "n", "original", 3),
    ]).unwrap();
    let next = super::super::annotations::annotations_observe_inner(&mut conn, Some("book")).unwrap();
    assert_eq!(observed.annotation.content, next[0].annotation.content);
    assert_ne!(observed.revision, next[0].revision);
    let result = annotations_commit_inner(&mut conn, &[event("stale", "note.updated", "n", "lost update", 4)],
        &[AnnotationCondition { annotation_id: "n".into(), expected_revision: observed.revision.clone() }]);
    assert_eq!(result.unwrap_err().code, "annotations/conflict");
    assert_eq!(count(&conn, "domain_events"), 3);
    assert_eq!(body(&mut conn, "n"), "original");
}

#[test]
fn annotation_cas_atomic_batch_updates_recolors_deletes_and_preserves_event_origin() {
    let mut conn = db();
    commit_events_inner(
        &mut conn,
        &[
            event("n", "note.created", "n", "old", 1),
            event("h", "highlight.created", "h", "quote", 2),
            event("a", "ask.recorded", "a", "question", 3),
        ],
    )
    .unwrap();
    let conditions = [
        condition(&mut conn, "n"),
        condition(&mut conn, "h"),
        condition(&mut conn, "a"),
    ];
    let changes = [
        event("n2", "note.updated", "n", "new", 4),
        event("h2", "highlight.recolored", "h", "blue", 5),
        event("a2", "ask.removed", "a", "", 6),
    ];
    let result = annotations_commit_inner(&mut conn, &changes, &conditions).unwrap();
    assert!(result.atomic);
    assert_eq!(result.changes.len(), 3);
    assert_ne!(
        result.changes[0].revision.as_deref(),
        Some(conditions[0].expected_revision.as_str())
    );
    assert_eq!(body(&mut conn, "n"), "new");
    let h = annotation_inspect_inner(&mut conn, "h")
        .unwrap()
        .unwrap()
        .annotation;
    assert_eq!(h.color.as_deref(), Some("blue"));
    assert_eq!(h.style.as_deref(), Some("underline"));
    assert!(annotation_inspect_inner(&mut conn, "a").unwrap().is_none());
    assert!(result.changes[2].revision.is_none());
    assert_eq!(count(&conn, "domain_events"), 6);
    let origin: String = conn
        .query_row("SELECT origin FROM domain_events WHERE id='n2'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(origin, "plugin:batch-test");
}

#[test]
fn annotation_cas_stale_condition_rolls_back_every_item_and_outbox() {
    let mut conn = db();
    commit_events_inner(
        &mut conn,
        &[
            event("a", "note.created", "a", "A", 1),
            event("b", "note.created", "b", "B", 2),
        ],
    )
    .unwrap();
    let conditions = [condition(&mut conn, "a"), condition(&mut conn, "b")];
    commit_events_inner(
        &mut conn,
        &[event("b2", "note.updated", "b", "Other writer", 3)],
    )
    .unwrap();
    let before = count(&conn, "event_sync_state");
    let result = annotations_commit_inner(
        &mut conn,
        &[
            event("a3", "note.updated", "a", "Lost A", 4),
            event("b3", "note.updated", "b", "Lost B", 5),
        ],
        &conditions,
    );
    assert_eq!(result.unwrap_err().code, "annotations/conflict");
    assert_eq!(body(&mut conn, "a"), "A");
    assert_eq!(body(&mut conn, "b"), "Other writer");
    assert_eq!(count(&conn, "domain_events"), 3);
    assert_eq!(count(&conn, "event_sync_state"), before);
}

#[test]
fn annotation_cas_equal_millisecond_aba_and_delete_recreate_invalidate_token() {
    let mut conn = db();
    commit_events_inner(&mut conn, &[event("n", "note.created", "n", "A", 1)]).unwrap();
    let original = condition(&mut conn, "n");
    let at = annotation_inspect_inner(&mut conn, "n")
        .unwrap()
        .unwrap()
        .annotation
        .updated_at;
    commit_events_inner(
        &mut conn,
        &[
            event("b", "note.updated", "n", "B", 2),
            event("a", "note.updated", "n", "A", 3),
        ],
    )
    .unwrap();
    assert_eq!(
        annotation_inspect_inner(&mut conn, "n")
            .unwrap()
            .unwrap()
            .annotation
            .updated_at,
        at
    );
    assert_ne!(
        condition(&mut conn, "n").expected_revision,
        original.expected_revision
    );
    commit_events_inner(
        &mut conn,
        &[
            event("d", "note.removed", "n", "", 4),
            event("r", "note.created", "n", "A", 5),
        ],
    )
    .unwrap();
    assert_eq!(
        annotations_commit_inner(
            &mut conn,
            &[event("z", "note.updated", "n", "overwrite", 6)],
            &[original]
        )
        .unwrap_err()
        .code,
        "annotations/conflict"
    );
}

#[test]
fn annotation_cas_apply_failure_rolls_back_prior_events_and_projections() {
    let mut conn = db();
    commit_events_inner(
        &mut conn,
        &[
            event("a", "note.created", "a", "A", 1),
            event("b", "note.created", "b", "B", 2),
        ],
    )
    .unwrap();
    let conditions = [condition(&mut conn, "a"), condition(&mut conn, "b")];
    conn.execute_batch("CREATE TRIGGER fail_second BEFORE UPDATE ON annotations WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'test write failure'); END;").unwrap();
    assert!(annotations_commit_inner(
        &mut conn,
        &[
            event("a2", "note.updated", "a", "New A", 3),
            event("b2", "note.updated", "b", "New B", 4)
        ],
        &conditions
    )
    .is_err());
    assert_eq!(body(&mut conn, "a"), "A");
    assert_eq!(body(&mut conn, "b"), "B");
    assert_eq!(count(&conn, "domain_events"), 2);
}

#[test]
fn annotation_cas_rejects_missing_wrong_kind_duplicate_ids_and_unrelated_events() {
    let mut conn = db();
    commit_events_inner(&mut conn, &[event("n", "note.created", "n", "A", 1)]).unwrap();
    let cond = condition(&mut conn, "n");
    let wrong = event("w", "highlight.removed", "n", "", 2);
    assert_eq!(
        annotations_commit_inner(&mut conn, &[wrong], &[cond])
            .unwrap_err()
            .code,
        "annotations/not-found"
    );
    let conditions = [condition(&mut conn, "n"), condition(&mut conn, "n")];
    assert_eq!(
        annotations_commit_inner(
            &mut conn,
            &[
                event("u", "note.updated", "n", "B", 3),
                event("v", "note.updated", "n", "C", 4)
            ],
            &conditions
        )
        .unwrap_err()
        .code,
        "annotations/invalid-input"
    );
    let cond = condition(&mut conn, "n");
    let mut unrelated = event("bad", "note.updated", "n", "X", 5);
    unrelated.event_type = "book.removed".into();
    assert_eq!(
        annotations_commit_inner(&mut conn, &[unrelated], &[cond])
            .unwrap_err()
            .code,
        "annotations/invalid-input"
    );
    let cond = condition(&mut conn, "n");
    commit_events_inner(&mut conn, &[event("d", "note.removed", "n", "", 6)]).unwrap();
    assert_eq!(
        annotations_commit_inner(
            &mut conn,
            &[event("u2", "note.updated", "n", "B", 7)],
            &[cond]
        )
        .unwrap_err()
        .code,
        "annotations/not-found"
    );
}

#[test]
fn annotation_cas_two_connections_race_only_one_version_wins() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("race.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    prepare(&mut conn);
    commit_events_inner(&mut conn, &[event("n", "note.created", "n", "A", 1)]).unwrap();
    let token = condition(&mut conn, "n").expected_revision;
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|n| {
            let path = path.clone();
            let token = token.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut conn = Connection::open(path).unwrap();
                apply_connection_pragmas(&conn).unwrap();
                register_sql_functions(&conn).unwrap();
                barrier.wait();
                annotations_commit_inner(
                    &mut conn,
                    &[event(
                        &format!("write-{n}"),
                        "note.updated",
                        "n",
                        &format!("winner-{n}"),
                        n + 2,
                    )],
                    &[AnnotationCondition {
                        annotation_id: "n".into(),
                        expected_revision: token,
                    }],
                )
            })
        })
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap()
            .code,
        "annotations/conflict"
    );
    assert_eq!(count(&conn, "domain_events"), 2);
}
