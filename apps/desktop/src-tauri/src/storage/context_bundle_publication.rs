//! A local source clock fences multi-read assembly, not plugin authority.
use super::{context_bundle, events, local_event_guard, user_profile, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;

pub(super) const SOURCE_TABLES: &[&str] = &[
    "user_profile",
    "entities",
    "entity_aliases",
    "entity_redirects",
    "memories",
    "books",
    "annotations",
    "chapter_digests",
    "ai_conversations",
    "ai_messages",
    "app_kv",
    "plugin_documents",
    "plugin_document_generations",
    "synced_preferences",
];

pub(super) fn install_source_clock(conn: &Connection) -> Result<(), CommandError> {
    conn.execute_batch(
        "CREATE TABLE context_bundle_source_clock (
        id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL,
        counter INTEGER NOT NULL CHECK(typeof(counter)='integer' AND counter>=0));",
    )?;
    for table in SOURCE_TABLES {
        for action in ["INSERT", "UPDATE", "DELETE"] {
            conn.execute_batch(&format!("CREATE TRIGGER context_source_{table}_{action} AFTER {action} ON {table}
                BEGIN INSERT INTO context_bundle_source_clock(id,generation,counter) VALUES(1,lower(hex(randomblob(16))),1)
                ON CONFLICT(id) DO UPDATE SET counter=counter+1; END;"))?;
        }
    }
    Ok(())
}

fn revision(conn: &Connection) -> Result<String, CommandError> {
    conn.execute("INSERT OR IGNORE INTO context_bundle_source_clock(id,generation,counter) VALUES(1,lower(hex(randomblob(16))),0)", [])?;
    let (generation, counter): (String, i64) = conn.query_row(
        "SELECT generation,counter FROM context_bundle_source_clock WHERE id=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(format!("cbsource1:{generation}:{counter}"))
}

pub(crate) fn context_bundle_source_revision_inner(
    conn: &mut Connection,
) -> Result<String, CommandError> {
    let tx = conn.transaction()?;
    user_profile::require_initialized(&tx)?;
    let value = revision(&tx)?;
    tx.commit()?;
    Ok(value)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundlePublicationReceipt {
    pub version: String,
    pub changed: bool,
    pub persistence: &'static str,
}

pub(crate) fn context_bundle_publish_inner(
    conn: &mut Connection,
    event: &EventRow,
    expected_read_revision: &str,
) -> Result<BundlePublicationReceipt, CommandError> {
    let bundle = context_bundle::validate(&event.payload)?;
    if event.event_type != "context.bundlePublished"
        || event.aggregate_type.as_deref() != Some("contextBundle")
        || event.aggregate_id.as_deref() != Some(&bundle.version)
        || event.created_at.is_some()
    {
        return Err(CommandError::new(
            "memory/invalid-input",
            "Invalid bundle publication envelope",
        ));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    user_profile::require_initialized(&tx)?;
    if revision(&tx)? != expected_read_revision {
        return Err(CommandError::new(
            "memory/conflict",
            "Context sources changed during assembly",
        ));
    }
    local_event_guard::validate_new_event(&tx, event)?;
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM context_bundles WHERE version=?1)",
        params![bundle.version],
        |row| row.get(0),
    )?;
    if !exists {
        let result = events::commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
        if result.appended != 1 || result.applied != 1 {
            return Err(CommandError::internal("Incomplete bundle publication"));
        }
    }
    tx.commit()?;
    Ok(BundlePublicationReceipt {
        version: bundle.version,
        changed: !exists,
        persistence: "event-log",
    })
}

#[tauri::command]
pub async fn context_bundle_source_revision(app: tauri::AppHandle) -> Result<String, CommandError> {
    super::blocking("context_bundle_source_revision", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_source_revision_inner(&mut conn)
    })
    .await
}

#[tauri::command]
pub async fn context_bundle_publish(
    app: tauri::AppHandle,
    event: EventRow,
    expected_read_revision: String,
) -> Result<BundlePublicationReceipt, CommandError> {
    super::blocking("context_bundle_publish", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_publish_inner(&mut conn, &event, &expected_read_revision)
    })
    .await
}
