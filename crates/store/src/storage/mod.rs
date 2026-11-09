// Local-first storage backend (desktop) — SQLite + filesystem blob store.
//
// This is the desktop implementation of @read-aware/core's storage contracts.
// `domain_events` is the append-only source of truth and the unit of sync; the
// typed tables (books/collections/annotations) are projections DERIVED from it
// by `storage::apply`. Every state change goes through `commit_events`, which
// appends and applies in one transaction, and `rebuild_projections` can throw
// the tables away and replay the log to reproduce them. Blob BYTES live on the
// filesystem under
// `<app_data>/blobs/`; SQLite holds only the `blob_objects` registry (key,
// kind, sha256, size, storage_uri) — see docs/archive/designs/sqlite-schema.sql.
//
// Retrieval is FTS + structured signals per docs/architecture/agent-architecture.md —
// there is no vector store in the default architecture.

pub mod apply;
pub mod connection;
pub use connection::SharedConnection;
pub mod library;
pub mod reading_progress;
pub use library::*;
pub mod library_cleanup;
pub use library_cleanup::*;
pub mod import_cleanup;
pub use import_cleanup::*;
pub mod annotation_range;
pub mod annotations;
pub mod bookmarks;
pub use annotations::*;
pub use bookmarks::{
    adopt_plugin_documents_inner, bookmarks_list_inner, BookmarkAdoption, BookmarkRow,
};
pub mod annotation_pages;
pub use annotation_pages::*;
pub mod annotation_mutations;
pub use annotation_mutations::*;
pub mod memory_mutations;
pub use memory_mutations::*;
pub mod user_profile;
pub use user_profile::*;
pub mod onboarding;
pub use onboarding::*;
pub mod profile_context;
pub use profile_context::*;
pub mod context_bundle;
pub mod context_bundle_publication;
pub mod local_event_guard;
pub use context_bundle::validate_context_resource;
pub use context_bundle_publication::*;
pub mod conversation_insights;
pub use conversation_insights::*;
pub mod book_context;
pub use book_context::*;
pub mod context_bundle_history;
pub use context_bundle_history::*;
pub mod entity_queries;
pub mod entity_registry;
pub use entity_queries::*;
pub mod entity_mutations;
pub use entity_mutations::*;
pub mod book_classification;
pub use book_classification::*;
pub mod book_merge;
pub use book_merge::*;
pub mod book_digest;
pub use book_digest::*;
pub mod memory_creation;
pub use memory_creation::*;
pub mod memory_maintenance;
pub use memory_maintenance::*;
pub mod identity_consolidation;
pub use identity_consolidation::*;
pub mod identity_consolidation_commit;
pub use identity_consolidation_commit::*;
pub mod identity_work;
pub use identity_work::*;
pub mod memories;
pub mod memory_page;
pub use memories::*;
pub use memory_page::*;
pub mod chat;
pub use chat::*;
pub mod plugin_assets;
pub mod plugin_docs;
pub mod plugin_storage_usage;
pub mod virtual_books;
pub use plugin_docs::*;
pub mod plugin_data;
pub use plugin_data::*;
pub mod backup_reading;
pub use backup_reading::*;
pub mod credential_crypto;
pub mod restored_credentials;
pub use restored_credentials::*;
pub mod plugin_update_journal;
pub use plugin_update_journal::*;
pub mod atomic_commit;
pub mod durable_jobs;
pub mod plugin_document_operations;
pub use atomic_commit::*;
pub use durable_jobs::*;
pub mod plugin_document_search;
pub use plugin_document_operations::*;
pub mod schema;
pub use schema::*;
pub mod blobs;
pub use blobs::*;
pub mod events;
pub use events::*;
pub mod sync;
pub use sync::*;
pub mod reading_time;
pub use reading_time::*;
pub mod reading_snapshot;
pub use reading_snapshot::*;
pub mod preferences;
pub use preferences::*;
pub mod checkpoints;
pub use checkpoints::*;
pub mod archive_member;
pub mod store_lock;
pub use store_lock::{process_alive, ProcessPresence, StoreLock, Wait};
pub mod backup_restore_files;

use crate::error::CommandError;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Hybrid logical clock stamp. Mirrors `HlcStamp` in @read-aware/core.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hlc {
    pub wall_ms: i64,
    pub counter: i64,
    pub device_id: String,
}

/// One row of the append-only event log. Mirrors `DomainEventEnvelope`.
/// The optional fields default at insert time (`schema_version` 1, `actor_id`
/// 'local', `created_at` derived from the HLC wall time).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub hlc: Hlc,
    #[serde(default)]
    pub schema_version: Option<i64>,
    #[serde(default)]
    pub aggregate_type: Option<String>,
    #[serde(default)]
    pub aggregate_id: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    pub payload: Value,
}

/// Managed Tauri state: the single SQLite connection behind a mutex.
pub struct Db(pub SharedConnection);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Self(SharedConnection::new(conn))
    }
}

/// Managed Tauri state: the app-data directory. Blob bytes live in
/// `<data_dir>/blobs/`; `blob_objects.storage_uri` is relative to this root.
pub struct DataDir(pub PathBuf);

// --- Device identity (HLC + sync attribution) --------------------------------

