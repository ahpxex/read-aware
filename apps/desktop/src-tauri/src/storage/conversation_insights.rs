//! Durable, target-scoped rolling summaries. Never loads message contents.
use super::{user_profile, Db};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const INSIGHTS_KEY: &str = "read-aware-agent-insights";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InsightsTarget {
    kind: String,
    id: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationInsightsSnapshot {
    target: InsightsTarget,
    status: &'static str,
    summary: Option<String>,
    revision: String,
}

fn invalid_target() -> CommandError {
    CommandError::new("ui/invalid-target", "Invalid conversation insights target")
}

pub(crate) fn conversation_insights_snapshot_inner(
    conn: &mut Connection,
    input: Value,
) -> Result<ConversationInsightsSnapshot, CommandError> {
    let target: InsightsTarget = serde_json::from_value(input).map_err(|_| invalid_target())?;
    let global = target.id == "__global__" || target.id.starts_with("thread-");
    if !matches!(target.kind.as_str(), "book" | "global")
        || target.id.trim().is_empty()
        || target.id.encode_utf16().count() > 256
        || target.id.contains('\0')
        || (target.kind == "global") != global
    {
        return Err(invalid_target());
    }
    let tx = conn.transaction()?;
    user_profile::require_initialized(&tx)?;
    if target.kind == "book" {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [&target.id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CommandError::new(
                "reader/book-not-found",
                "Conversation book no longer exists",
            ));
        }
    }
    let cleared: Option<Option<String>> = tx
        .query_row(
            "SELECT cleared_at FROM ai_conversations WHERE id=?1",
            [&target.id],
            |row| row.get(0),
        )
        .optional()?;
    if target.kind == "global" && cleared.is_none() {
        return Err(invalid_target());
    }
    let raw: Option<String> = tx
        .query_row(
            "SELECT value_json FROM app_kv WHERE key=?1",
            [INSIGHTS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let map: BTreeMap<String, String> = match raw {
        None => BTreeMap::new(),
        Some(raw) => serde_json::from_str(&raw).map_err(|_| {
            CommandError::new("db/error", "Invalid stored conversation insights map")
        })?,
    };
    let key = format!("{}:{}", target.kind, target.id);
    let selected = map.get(&key).or_else(|| {
        if target.id == "__global__" {
            map.get("global")
        } else {
            None
        }
    });
    let (status, summary) = match selected {
        None => ("absent", None),
        Some(_) if !matches!(cleared, Some(None)) => ("unavailable", None),
        Some(text) => {
            if text.len() > 1024 * 1024 || text.contains('\0') {
                return Err(CommandError::new(
                    "memory/invalid-input",
                    "Stored conversation summary exceeds artifact bounds",
                ));
            }
            ("present", Some(text.clone()))
        }
    };
    let bytes = serde_json::to_vec(&(
        "conversation-insights",
        1,
        &target.kind,
        &target.id,
        status,
        &summary,
    ))?;
    let revision = format!("cins1:{:x}", Sha256::digest(bytes));
    tx.commit()?;
    Ok(ConversationInsightsSnapshot {
        target,
        status,
        summary,
        revision,
    })
}

#[tauri::command]
pub async fn conversation_insights_snapshot(
    app: tauri::AppHandle,
    target: Value,
) -> Result<ConversationInsightsSnapshot, CommandError> {
    super::blocking("conversation_insights_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        conversation_insights_snapshot_inner(&mut conn, target)
    })
    .await
}
