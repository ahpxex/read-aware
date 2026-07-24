//! Conversation transcripts: one row per message, whole-transcript replace on
//! save, tombstoned clear.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;

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
pub fn ai_chat_load(conversation_id: String, db: State<'_, Db>) -> Result<Vec<AiMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM ai_messages WHERE conversation_id = ?1 ORDER BY seq")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], row_to_ai_message)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn ai_chat_load_all(db: State<'_, Db>) -> Result<Vec<AiMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM ai_messages ORDER BY conversation_id, seq")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_ai_message)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Whole-transcript replace, mirroring the store's save semantics (the hook
/// persists the full message array after each committed turn). `seq` is
/// assigned here from array order.
#[tauri::command]
pub fn ai_chat_replace(
    conversation_id: String,
    messages: Vec<AiMessage>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO ai_conversations (id, created_at, updated_at, cleared_at)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL)
         ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at, cleared_at = NULL",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    for (seq, message) in messages.iter().enumerate() {
        tx.execute(
            "INSERT INTO ai_messages
                (id, conversation_id, role, seq, content, created_at,
                 attachments_json, parts_json, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
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
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
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
pub fn ai_chat_list(db: State<'_, Db>) -> Result<Vec<AiChatSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.updated_at, COUNT(m.id) AS message_count,
                    (SELECT content FROM ai_messages
                     WHERE conversation_id = c.id AND role = 'user'
                     ORDER BY seq LIMIT 1) AS preview
             FROM ai_conversations c
             LEFT JOIN ai_messages m ON m.conversation_id = c.id
             GROUP BY c.id
             HAVING COUNT(m.id) > 0
             ORDER BY c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AiChatSummary {
                id: row.get(0)?,
                updated_at: row.get(1)?,
                message_count: row.get(2)?,
                preview: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Clear = delete the messages, keep the conversation row with a `cleared_at`
/// tombstone (cross-device clear semantics per docs/sqlite-schema.sql).
#[tauri::command]
pub fn ai_chat_clear(conversation_id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_conversations
         SET cleared_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

