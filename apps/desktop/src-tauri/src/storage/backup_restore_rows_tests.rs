use super::*;
use crate::storage::{apply, events};

fn event(
    conn: &Connection,
    id: &str,
    kind: &str,
    aggregate: (&str, &str),
    payload: serde_json::Value,
    stamp: (i64, &str),
) {
    conn.execute(
        "INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,aggregate_type,aggregate_id,payload_json,created_at) VALUES (?1,?2,1000,?3,?4,?5,?6,?7,'then')",
        params![id, kind, stamp.0, stamp.1, aggregate.0, aggregate.1, payload.to_string()],
    )
    .unwrap();
}
fn memory_event(conn: &Connection, id: &str, memory: &str, stamp: (i64, &str)) {
    let payload = serde_json::json!({"memoryId":memory,"scope":"global","kind":"fact","content":memory,"importance":1});
    event(
        conn,
        id,
        "memory.promoted",
        ("memory", memory),
        payload,
        stamp,
    );
}
fn message_event(conn: &Connection, id: &str, message: &str, stamp: (i64, &str)) {
    let payload = serde_json::json!({"conversationId":"chat","messageId":message,"role":"assistant","seq":1,"content":message});
    event(
        conn,
        id,
        "aiMessage.appended",
        ("aiConversation", "chat"),
        payload,
        stamp,
    );
}
fn project(conn: &mut Connection) {
    let tx = conn.transaction().unwrap();
    events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
}
fn ids(conn: &Connection, sql: &str) -> Vec<String> {
    let mut statement = conn.prepare(sql).unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
fn value(conn: &Connection, sql: &str) -> Option<String> {
    conn.query_row(sql, [], |row| row.get(0)).ok()
}
fn shared_history(conn: &Connection) {
    memory_event(conn, "shared-event", "shared", (1, "source"));
}
fn plan_against(
    target: &mut Connection,
    stage: &std::path::Path,
    source: backup_archive::PreflightedBackup,
) -> RowPlan {
    backup_archive::plan_events_fixture(source, target, stage, || Ok(()))
        .unwrap()
        .plan_rows(target, || Ok(()))
        .unwrap()
}

#[test]
fn restore_merges_both_histories_keeps_this_devices_state_and_fills_what_it_lacks() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    shared_history(&target);
    memory_event(&target, "target-event", "target-only", (2, "target"));
    message_event(
        &target,
        "target-message-event",
        "target-message",
        (5, "target"),
    );
    project(&mut target);
    target
        .execute_batch(
            "UPDATE ai_messages SET parts_json='[\"this device\"]' WHERE id='target-message';
             INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error)
                VALUES ('target-stub','chat','assistant',9,'failed here','now','[]','ai/network');",
        )
        .unwrap();
    kv(&target, "read-aware-theme", "\"light\"");
    let source = incoming(|conn, _| {
        shared_history(conn);
        memory_event(conn, "source-event", "source-only", (3, "source"));
        message_event(
            conn,
            "source-message-event",
            "source-message",
            (4, "source"),
        );
        let mut owned = Connection::open(conn.path().unwrap()).unwrap();
        storage::register_sql_functions(&owned).unwrap();
        project(&mut owned);
        conn.execute_batch(
            "UPDATE ai_messages SET parts_json='[\"archive\"]' WHERE id='source-message';
             INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error)
                VALUES ('source-stub','chat','assistant',8,'failed there','old','[]','ai/network');
             INSERT INTO vocabulary_entries(id,term,language,entry_json,added_at) VALUES ('word','restored','en','{}','now');",
        )
        .unwrap();
        kv(conn, "read-aware-theme", "\"dark\"");
        kv(conn, "read-aware-reader-font", "\"serif\"");
        kv(conn, "read-aware-sync-token", "\"source-session\"");
    });
    let plan = plan_against(&mut target, stage.path(), source);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let receipt = plan.restore_rows(&tx, || Ok(())).unwrap();
    tx.commit().unwrap();
    assert_eq!(receipt.rows, 2);

    // The log is the union of both histories, with no restore facts of its own.
    let mut events = ids(&target, "SELECT id FROM domain_events ORDER BY id");
    events.sort();
    assert_eq!(
        events,
        [
            "shared-event",
            "source-event",
            "source-message-event",
            "target-event",
            "target-message-event"
        ]
    );
    assert!(ids(
        &target,
        "SELECT id FROM domain_events WHERE type LIKE 'backup.%'"
    )
    .is_empty());
    // The archive's events this device never sent are queued for upload.
    assert_eq!(
        value(
            &target,
            "SELECT push_state FROM event_sync_state WHERE event_id='source-event'"
        )
        .as_deref(),
        Some("pending")
    );
    assert_eq!(
        ids(&target, "SELECT id FROM memories ORDER BY id"),
        ["shared", "source-only", "target-only"]
    );

    // This device's presentation wins; the archive fills only its own rows;
    // the archive's failed-turn stubs are not carried over.
    assert_eq!(
        value(
            &target,
            "SELECT parts_json FROM ai_messages WHERE id='target-message'"
        )
        .as_deref(),
        Some("[\"this device\"]")
    );
    assert_eq!(
        value(
            &target,
            "SELECT parts_json FROM ai_messages WHERE id='source-message'"
        )
        .as_deref(),
        Some("[\"archive\"]")
    );
    assert!(value(&target, "SELECT id FROM ai_messages WHERE id='target-stub'").is_some());
    assert!(value(&target, "SELECT id FROM ai_messages WHERE id='source-stub'").is_none());

    // Local state: keep what is here, fill what is missing, never device state.
    assert_eq!(
        value(
            &target,
            "SELECT value_json FROM app_kv WHERE key='read-aware-theme'"
        )
        .as_deref(),
        Some("\"light\"")
    );
    assert_eq!(
        value(
            &target,
            "SELECT value_json FROM app_kv WHERE key='read-aware-reader-font'"
        )
        .as_deref(),
        Some("\"serif\"")
    );
    assert!(value(
        &target,
        "SELECT value_json FROM app_kv WHERE key='read-aware-sync-token'"
    )
    .is_none());
    assert_eq!(
        value(
            &target,
            "SELECT term FROM vocabulary_entries WHERE id='word'"
        )
        .as_deref(),
        Some("restored")
    );

    // The projections are exactly a rebuild of the merged log.
    let tx = target.transaction().unwrap();
    let before = apply::DIFF_SPECS
        .iter()
        .map(|spec| events::snapshot_table(&tx, spec).unwrap())
        .collect::<Vec<_>>();
    events::replay_into(&tx).unwrap();
    let after = apply::DIFF_SPECS
        .iter()
        .map(|spec| events::snapshot_table(&tx, spec).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(before, after);
}

#[test]
fn restore_refuses_an_event_identity_both_sides_hold_differently() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    memory_event(&target, "same-id", "here", (1, "target"));
    project(&mut target);
    let source = incoming(|conn, _| {
        memory_event(conn, "same-id", "there", (2, "source"));
    });
    let plan = plan_against(&mut target, stage.path(), source);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let error = plan.restore_rows(&tx, || Ok(())).err().unwrap();
    assert_eq!(error.code, "backup/conflict");
    drop(tx);
    assert_eq!(ids(&target, "SELECT id FROM memories"), ["here"]);
}
