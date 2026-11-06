//! Conversation transcripts: one row per message. The conversation facts
//! (role/content/attachments, which messages exist) are event-owned and only
//! `apply_event` writes them; a save commits its events and the
//! presentation-only state in ONE transaction (`ai_chat_commit`). Clear is an
//! `aiConversation.cleared` event that leaves a tombstone.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;
use crate::error::CommandError;

// --- AI chat transcripts (per-book conversations + the global thread) ---

/// Mirrors `ChatMessage` in apps/web (…/ai/lib/chat-types.ts); attachments and
/// the assistant part timeline ride as opaque JSON strings until the
/// event-sourced normalization lands.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub seq: i64,
    pub content: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub(crate) fn row_to_ai_message(row: &rusqlite::Row) -> rusqlite::Result<AiMessage> {
    Ok(AiMessage {
        id: row.get("id")?,
        conversation_id: row.get("conversation_id")?,
        role: row.get("role")?,
        seq: row.get("seq")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
        attachments_json: row.get("attachments_json")?,
        parts_json: row.get("parts_json")?,
        error: row.get("error")?,
    })
}

#[tauri::command]
pub async fn ai_chat_load(
    conversation_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<AiMessage>, CommandError> {
    crate::storage::blocking("ai_chat_load", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn
            // seq alone is not unique across devices (each device numbers its own
            // transcript); created_at then id break ties deterministically so
            // merged conversations interleave the same way everywhere.
            .prepare(
                "SELECT * FROM ai_messages WHERE conversation_id = ?1
             ORDER BY seq, created_at, id",
            )?;
        let rows = stmt.query_map(params![conversation_id], row_to_ai_message)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn ai_chat_load_all(app: tauri::AppHandle) -> Result<Vec<AiMessage>, CommandError> {
    crate::storage::blocking("ai_chat_load_all", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn
            .prepare("SELECT * FROM ai_messages ORDER BY conversation_id, seq, created_at, id")?;
        let rows = stmt.query_map([], row_to_ai_message)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}

/// LEGACY MIGRATION ONLY — the one-time import of pre-SQLite transcripts from
/// the app_kv JSON blob (`importKvConversationsIntoSqlite` in
/// apps/web/src/platform/desktop-import.ts). It writes projection rows the log
/// never described; genesis reconciliation (`event-genesis.ts`) then appends
/// their creation events. Live saves use `ai_chat_commit`, which never writes
/// an event-owned column itself.
///
/// It upserts only the rows it was handed and deletes nothing it doesn't know
/// (peer rows merged through sync survive), except stale error stubs, which
/// are device-local presentation no event describes.
#[tauri::command]
pub async fn ai_chat_replace(
    conversation_id: String,
    messages: Vec<AiMessage>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("ai_chat_replace", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        ai_chat_replace_inner(&mut conn, &conversation_id, &messages)
    })
    .await
}

pub(crate) fn ai_chat_replace_inner(
    conn: &mut Connection,
    conversation_id: &str,
    messages: &[AiMessage],
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO ai_conversations (id, created_at, updated_at, cleared_at)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL)
         ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at, cleared_at = NULL",
        params![conversation_id],
    )?;
    tx.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1 AND error IS NOT NULL",
        params![conversation_id],
    )?;
    for (seq, message) in messages.iter().enumerate() {
        tx.execute(
            "INSERT INTO ai_messages
                (id, conversation_id, role, seq, content, created_at,
                 attachments_json, parts_json, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(id) DO UPDATE SET
                role=excluded.role, seq=excluded.seq, content=excluded.content,
                created_at=excluded.created_at,
                attachments_json=excluded.attachments_json,
                parts_json=excluded.parts_json, error=excluded.error",
            params![
                message.id,
                conversation_id,
                message.role,
                seq as i64,
                message.content,
                message.created_at,
                message.attachments_json,
                message.parts_json,
                message.error,
            ],
        )?;
    }
    Ok(tx.commit()?)
}

/// Presentation state of one event-backed message in the saved transcript.
/// Only the columns `DIFF_SPECS` marks device-local for `ai_messages`:
/// `parts_json` (the assistant's rendered structure) and `seq` (the saving
/// device's display order).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessagePresentation {
    pub id: String,
    pub seq: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts_json: Option<String>,
}

/// The event types a conversation save may carry. A clear is its own
/// `commit_events` write; everything else belongs to other aggregates.
const SAVE_EVENT_TYPES: &[&str] = &[
    "aiConversation.started",
    "aiMessage.appended",
    "aiMessage.removed",
];

