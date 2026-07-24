//! The agent's long-term memory read model (docs/data-model.md §5.2).
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;

// --- Memories projection (agent long-term memory; docs/data-model.md §5.2) ---

/// Mirrors `MemoryRecord` in packages/agent (…/src/ports.ts).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub scope: String,
    pub kind: String,
    pub content: String,
    pub importance: f64,
    pub evidence_count: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_memory_status")]
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

fn default_memory_status() -> String {
    "active".to_string()
}

pub(crate) fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get("id")?,
        scope: row.get("scope")?,
        kind: row.get("kind")?,
        content: row.get("content")?,
        importance: row.get("importance")?,
        evidence_count: row.get("evidence_count")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn memories_list_all(db: State<'_, Db>) -> Result<Vec<Memory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM memories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_memory)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn memory_get(id: String, db: State<'_, Db>) -> Result<Option<Memory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT * FROM memories WHERE id = ?1",
        params![id],
        row_to_memory,
    ) {
        Ok(m) => Ok(Some(m)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn memory_put(memory: Memory, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO memories
            (id, scope, kind, content, importance, evidence_count, pinned, status,
             created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
            scope=excluded.scope, kind=excluded.kind, content=excluded.content,
            importance=excluded.importance, evidence_count=excluded.evidence_count,
            pinned=excluded.pinned, status=excluded.status,
            created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![
            memory.id,
            memory.scope,
            memory.kind,
            memory.content,
            memory.importance,
            memory.evidence_count,
            memory.pinned as i64,
            memory.status,
            memory.created_at,
            memory.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