/// Ensure the single `local_device` row exists and return its stable device id,
/// generating one on first run. Bumps `last_opened_at` on every boot.
pub fn ensure_local_device(conn: &Connection) -> Result<String, CommandError> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT device_id FROM local_device WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    if let Some(device_id) = existing {
        conn.execute(
            "UPDATE local_device SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = 1",
            [],
        )?;
        return Ok(device_id);
    }
    let device_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO local_device (id, device_id, created_at, last_opened_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![device_id],
    )?;
    Ok(device_id)
}

/// Boot info for the frontend HLC: the stable device id plus the highest HLC
/// in the log — ANY device's, not just our own. Own stamps must not be
/// re-minted after a restart (the unique HLC index would drop the event), and
/// merged remote stamps must stay observed across restarts: `hlc.observe()`
/// keeps the running clock ahead of everything pulled during a session, and
/// this seed is what carries that guarantee over a relaunch. Scoping it to our
/// own device would let a lagging wall clock mint stamps that sort before
/// events already merged from a peer.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeviceInfo {
    pub device_id: String,
    pub last_hlc_wall_ms: Option<i64>,
    pub last_hlc_counter: Option<i64>,
}

// --- Device-local key/value config (backs the settings seam) ---

/// The persisted app theme preference, read straight off the connection during
/// setup — BEFORE the main window (and its boot splash) exists. Returns
/// `"light"` / `"dark"` for an explicit choice, `None` for "system", an unset
/// key, or an unreadable value — the caller then follows the OS scheme.
/// A `plugin:<id>:<themeId>` skin resolves through the app-skin snapshot's
/// polarity (written by the web layer whenever a skin applies).
/// Keys/shapes mirror `features/settings/lib/app-settings.ts` and `app-skin.ts`.
pub fn read_boot_theme(conn: &Connection) -> Option<&'static str> {
    fn read_kv(conn: &Connection, key: &str) -> Option<Value> {
        let value: String = conn
            .query_row(
                "SELECT value_json FROM app_kv WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .ok()?;
        serde_json::from_str(&value).ok()
    }

    let settings = read_kv(conn, "read-aware-app-settings")?;
    match settings.get("theme").and_then(|theme| theme.as_str()) {
        Some("light") => Some("light"),
        Some("dark") => Some("dark"),
        Some(theme) if theme.starts_with("plugin:") => {
            let snapshot = read_kv(conn, "read-aware-app-skin")?;
            if snapshot.get("ref").and_then(|r| r.as_str()) != Some(theme) {
                return None;
            }
            match snapshot.get("polarity").and_then(|p| p.as_str()) {
                Some("light") => Some("light"),
                Some("dark") => Some("dark"),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Read one durable key without exporting the rest of the store.
pub fn get_kv_inner(conn: &Connection, key: &str) -> Result<Option<String>, CommandError> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row("SELECT value_json FROM app_kv WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

pub fn set_kv_batch_inner(
    conn: &mut Connection,
    entries: Vec<(String, Option<String>)>,
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    set_kv_batch_in_transaction(&tx, entries)?;
    Ok(tx.commit()?)
}

pub fn set_kv_batch_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    entries: Vec<(String, Option<String>)>,
) -> Result<(), CommandError> {
    for (key, value) in entries {
        let Some(value) = value else {
            tx.execute("DELETE FROM app_kv WHERE key = ?1", params![key])?;
            continue;
        };
        tx.execute(
            "INSERT INTO app_kv (key, value_json, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at",
            params![key, value],
        )?;
    }
    Ok(())
}

/// Write KV entries and the `preference.changed` events that roam them in ONE
/// transaction, so a roaming save never lands in KV without its event (or the
/// reverse). Only preference events for keys written by this same batch are
/// accepted; this is not a general event-commit entry.
pub fn set_kv_batch_with_preferences_inner(
    conn: &mut Connection,
    entries: Vec<(String, Option<String>)>,
    events: &[EventRow],
) -> Result<(), CommandError> {
    let keys: std::collections::HashSet<&str> =
        entries.iter().map(|(key, _)| key.as_str()).collect();
    for event in events {
        let key = event.payload.get("key").and_then(Value::as_str);
        if event.event_type != "preference.changed"
            || key.is_none_or(|key| !keys.contains(key))
            || event.aggregate_id.as_deref() != key
        {
            // A host wiring defect, never user input.
            return Err(CommandError::new(
                crate::error::CODE_INTERNAL,
                "Only preference events for keys in this batch may join a KV write",
            ));
        }
    }
    let tx = conn.transaction()?;
    events::commit_events_in_transaction(&tx, events)?;
    set_kv_batch_in_transaction(&tx, entries)?;
    Ok(tx.commit()?)
}

pub fn replace_kv_prefix_inner(
    conn: &mut Connection,
    prefix: &str,
    entries: std::collections::HashMap<String, String>,
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM app_kv WHERE substr(key, 1, length(?1)) = ?1",
        params![prefix],
    )?;
    for (suffix, value) in entries {
        tx.execute(
            "INSERT INTO app_kv (key, value_json, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![format!("{prefix}{suffix}"), value],
        )?;
    }
    Ok(tx.commit()?)
}

#[cfg(test)]
mod tests;

pub mod capability_changes;
pub use capability_changes::*;
