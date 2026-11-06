//! IPC commands over `read_aware_store::storage::conversation_insights`.
use crate::error::CommandError;
use crate::storage::Db;
use crate::storage::*;
use serde_json::Value;

#[tauri::command]
pub async fn conversation_insights_snapshot(
    app: tauri::AppHandle,
    target: Value,
) -> Result<ConversationInsightsSnapshot, CommandError> {
    crate::storage::blocking("conversation_insights_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        conversation_insights_snapshot_inner(&mut conn, target)
    })
    .await
}
