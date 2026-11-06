//! Snapshot-consistent memory pages without materializing the corpus in the WebView.
//! SQLite orders scoped candidates; native code streams matching rows into the
//! result identity and retains only the requested page. Exact content identity
//! still requires a scan: this is not a constant-time or durable snapshot API.
use super::{memories::bounded_memory_row, Db, Memory};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPage {
    pub(crate) items: Vec<Memory>,
    offset: usize,
    next_offset: Option<usize>,
    total: usize,
    revision: String,
}

struct Query {
    scopes: Vec<String>,
    query: String,
    offset: usize,
    limit: usize,
    expected: Option<String>,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-query", "Invalid memory page query")
}

// ECMAScript whitespace (not Rust's extra U+0085 whitespace).
fn whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn normalize(input: &Value) -> Result<Query, CommandError> {
    let fields = input.as_object().ok_or_else(invalid)?;
    if fields.keys().any(|key| {
        !["scopes", "query", "offset", "limit", "expectedRevision"].contains(&key.as_str())
    }) {
        return Err(invalid());
    }
    let values = fields
        .get("scopes")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if values.is_empty() || values.len() > 16 {
        return Err(invalid());
    }
    let mut scopes = Vec::new();
    for value in values {
        let scope = value.as_str().ok_or_else(invalid)?;
        if scope != "user"
            && scope != "global"
            && !scope.strip_prefix("book:").is_some_and(|id| {
                !id.trim_matches(whitespace).is_empty() && scope.encode_utf16().count() <= 261
            })
        {
            return Err(invalid());
        }
        scopes.push(scope.to_string());
    }
    scopes.sort();
    scopes.dedup();
    let query = match fields.get("query") {
        None => "",
        Some(value) => value
            .as_str()
            .filter(|s| s.encode_utf16().count() <= 2000)
            .ok_or_else(invalid)?,
    }
    .trim_matches(whitespace)
    .to_string();
    let number = |key, default| {
        fields
            .get(key)
            .map_or(Ok(default), |v| v.as_u64().ok_or_else(invalid))
    };
    let offset = number("offset", 0)?;
    let limit = number("limit", 20)?;
    if offset > 9_007_199_254_740_991 || !(1..=100).contains(&limit) {
        return Err(invalid());
    }
    let expected = fields
        .get("expectedRevision")
        .map(|v| {
            let s = v.as_str().ok_or_else(invalid)?;
            if s.len() != 69
                || !(s.starts_with("mpg1:") || s.starts_with("mpg2:"))
                || !s[5..]
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(invalid());
            }
            Ok(s.to_string())
        })
        .transpose()?;
    if offset > 0 && expected.is_none() {
        return Err(invalid());
    }
    Ok(Query {
        scopes,
        query,
        offset: offset as usize,
        limit: limit as usize,
        expected,
    })
}

fn search_terms(query: &str) -> Vec<String> {
    let query = query.to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    let mut terms = vec![query.clone()];
    for token in query.split(|c| {
        whitespace(c) || ",.。，！？!?；;：:、\"'“”‘’()（）《》〈〉【】[]-—…·/|".contains(c)
    }) {
        let cjk = token.chars().any(|c| matches!(c, '\u{4e00}'..='\u{9fff}' | '\u{3040}'..='\u{30ff}' | '\u{ac00}'..='\u{d7af}'));
        if token.encode_utf16().count() >= if cjk { 2 } else { 4 } {
            terms.push(token.to_string());
        }
    }
    terms
}

fn hash_value(hash: &mut Sha256, value: &impl Serialize) -> Result<(), CommandError> {
    let bytes =
        serde_json::to_vec(value).map_err(|error| CommandError::internal(error.to_string()))?;
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    Ok(())
}

pub(crate) fn memory_page_inner(
    conn: &mut Connection,
    input: &Value,
) -> Result<MemoryPage, CommandError> {
    let tx = conn.transaction()?;
    let result = memory_page_read(&tx, input)?;
    tx.commit()?;
    Ok(result)
}

pub(crate) fn memory_page_read(
    conn: &Connection,
    input: &Value,
) -> Result<MemoryPage, CommandError> {
    let query = normalize(input)?;
    let terms = search_terms(&query.query);
    let mut hash = Sha256::new();
    hash.update(b"readaware-memory-page-v2");
    hash_value(&mut hash, &query.scopes)?;
    hash_value(&mut hash, &query.query)?;
    let mut items = Vec::with_capacity(query.limit);
    let mut total = 0;
    let mut scanned = 0;
    let mut read_bytes = 0usize;
    let mut page_bytes = 0usize;
    let mut page_full = false;
    {
        let mut stmt = conn.prepare(
            "SELECT * FROM memories
            WHERE status = 'active' AND scope IN (SELECT value FROM json_each(?1))
            ORDER BY (pinned <> 0) DESC, importance DESC, updated_at DESC, id ASC",
        )?;
        let scope_json = serde_json::to_string(&query.scopes)
            .map_err(|error| CommandError::internal(error.to_string()))?;
        let mut rows = stmt.query(params![scope_json])?;
        while let Some(row) = rows.next()? {
            scanned += 1;
            if scanned > 10000 {
                return Err(CommandError::new(
                    "memory/input-budget-exceeded",
                    "Memory scan exceeds its row budget",
                ));
            }
            let memory = bounded_memory_row(row)?;
            let size = serde_json::to_vec(&memory)?.len();
            read_bytes = read_bytes.saturating_add(size);
            if read_bytes > 8 * 1024 * 1024 {
                return Err(CommandError::new(
                    "memory/input-budget-exceeded",
                    "Memory scan exceeds its byte budget",
                ));
            }
            if !terms.is_empty() {
                let content = memory.content.to_lowercase();
                if !terms.iter().any(|term| content.contains(term)) {
                    continue;
                }
            }
            hash_value(&mut hash, &memory)?;
            if total >= query.offset && items.len() < query.limit && !page_full {
                if page_bytes + size > 1024 * 1024 {
                    page_full = true;
                } else {
                    page_bytes += size;
                    items.push(memory);
                }
            }
            total += 1;
        }
    }
    let revision = format!("mpg2:{:x}", hash.finalize());
    if query.expected.is_some_and(|expected| expected != revision) {
        return Err(CommandError::new(
            "memory/conflict",
            "Memory results changed; restart pagination",
        ));
    }
    if query.offset > total {
        return Err(invalid());
    }
    let end = query.offset + items.len();
    Ok(MemoryPage {
        items,
        offset: query.offset,
        next_offset: (end < total).then_some(end),
        total,
        revision,
    })
}

#[tauri::command]
pub async fn memories_page(
    query: Value,
    app: tauri::AppHandle,
) -> Result<MemoryPage, CommandError> {
    super::blocking("memories_page", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        memory_page_inner(&mut conn, &query)
    })
    .await
}

#[cfg(test)]
#[path = "memory_page_tests.rs"]
mod tests;
