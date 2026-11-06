//! IPC commands over `read_aware_store::storage::chat`.
use crate::error::CommandError;
use crate::storage::*;

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
