//! `ai_chat_commit`: a conversation save appends its events and writes the
//! presentation-only columns in ONE transaction, and never writes an
//! event-owned column outside `apply_event`.
use super::*;
use chat::{ai_chat_commit_inner, AiMessage, AiMessagePresentation};
use serde_json::json;

const CONVERSATION: &str = "b1";

fn appended(id: &str, wall: i64, message: &str, role: &str, seq: i64, content: &str) -> EventRow {
    ev(
        id,
        wall,
        "aiMessage.appended",
        json!({ "messageId": message, "conversationId": CONVERSATION, "role": role, "seq": seq, "content": content }),
    )
}

fn started(id: &str, wall: i64) -> EventRow {
    ev(
        id,
        wall,
        "aiConversation.started",
        json!({ "conversationId": CONVERSATION, "bookId": CONVERSATION }),
    )
}

fn shown(id: &str, seq: i64, parts: Option<&str>) -> AiMessagePresentation {
    AiMessagePresentation {
        id: id.into(),
        seq,
        parts_json: parts.map(Into::into),
    }
}

fn stub(id: &str, seq: i64, error: &str) -> AiMessage {
    AiMessage {
        id: id.into(),
        conversation_id: CONVERSATION.into(),
        role: "assistant".into(),
        seq,
        content: String::new(),
        created_at: format!("2026-09-27T00:00:0{seq}Z"),
        attachments_json: None,
        parts_json: None,
        error: Some(error.into()),
    }
}

/// (id, role, content, seq, parts_json, error) in display order.
type Row = (String, String, String, i64, Option<String>, Option<String>);
fn rows(conn: &Connection) -> Vec<Row> {
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, seq, parts_json, error FROM ai_messages
             WHERE conversation_id = ?1 ORDER BY seq, created_at, id",
        )
        .unwrap();
    let out = stmt
        .query_map([CONVERSATION], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    out
}

fn event_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM domain_events", [], |row| row.get(0))
        .unwrap()
}

fn assert_replay_matches_live(conn: &mut Connection) {
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
            "table {} drifted",
            spec.table
        );
    }
    tx.rollback().unwrap();
}

