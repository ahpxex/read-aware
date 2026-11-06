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

pub fn row_to_ai_message(row: &rusqlite::Row) -> rusqlite::Result<AiMessage> {
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

pub fn ai_chat_replace_inner(
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

pub fn ai_chat_commit_inner(
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