/// Save one conversation: append + apply its events AND write the
/// presentation-only state in ONE transaction, so the projection can never
/// hold presentation that disagrees with the log.
///
/// Column ownership is strict:
/// - Event-owned columns (role, content, created_at, attachments_json, which
///   rows exist, the conversation's cleared_at) are written only by
///   `apply_event`, through `commit_events_in_transaction`.
/// - For event-backed rows this command writes only `parts_json` and `seq`,
///   and only on rows that still exist — a message a peer removed through
///   sync is not resurrected.
/// - Error stubs (`error IS NOT NULL`) are device-local rows no event
///   describes (`DIFF_SPECS` excludes them): stale ones are swept and the
///   current ones re-inserted whole. A stub never overwrites an event-backed
///   row with the same id.
/// - `ai_conversations.updated_at` is bumped (device-local activity order).
#[tauri::command]
pub async fn ai_chat_commit(
    conversation_id: String,
    events: Vec<EventRow>,
    presentation: Vec<AiMessagePresentation>,
    error_stubs: Vec<AiMessage>,
    app: tauri::AppHandle,
) -> Result<CommitReport, CommandError> {
    crate::storage::blocking("ai_chat_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        ai_chat_commit_inner(
            &mut conn,
            &conversation_id,
            &events,
            &presentation,
            &error_stubs,
        )
    })
    .await
}

fn validate_chat_commit(
    conversation_id: &str,
    events: &[EventRow],
    presentation: &[AiMessagePresentation],
    error_stubs: &[AiMessage],
) -> Result<(), CommandError> {
    // The web store composes these batches; a violation is a programming
    // error, never user input, so it is reported as internal.
    let invalid = |what: &str| CommandError::internal(format!("Invalid conversation save: {what}"));
    if conversation_id.trim().is_empty() {
        return Err(invalid("empty conversation id"));
    }
    for event in events {
        if !SAVE_EVENT_TYPES.contains(&event.event_type.as_str()) {
            return Err(invalid("event outside the conversation save vocabulary"));
        }
        if event.payload.get("conversationId").and_then(Value::as_str) != Some(conversation_id) {
            return Err(invalid("event for another conversation"));
        }
    }
    if presentation.iter().any(|row| row.id.is_empty()) {
        return Err(invalid("presentation row without an id"));
    }
    for stub in error_stubs {
        if stub.id.is_empty() || stub.conversation_id != conversation_id {
            return Err(invalid("error stub for another conversation"));
        }
        // A row without `error` would be an event-free fact in the projection.
        if !matches!(stub.error.as_deref(), Some(error) if !error.is_empty()) {
            return Err(invalid("error stub without an error"));
        }
    }
    Ok(())
}

pub(crate) fn ai_chat_commit_inner(
    conn: &mut Connection,
    conversation_id: &str,
    events: &[EventRow],
    presentation: &[AiMessagePresentation],
    error_stubs: &[AiMessage],
) -> Result<CommitReport, CommandError> {
    validate_chat_commit(conversation_id, events, presentation, error_stubs)?;
    let tx = conn.transaction()?;
    let report = commit_events_in_transaction(&tx, events)?;
    tx.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1 AND error IS NOT NULL",
        params![conversation_id],
    )?;
    for row in presentation {
        tx.execute(
            "UPDATE ai_messages SET seq = ?3, parts_json = ?4
             WHERE id = ?1 AND conversation_id = ?2 AND error IS NULL",
            params![row.id, conversation_id, row.seq, row.parts_json],
        )?;
    }
    for stub in error_stubs {
        tx.execute(
            "INSERT INTO ai_messages
                (id, conversation_id, role, seq, content, created_at,
                 attachments_json, parts_json, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(id) DO NOTHING",
            params![
                stub.id,
                conversation_id,
                stub.role,
                stub.seq,
                stub.content,
                stub.created_at,
                stub.attachments_json,
                stub.parts_json,
                stub.error,
            ],
        )?;
    }
    tx.execute(
        "UPDATE ai_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        params![conversation_id],
    )?;
    tx.commit()?;
    Ok(report)
}

/// One row per non-empty conversation, newest-activity first: id, activity
/// timestamp, message count, and the first user message as a title preview.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSummary {
    pub id: String,
    pub updated_at: String,
    pub message_count: i64,
    pub preview: Option<String>,
}

#[tauri::command]
pub async fn ai_chat_list(app: tauri::AppHandle) -> Result<Vec<AiChatSummary>, CommandError> {
    crate::storage::blocking("ai_chat_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare(
            "SELECT c.id, c.updated_at, COUNT(m.id) AS message_count,
                    (SELECT content FROM ai_messages
                     WHERE conversation_id = c.id AND role = 'user'
                     ORDER BY seq, created_at, id LIMIT 1) AS preview
             FROM ai_conversations c
             LEFT JOIN ai_messages m ON m.conversation_id = c.id
             GROUP BY c.id
             HAVING COUNT(m.id) > 0
             ORDER BY c.updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AiChatSummary {
                id: row.get(0)?,
                updated_at: row.get(1)?,
                message_count: row.get(2)?,
                preview: row.get(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}
