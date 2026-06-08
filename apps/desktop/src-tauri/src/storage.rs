// Local-first storage backend (desktop) — SQLite event log + blob store.
//
// This is the desktop implementation of @read-aware/core's `StorageAdapter`.
// The event log is the source of truth and the unit of sync; structured tables
// and the vector index are derived projections rebuilt from it.
//
// Vector search (upsert/query) is stubbed until an embedding pipeline exists;
// it will be backed by LanceDB. See CLAUDE.md > Storage Responsibilities.

use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

/// Hybrid logical clock stamp. Mirrors `HlcStamp` in @read-aware/core.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hlc {
    pub wall_ms: i64,
    pub counter: i64,
    pub device_id: String,
}

/// One row of the append-only event log. Mirrors `DomainEventEnvelope`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRow {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub hlc: Hlc,
    pub payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorItem {
    pub id: String,
    pub embedding: Vec<f32>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VectorMatch {
    pub id: String,
    pub score: f32,
    pub metadata: Option<Value>,
}

/// Managed Tauri state: the single SQLite connection behind a mutex.
pub struct Db(pub Mutex<Connection>);

/// Open (creating if needed) the app database and ensure the schema exists.
pub fn init_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("read-aware.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS events (
            id          TEXT PRIMARY KEY,
            type        TEXT NOT NULL,
            hlc_wall    INTEGER NOT NULL,
            hlc_counter INTEGER NOT NULL,
            hlc_device  TEXT NOT NULL,
            payload     TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_events_hlc
            ON events (hlc_wall, hlc_counter, hlc_device);
         CREATE TABLE IF NOT EXISTS blobs (
            key  TEXT PRIMARY KEY,
            data BLOB NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
    let payload_str: String = row.get(5)?;
    let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);
    Ok(EventRow {
        id: row.get(0)?,
        event_type: row.get(1)?,
        hlc: Hlc {
            wall_ms: row.get(2)?,
            counter: row.get(3)?,
            device_id: row.get(4)?,
        },
        payload,
    })
}

// --- Event log (the sync unit) ---

#[tauri::command]
pub fn append_events(events: Vec<EventRow>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for ev in &events {
        let payload = serde_json::to_string(&ev.payload).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO events
                (id, type, hlc_wall, hlc_counter, hlc_device, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.id,
                ev.event_type,
                ev.hlc.wall_ms,
                ev.hlc.counter,
                ev.hlc.device_id,
                payload
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_events_since(after: Option<Hlc>, db: State<'_, Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    match after {
        Some(a) => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, type, hlc_wall, hlc_counter, hlc_device, payload FROM events
                     WHERE (hlc_wall, hlc_counter, hlc_device) > (?1, ?2, ?3)
                     ORDER BY hlc_wall, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map(params![a.wall_ms, a.counter, a.device_id], row_to_event)
                .map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, type, hlc_wall, hlc_counter, hlc_device, payload FROM events
                     ORDER BY hlc_wall, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt.query_map([], row_to_event).map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

// --- Blobs (book files + derivatives) ---

#[tauri::command]
pub fn put_blob(key: String, data: Vec<u8>, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO blobs (key, data) VALUES (?1, ?2)",
        params![key, data],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_blob(key: String, db: State<'_, Db>) -> Result<Option<Vec<u8>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT data FROM blobs WHERE key = ?1",
        params![key],
        |row| row.get::<_, Vec<u8>>(0),
    ) {
        Ok(data) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_blob(key: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM blobs WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Vector index (stubbed; LanceDB-backed later) ---

#[tauri::command]
pub fn upsert_vectors(_items: Vec<VectorItem>) -> Result<(), String> {
    // TODO(local-first): persist into LanceDB once an embedding pipeline exists.
    Ok(())
}

#[tauri::command]
pub fn query_vectors(_embedding: Vec<f32>, _k: u32) -> Result<Vec<VectorMatch>, String> {
    // TODO(local-first): query LanceDB. No-op until vectors are written.
    Ok(Vec::new())
}
