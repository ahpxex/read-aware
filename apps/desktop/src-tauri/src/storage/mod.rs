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
// kind, sha256, size, storage_uri) — see docs/sqlite-schema.sql.
//
// Retrieval is FTS + structured signals per docs/agent-architecture.md §4 —
// there is no vector store in the default architecture.

pub mod apply;
mod execution;
pub(crate) use execution::blocking;
mod library;
pub use library::*;
mod library_cleanup;
pub use library_cleanup::*;
mod annotations;
pub use annotations::*;
mod annotation_pages;
pub use annotation_pages::*;
mod annotation_mutations;
pub use annotation_mutations::*;
mod memory_mutations;
pub use memory_mutations::*;
mod user_profile;
pub use user_profile::*;
mod local_event_guard;
mod entity_registry;
mod entity_queries;
pub use entity_queries::*;
mod entity_mutations;
pub use entity_mutations::*;
mod book_classification;
pub use book_classification::*;
mod book_merge;
pub use book_merge::*;
mod book_digest;
pub use book_digest::*;
mod memory_maintenance;
pub use memory_maintenance::*;
mod memories;
pub use memories::*;
mod chat;
pub use chat::*;
mod plugin_docs;
pub use plugin_docs::*;
mod plugin_document_operations;
mod plugin_document_search;
pub use plugin_document_operations::*;
mod schema;
pub use schema::*;
mod blobs;
pub use blobs::*;
mod events;
pub use events::*;
mod sync;
pub use sync::*;
mod reading_time;
pub use reading_time::*;
mod reading_snapshot;
pub use reading_snapshot::*;
mod preferences;
pub use preferences::*;
mod checkpoints;
pub use checkpoints::*;

use crate::error::CommandError;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

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
pub struct Db(pub Mutex<Connection>);

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
        )
        ?;
        return Ok(device_id);
    }
    let device_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO local_device (id, device_id, created_at, last_opened_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![device_id],
    )
    ?;
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

#[tauri::command]
pub async fn local_device_get(
    app: tauri::AppHandle,
) -> Result<LocalDeviceInfo, CommandError> {
    crate::storage::blocking("local_device_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let device_id = ensure_local_device(&conn)?;
        // The log's newest stamp — OR a restored checkpoint's frontier, which is
        // newer than anything a still-backfilling log holds: the projections
        // already reflect events up to it, so local stamps must sort after it.
        let last = conn
            .query_row(
                "SELECT hlc_wall_ms, hlc_counter FROM (
                SELECT hlc_wall_ms, hlc_counter FROM domain_events
                UNION ALL
                SELECT hlc_wall_ms, hlc_counter FROM projection_checkpoints
             )
             ORDER BY hlc_wall_ms DESC, hlc_counter DESC LIMIT 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        Ok(LocalDeviceInfo {
            device_id,
            last_hlc_wall_ms: last.map(|(wall, _)| wall),
            last_hlc_counter: last.map(|(_, counter)| counter),
        })
    })
    .await
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

/// Load the entire `app_kv` store as a `{ key: value_json }` map. Called once at
/// boot to hydrate the synchronous in-memory snapshot the settings modules read.
#[tauri::command]
pub async fn load_kv_all(
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, CommandError> {
    crate::storage::blocking("load_kv_all", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn
            .prepare("SELECT key, value_json FROM app_kv")
            ?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            ?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }
        Ok(map)
    })
    .await
}

/// Upsert one config key (write-through from `localKV.setItem`).
#[tauri::command]
pub async fn set_kv(
    key: String,
    value: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("set_kv", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let entries = vec![(key, Some(value))];
        crate::desktop_preferences::commit_entries(&app, &entries, || set_kv_batch_inner(&mut conn, entries.clone()))
    })
    .await
}

pub(crate) fn set_kv_batch_inner(
    conn: &mut Connection,
    entries: Vec<(String, Option<String>)>,
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
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
    Ok(tx.commit()?)
}

/// A settings command can span several preference records, but commits all or none.
#[tauri::command]
pub async fn set_kv_batch(
    entries: Vec<(String, Option<String>)>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("set_kv_batch", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        crate::desktop_preferences::commit_entries(&app, &entries, || set_kv_batch_inner(&mut conn, entries.clone()))
    })
    .await
}

/// Delete one config key (write-through from `localKV.removeItem`).
#[tauri::command]
pub async fn delete_kv(
    key: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("delete_kv", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let entries = vec![(key, None)];
        crate::desktop_preferences::commit_entries(&app, &entries, || set_kv_batch_inner(&mut conn, entries.clone()))
    })
    .await
}

pub(crate) fn replace_kv_prefix_inner(
    conn: &mut Connection,
    prefix: &str,
    entries: std::collections::HashMap<String, String>,
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM app_kv WHERE substr(key, 1, length(?1)) = ?1",
        params![prefix],
    )
    ?;
    for (suffix, value) in entries {
        tx.execute(
            "INSERT INTO app_kv (key, value_json, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![format!("{prefix}{suffix}"), value],
        )
        ?;
    }
    Ok(tx.commit()?)
}

/// Replace one namespaced KV snapshot in a single transaction. Plugin update
/// recovery uses this instead of racing individual fire-and-forget writes.
#[tauri::command]
pub async fn replace_kv_prefix(
    prefix: String,
    entries: std::collections::HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("replace_kv_prefix", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let general = if let Some(suffix) = crate::desktop_preferences::GENERAL_KEY.strip_prefix(&prefix) {
            vec![(crate::desktop_preferences::GENERAL_KEY.to_string(), entries.get(suffix).cloned())]
        } else { vec![] };
        crate::desktop_preferences::commit_entries(&app, &general, || replace_kv_prefix_inner(&mut conn, &prefix, entries))
    })
    .await
}

#[cfg(test)]
mod tests;
