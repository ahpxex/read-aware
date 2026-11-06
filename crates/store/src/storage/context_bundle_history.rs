//! Scoped metadata pagination and pinned artifact reads, not actor grants.
use super::{
    context_bundle::{self, Scope},
    events, Db,
};
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryQuery {
    kind: String,
    scope: Scope,
    offset: Option<u64>,
    limit: Option<u64>,
    expected_revision: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadQuery {
    kind: String,
    scope: Scope,
    version: String,
}
fn invalid() -> CommandError {
    CommandError::new("memory/invalid-query", "Invalid context bundle query")
}
fn corrupt() -> CommandError {
    CommandError::new("db/error", "Invalid stored context bundle")
}
fn token(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
fn selector(kind: &str, scope: &Scope) -> Result<(), CommandError> {
    if !context_bundle::valid_selector(kind, scope) {
        return Err(invalid());
    }
    Ok(())
}
fn fresh(conn: &Connection) -> Result<(), CommandError> {
    if events::projections_stale_conn(conn)? {
        return Err(CommandError::new(
            "memory/conflict",
            "Context history is awaiting projection replay",
        ));
    }
    Ok(())
}

pub(crate) fn context_bundle_history_inner(
    conn: &mut Connection,
    input: Value,
) -> Result<Value, CommandError> {
    if ["offset", "limit", "expectedRevision"]
        .iter()
        .any(|key| input.get(key).is_some_and(Value::is_null))
    {
        return Err(invalid());
    }
    let query: HistoryQuery = serde_json::from_value(input).map_err(|_| invalid())?;
    selector(&query.kind, &query.scope)?;
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(20);
    if offset > MAX_SAFE_INTEGER
        || !(1..=100).contains(&limit)
        || offset > 0 && query.expected_revision.is_none()
        || query
            .expected_revision
            .as_ref()
            .is_some_and(|value| !token(value, "cbhist1:"))
    {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    fresh(&tx)?;
    let (scope, scope_id) = query.scope.parts();
    let mut hash = Sha256::new();
    // JSON-framed lines are unambiguous (embedded newlines are escaped). Stream
    // all metadata into the hash, but retain only the requested page in memory.
    hash.update(serde_json::to_vec(&(
        "context-bundle-history",
        1,
        &query.kind,
        scope,
        scope_id,
    ))?);
    hash.update(b"\n");
    let mut total = 0_u64;
    let mut items = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT version,created_at FROM context_bundles
            WHERE kind=?1 AND scope_kind=?2 AND scope_id IS ?3 ORDER BY created_at COLLATE BINARY DESC,version COLLATE BINARY DESC")?;
        let mut rows = stmt.query(params![query.kind, scope, scope_id])?;
        while let Some(row) = rows.next()? {
            let version: String = row.get(0)?;
            let published_at: String = row.get(1)?;
            if !token(&version, "cb1:")
                || published_at.is_empty()
                || published_at.encode_utf16().count() > 64
                || published_at.contains('\0')
            {
                return Err(corrupt());
            }
            hash.update(serde_json::to_vec(&(&version, &published_at))?);
            hash.update(b"\n");
            if total >= offset && (items.len() as u64) < limit {
                items.push(json!({"version":version,"publishedAt":published_at}));
            }
            total += 1;
            if total > MAX_SAFE_INTEGER {
                return Err(corrupt());
            }
        }
    }
    let revision = format!("cbhist1:{:x}", hash.finalize());
    if query
        .expected_revision
        .as_ref()
        .is_some_and(|expected| *expected != revision)
    {
        return Err(CommandError::new(
            "memory/conflict",
            "Context history changed; restart pagination",
        ));
    }
    if offset > total {
        return Err(invalid());
    }
    let end = offset + items.len() as u64;
    let result = json!({"selector":{"kind":query.kind,"scope":query.scope}, "items":items, "offset":offset,
        "total":total, "nextOffset":if end < total { Some(end) } else { None }, "revision":revision});
    tx.commit()?;
    Ok(result)
}

pub(crate) fn context_bundle_read_inner(
    conn: &mut Connection,
    input: Value,
) -> Result<Value, CommandError> {
    let query: ReadQuery = serde_json::from_value(input).map_err(|_| invalid())?;
    selector(&query.kind, &query.scope)?;
    if !token(&query.version, "cb1:") {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    fresh(&tx)?;
    let (scope, scope_id) = query.scope.parts();
    let raw: Option<String> = tx
        .query_row(
            "SELECT content_json FROM context_bundles
        WHERE version=?1 AND kind=?2 AND scope_kind=?3 AND scope_id IS ?4",
            params![query.version, query.kind, scope, scope_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        tx.commit()?;
        return Ok(Value::Null);
    };
    let content: Value = serde_json::from_str(&raw).map_err(|_| corrupt())?;
    let value = json!({"version":query.version,"content":content});
    let bundle = context_bundle::validate(&value).map_err(|_| corrupt())?;
    if bundle.content.kind != query.kind || bundle.content.scope.parts() != (scope, scope_id) {
        return Err(corrupt());
    }
    {
        let mut stmt = tx.prepare("SELECT rank,source_kind,source_id,source_revision FROM context_bundle_items WHERE bundle_version=?1 ORDER BY rank")?;
        let mut rows = stmt.query([&query.version])?;
        for (rank, item) in bundle.content.items.iter().enumerate() {
            let row = rows.next()?.ok_or_else(corrupt)?;
            if row.get::<_, i64>(0)? != rank as i64
                || row.get::<_, String>(1)? != item.kind
                || row.get::<_, String>(2)? != item.id
                || row.get::<_, String>(3)? != item.revision
            {
                return Err(corrupt());
            }
        }
        if rows.next()?.is_some() {
            return Err(corrupt());
        }
    }
    tx.commit()?;
    Ok(value)
}

#[tauri::command]
pub async fn context_bundle_history(
    app: tauri::AppHandle,
    query: Value,
) -> Result<Value, CommandError> {
    super::blocking("context_bundle_history", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_history_inner(&mut conn, query)
    })
    .await
}
#[tauri::command]
pub async fn context_bundle_read(
    app: tauri::AppHandle,
    query: Value,
) -> Result<Value, CommandError> {
    super::blocking("context_bundle_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_read_inner(&mut conn, query)
    })
    .await
}
