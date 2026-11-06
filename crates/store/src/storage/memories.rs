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

pub fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
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

pub fn bounded_memory_row(row: &rusqlite::Row) -> Result<Memory, CommandError> {
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
