//! The agent's long-term memory read model (docs/architecture/data-model.md).
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;
use crate::error::CommandError;

// --- Memories projection (agent long-term memory; docs/architecture/data-model.md) ---

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

pub(crate) fn bounded_memory_row(row: &rusqlite::Row) -> Result<Memory, CommandError> {
    let mut bytes = 0usize;
    for index in 0..row.as_ref().column_count() {
        if let rusqlite::types::ValueRef::Text(value) | rusqlite::types::ValueRef::Blob(value) =
            row.get_ref(index)?
        {
            bytes = bytes.saturating_add(value.len());
        }
        if bytes > 128 * 1024 {
            return Err(CommandError::new(
                "memory/input-budget-exceeded",
                "Memory row exceeds its read budget",
            ));
        }
    }
    Ok(row_to_memory(row)?)
}

#[tauri::command]
pub async fn memories_list_all(app: tauri::AppHandle) -> Result<Vec<Memory>, CommandError> {
    crate::storage::blocking("memories_list_all", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare("SELECT * FROM memories")?;
        let rows = stmt.query_map([], row_to_memory)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn memory_get(id: String, app: tauri::AppHandle) -> Result<Option<Memory>, CommandError> {
    crate::storage::blocking("memory_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        match conn.query_row(
            "SELECT * FROM memories WHERE id = ?1",
            params![id],
            row_to_memory,
        ) {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
    .await
}

/// LEGACY-MIGRATION-ONLY projection writer, exempt from the `apply_event` rule
/// in `apply.rs`. Its only caller is the one-time, flag-gated migration of
/// webview IndexedDB memories (`importWebviewMemoriesIntoSqlite` in
/// `apps/web/src/platform/desktop-import.ts`); boot-time genesis
/// reconciliation then synthesizes the creation events the log never saw.
/// Every other write goes through `commit_events` — do not add callers.
#[tauri::command]
pub async fn memory_put(memory: Memory, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("memory_put", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
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
        )?;
        Ok(())
    })
    .await
}

// --- Chapter digests projection (book memory; book.chapterDigested) ---

/// Mirrors `ChapterDigest` in packages/agent (…/src/ports.ts). `characters`
/// stays an opaque JSON string here — the TS port owns its shape.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDigest {
    pub content_version: Option<String>,
    pub book_id: String,
    pub chapter_index: i64,
    pub chapter_href: Option<String>,
    pub summary: String,
    pub characters_json: String,
    pub relations_json: String,
    pub digest_version: i64,
    /// 纪要口径；None = narrative（口径分流之前的旧行）。
    pub flavor: Option<String>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn chapter_digests_list(
    book_id: String,
    content_version: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<ChapterDigest>, CommandError> {
    crate::storage::blocking("chapter_digests_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut guard = db.0.lock()?;
        let conn = guard.transaction()?;
        let (count, bytes): (i64, i64) = conn.query_row("SELECT count(*),coalesce(sum(length(CAST(summary AS BLOB))+length(CAST(characters_json AS BLOB))+length(CAST(relations_json AS BLOB))),0) FROM chapter_digests WHERE book_id=?1 AND (?2 IS NULL OR content_version=?2)", params![book_id, content_version], |r| Ok((r.get(0)?,r.get(1)?)))?;
        if count > 10000 || bytes > 8 * 1024 * 1024 { return Err(CommandError::new("memory/input-budget-exceeded", "Digest collection exceeds its read budget")); }
        let mut stmt = conn
            .prepare(
                "SELECT book_id, chapter_index, chapter_href, summary,
                    characters_json, relations_json, digest_version, flavor, updated_at, content_version
               FROM chapter_digests WHERE book_id = ?1 AND (?2 IS NULL OR content_version = ?2)
              ORDER BY chapter_index",
            )
            ?;
        let rows = stmt
            .query_map(params![book_id, content_version], |row| {
                Ok(ChapterDigest {
                    content_version: row.get(9)?,
                    book_id: row.get(0)?,
                    chapter_index: row.get(1)?,
                    chapter_href: row.get(2)?,
                    summary: row.get(3)?,
                    characters_json: row.get(4)?,
                    relations_json: row.get(5)?,
                    digest_version: row.get(6)?,
                    flavor: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            ?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}
