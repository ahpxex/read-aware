//! Book-scoped durable source data. Authorization and spoiler selection are host-owned.
use super::{user_profile, Db};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid book context source")
}

pub(crate) fn book_context_snapshot_inner(
    conn: &mut Connection,
    book_id: &str,
) -> Result<Value, CommandError> {
    if book_id.trim().is_empty() || book_id.encode_utf16().count() > 256 || book_id.contains('\0') {
        return Err(invalid());
    }
    let tx = conn.transaction()?;
    user_profile::require_initialized(&tx)?;
    let book = tx
        .query_row(
            "SELECT reading_status,narrativity,progress_json,format FROM books WHERE id=?1",
            [book_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| {
            CommandError::new("reader/book-not-found", "Context book no longer exists")
        })?;
    let progress: Value = match book.2 {
        Some(value) => serde_json::from_str(&value)?,
        None => Value::Null,
    };
    if !progress.is_null() && !progress.is_object()
        || !progress["href"].is_null() && !progress["href"].is_string()
    {
        return Err(CommandError::new(
            "db/error",
            "Invalid persisted reading position",
        ));
    }
    let scope = format!("book:{book_id}");
    // Bound the complete source set before materializing text, never return a prefix.
    let (count, bytes): (i64, i64) = tx.query_row(
        "SELECT sum(n),sum(b) FROM (
          SELECT count(*) n,coalesce(sum(length(CAST(content AS BLOB))),0) b FROM memories WHERE scope=?1 AND status='active'
          UNION ALL SELECT count(*),coalesce(sum(length(CAST(text AS BLOB))+coalesce(length(CAST(content AS BLOB)),0)),0) FROM annotations WHERE book_id=?2
          UNION ALL SELECT count(*),coalesce(sum(length(CAST(summary AS BLOB))+length(CAST(characters_json AS BLOB))+length(CAST(relations_json AS BLOB))),0) FROM chapter_digests WHERE book_id=?2)",
        rusqlite::params![scope, book_id], |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if count > 8192 || bytes > 8 * 1024 * 1024 {
        return Err(invalid());
    }
    let memories = {
        let mut stmt = tx.prepare("SELECT id,kind,content FROM memories WHERE scope=?1 AND status='active' ORDER BY id COLLATE BINARY")?;
        let rows = stmt.query_map([&scope], |r| Ok(json!({"id":r.get::<_, String>(0)?, "kind":r.get::<_, String>(1)?, "text":r.get::<_, String>(2)?})))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let annotations = {
        let mut stmt = tx.prepare("SELECT id,type,chapter_href,text,content FROM annotations WHERE book_id=?1 ORDER BY id COLLATE BINARY")?;
        let rows = stmt.query_map([book_id], |r| Ok(json!({"id":r.get::<_, String>(0)?, "kind":r.get::<_, String>(1)?,
            "href":r.get::<_, Option<String>>(2)?, "quote":r.get::<_, String>(3)?, "note":r.get::<_, Option<String>>(4)?})))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let digests = {
        let mut stmt = tx.prepare("SELECT chapter_index,chapter_href,flavor,summary,characters_json,relations_json,digest_version FROM chapter_digests WHERE book_id=?1 ORDER BY chapter_index")?;
        let rows = stmt.query_map([book_id], |r| Ok(json!({"index":r.get::<_, i64>(0)?, "href":r.get::<_, Option<String>>(1)?,
            "flavor":r.get::<_, Option<String>>(2)?, "summary":r.get::<_, String>(3)?, "characters":r.get::<_, String>(4)?,
            "relations":r.get::<_, String>(5)?, "version":r.get::<_, i64>(6)?})))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let hash = |key: String| -> Result<Option<String>, CommandError> {
        Ok(tx
            .query_row(
                "SELECT sha256 FROM blob_objects WHERE key=?1 AND deleted_at IS NULL",
                [key],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten())
    };
    let result = json!({"bookId":book_id, "readingStatus":book.0, "flavor":book.1, "href":progress["href"], "format":book.3,
        "contentHash":hash(format!("bookfile:{book_id}"))?, "textHash":hash(format!("booktext:{book_id}"))?,
        "memories":memories, "annotations":annotations, "digests":digests});
    tx.commit()?;
    Ok(result)
}

#[tauri::command]
pub async fn book_context_snapshot(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Value, CommandError> {
    super::blocking("book_context_snapshot", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        book_context_snapshot_inner(&mut conn, &book_id)
    })
    .await
}