/// A first exchange: the user's turn and the assistant's, each with its event.
fn first_exchange(conn: &mut Connection) {
    ai_chat_commit_inner(
        conn,
        CONVERSATION,
        &[
            started("e1", 1_000),
            appended("e2", 1_001, "u1", "user", 0, "question"),
        ],
        &[shown("u1", 0, None)],
        &[],
    )
    .unwrap();
    ai_chat_commit_inner(
        conn,
        CONVERSATION,
        &[appended("e3", 1_002, "a1", "assistant", 1, "answer")],
        &[
            shown("u1", 0, None),
            shown("a1", 1, Some(r#"[{"type":"text","text":"answer"}]"#)),
        ],
        &[],
    )
    .unwrap();
}

#[test]
fn a_save_lands_its_events_and_presentation_together_and_replays_consistently() {
    let mut conn = migrated_conn();
    first_exchange(&mut conn);
    assert_eq!(event_count(&conn), 3);
    assert_eq!(
        rows(&conn),
        vec![
            ("u1".into(), "user".into(), "question".into(), 0, None, None),
            (
                "a1".into(),
                "assistant".into(),
                "answer".into(),
                1,
                Some(r#"[{"type":"text","text":"answer"}]"#.into()),
                None
            ),
        ]
    );
    assert_replay_matches_live(&mut conn);
}

#[test]
fn presentation_writes_never_touch_event_owned_columns_or_resurrect_removed_rows() {
    let mut conn = migrated_conn();
    first_exchange(&mut conn);
    // Rewrite the event-owned columns behind the log's back, so a save that
    // rewrote them from its own payload would be visible.
    let before: (String, String, Option<String>) = conn
        .query_row(
            "SELECT content, created_at, attachments_json FROM ai_messages WHERE id='a1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    // A peer removed the user's turn; this webview has not reloaded yet.
    apply_remote_events_inner(
        &mut conn,
        &[ev_on(
            "device-b",
            "r1",
            2_000,
            "aiMessage.removed",
            json!({ "messageId": "u1", "conversationId": CONVERSATION }),
        )],
    )
    .unwrap();
    // A presentation-only save (no new facts) from the stale view, plus an
    // error stub that collides with an event-backed id.
    ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[],
        &[
            shown("u1", 0, Some("[]")),
            shown("a1", 4, Some(r#"[{"type":"text","text":"re-rendered"}]"#)),
        ],
        &[stub("a1", 5, "collision"), stub("err", 6, "network reset")],
    )
    .unwrap();
    let after: (String, String, Option<String>) = conn
        .query_row(
            "SELECT content, created_at, attachments_json FROM ai_messages WHERE id='a1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(after, before, "event-owned columns are untouched");
    assert_eq!(
        rows(&conn),
        vec![
            (
                "a1".into(),
                "assistant".into(),
                "answer".into(),
                4,
                Some(r#"[{"type":"text","text":"re-rendered"}]"#.into()),
                None
            ),
            (
                "err".into(),
                "assistant".into(),
                String::new(),
                6,
                None,
                Some("network reset".into())
            ),
        ],
        "the removed turn stays removed; the stub never overwrote the event-backed row"
    );
    assert_eq!(
        event_count(&conn),
        4,
        "a presentation-only save appends nothing"
    );
    assert_replay_matches_live(&mut conn);
}

#[test]
fn a_failure_mid_save_leaves_neither_events_nor_presentation_behind() {
    let mut conn = migrated_conn();
    first_exchange(&mut conn);
    ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[],
        &[shown("u1", 0, None), shown("a1", 1, None)],
        &[stub("err", 2, "boom")],
    )
    .unwrap();
    let rows_before = rows(&conn);
    let events_before = event_count(&conn);
    // Fail AFTER the events were appended and applied and the stub sweep ran:
    // the presentation update is the last step before commit.
    conn.execute_batch(
        "CREATE TRIGGER fail_presentation BEFORE UPDATE OF parts_json ON ai_messages
         BEGIN SELECT RAISE(ABORT, 'presentation write failed'); END;",
    )
    .unwrap();
    let result = ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[appended("e4", 1_003, "u2", "user", 2, "follow-up")],
        &[
            shown("u1", 0, None),
            shown("a1", 1, None),
            shown("u2", 2, None),
        ],
        &[],
    );
    let error = result.expect_err("the presentation step must fail");
    assert!(
        error.message.contains("presentation write failed"),
        "failed where intended: {}",
        error.message
    );
    assert_eq!(
        event_count(&conn),
        events_before,
        "the event append rolled back"
    );
    assert_eq!(
        rows(&conn),
        rows_before,
        "no projection change survived, including the stub sweep"
    );
}

#[test]
fn a_malformed_batch_is_rejected_before_anything_is_written() {
    let mut conn = migrated_conn();
    first_exchange(&mut conn);
    let rows_before = rows(&conn);
    let events_before = event_count(&conn);
    let other = ev(
        "x1",
        1_010,
        "aiMessage.appended",
        json!({ "messageId": "m", "conversationId": "other", "role": "user", "seq": 0, "content": "c" }),
    );
    let foreign = ev(
        "x2",
        1_011,
        "book.starred",
        json!({ "bookId": CONVERSATION, "starred": true }),
    );
    let clear = ev(
        "x3",
        1_012,
        "aiConversation.cleared",
        json!({ "conversationId": CONVERSATION }),
    );
    let mut factless = stub("fact", 2, "x");
    factless.error = None;
    let mut elsewhere = stub("elsewhere", 2, "x");
    elsewhere.conversation_id = "other".into();
    for (events, stubs) in [
        (
            vec![appended("x0", 1_009, "u2", "user", 2, "ok"), other],
            vec![],
        ),
        (vec![foreign], vec![]),
        (vec![clear], vec![]),
        (vec![], vec![factless]),
        (vec![], vec![elsewhere]),
    ] {
        assert!(ai_chat_commit_inner(&mut conn, CONVERSATION, &events, &[], &stubs).is_err());
        assert_eq!(event_count(&conn), events_before);
        assert_eq!(rows(&conn), rows_before);
    }
}

#[test]
fn a_stale_save_neither_deletes_merged_peer_messages_nor_keeps_dead_error_stubs() {
    let mut conn = migrated_conn();
    // Local save: one event-backed message plus a device-local error stub.
    ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[
            started("e1", 1_000),
            appended("e2", 1_001, "m-a1", "user", 0, "local"),
        ],
        &[shown("m-a1", 0, None)],
        &[stub("m-err", 1, "boom")],
    )
    .unwrap();
    // A peer message merges in underneath the mounted conversation.
    apply_remote_events_inner(
        &mut conn,
        &[ev_on("device-b", "r1", 2_000, "aiMessage.appended",
            json!({ "messageId": "m-b1", "conversationId": CONVERSATION, "role": "user", "seq": 0, "content": "peer" }))],
    )
    .unwrap();
    // Stale save after a retry replaced the stub: only this webview's view.
    ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[appended("e3", 2_001, "m-a2", "assistant", 1, "retried")],
        &[shown("m-a1", 0, None), shown("m-a2", 1, None)],
        &[],
    )
    .unwrap();
    let mut survivors: Vec<String> = rows(&conn).into_iter().map(|row| row.0).collect();
    survivors.sort();
    assert_eq!(survivors, vec!["m-a1", "m-a2", "m-b1"]);
    assert_replay_matches_live(&mut conn);
}

#[test]
fn a_message_after_a_clear_reactivates_the_conversation_in_the_log_itself() {
    let mut conn = migrated_conn();
    first_exchange(&mut conn);
    commit_events_inner(
        &mut conn,
        &[ev(
            "c1",
            1_010,
            "aiConversation.cleared",
            json!({ "conversationId": CONVERSATION }),
        )],
    )
    .unwrap();
    let cleared: Option<String> = conn
        .query_row(
            "SELECT cleared_at FROM ai_conversations WHERE id=?1",
            [CONVERSATION],
            |r| r.get(0),
        )
        .unwrap();
    assert!(cleared.is_some());
    ai_chat_commit_inner(
        &mut conn,
        CONVERSATION,
        &[appended("e5", 1_020, "u9", "user", 0, "again")],
        &[shown("u9", 0, None)],
        &[],
    )
    .unwrap();
    let cleared: Option<String> = conn
        .query_row(
            "SELECT cleared_at FROM ai_conversations WHERE id=?1",
            [CONVERSATION],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cleared, None);
    assert_replay_matches_live(&mut conn);
}
