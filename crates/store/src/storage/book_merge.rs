use super::{
    blobs::{copy_blob_file, get_blob_record_inner, register_blob_inner},
    events::{commit_events_in_transaction, projections_stale_conn},
    DataDir, Db, EventRow,
};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Manager;

fn invalid() -> CommandError {
    CommandError::new("ui/invalid-target", "Invalid duplicate book operation")
}
fn conflict() -> CommandError {
    CommandError::new("ui/superseded", "Duplicate books changed; preview again")
}
fn validate(id: &str) -> Result<(), CommandError> {
    if id.trim().is_empty() || id.encode_utf16().count() > 256 {
        return Err(invalid());
    }
    Ok(())
}
fn current(conn: &Connection) -> Result<(), CommandError> {
    if projections_stale_conn(conn)? {
        return Err(conflict());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeMember {
    pub id: String,
    pub title: String,
    pub author: String,
    pub created_at: String,
}
#[derive(Debug, Serialize)]
pub struct MergePreview {
    pub revision: String,
    pub keep: MergeMember,
    pub merged: Vec<MergeMember>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    book_id: String,
    title: String,
    count: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePage {
    groups: Vec<DuplicateGroup>,
    total: usize,
    next_offset: Option<usize>,
}
#[derive(Debug, Serialize)]
pub struct BookRedirect {
    pub from: String,
    pub to: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReceipt {
    committed: bool,
    keep_id: String,
    redirects: Vec<BookRedirect>,
}

pub(crate) fn merge_preview(
    conn: &Connection,
    id: &str,
) -> Result<Option<MergePreview>, CommandError> {
    validate(id)?;
    current(conn)?;
    let source: Option<Option<String>> = conn.query_row(
        "SELECT bo.sha256 FROM books b LEFT JOIN blob_objects bo ON bo.key='bookfile:'||b.id AND bo.deleted_at IS NULL WHERE b.id=?1", [id], |row| row.get(0),
    ).optional()?;
    let Some(source) = source else {
        return Err(CommandError::new("reader/book-not-found", "Book not found"));
    };
    let Some(source) = source.filter(|sha| !sha.is_empty()) else {
        return Ok(None);
    };
    let mut stmt = conn.prepare("SELECT b.id,b.title,b.author,b.created_at FROM books b JOIN blob_objects bo ON bo.key='bookfile:'||b.id
        WHERE bo.sha256=?1 AND bo.deleted_at IS NULL ORDER BY b.created_at,b.id LIMIT 1002")?;
    let mut members = stmt
        .query_map([&source], |row| {
            Ok(MergeMember {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if members.len() < 2 {
        return Ok(None);
    }
    if members.len() > 1001 {
        return Err(CommandError::new(
            "ui/unavailable",
            "At most 1000 duplicate records can be merged at once",
        ));
    }
    // Include the latest identity event to reject remove/reimport ABA even when titles match.
    let mut identities = Vec::new();
    for member in &members {
        let event: Option<String> = conn
            .query_row(
                "SELECT id FROM domain_events WHERE aggregate_type='book' AND aggregate_id=?1
            AND type IN ('book.imported','book.removed','book.merged') ORDER BY rowid DESC LIMIT 1",
                [&member.id],
                |row| row.get(0),
            )
            .optional()?;
        identities.push(event);
    }
    let revision = format!(
        "bmg1:{:x}",
        Sha256::digest(serde_json::to_vec(&(&source, &members, identities))?)
    );
    let keep = members.remove(0);
    Ok(Some(MergePreview {
        revision,
        keep,
        merged: members,
    }))
}

fn duplicate_page(
    conn: &Connection,
    offset: usize,
    limit: usize,
) -> Result<DuplicatePage, CommandError> {
    current(conn)?;
    if !(1..=50).contains(&limit) || offset > 1_000_000 {
        return Err(invalid());
    }
    let mut stmt = conn.prepare(
        "WITH ranked AS (
        SELECT b.id,b.title,COUNT(*) OVER (PARTITION BY bo.sha256) AS n,
        ROW_NUMBER() OVER (PARTITION BY bo.sha256 ORDER BY b.created_at,b.id) AS rank
        FROM books b JOIN blob_objects bo ON bo.key='bookfile:'||b.id
        WHERE bo.sha256 IS NOT NULL AND bo.sha256!='' AND bo.deleted_at IS NULL)
        SELECT id,title,n FROM ranked WHERE n>1 AND rank=1 ORDER BY id",
    )?;
    let all = stmt
        .query_map([], |row| {
            Ok(DuplicateGroup {
                book_id: row.get(0)?,
                title: row.get(1)?,
                count: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let total = all.len();
    let groups = all.into_iter().skip(offset).take(limit).collect();
    Ok(DuplicatePage {
        groups,
        total,
        next_offset: (offset + limit < total).then_some(offset + limit),
    })
}

pub(crate) fn merge_commit(
    conn: &mut Connection,
    data_dir: &Path,
    id: &str,
    revision: &str,
    events: &[EventRow],
) -> Result<MergeReceipt, CommandError> {
    validate(id)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let preview = merge_preview(&tx, id)?.ok_or_else(conflict)?;
    if revision != preview.revision || events.len() != preview.merged.len() {
        return Err(conflict());
    }
    for (event, member) in events.iter().zip(&preview.merged) {
        let payload = event.payload.as_object().ok_or_else(invalid)?;
        if event.id.is_empty()
            || event.event_type != "book.merged"
            || payload.len() != 2
            || payload.get("keepId").and_then(|v| v.as_str()) != Some(preview.keep.id.as_str())
            || payload.get("mergedId").and_then(|v| v.as_str()) != Some(member.id.as_str())
            || event.aggregate_type.as_deref() != Some("book")
            || event.aggregate_id.as_deref() != Some(preview.keep.id.as_str())
        {
            return Err(invalid());
        }
    }
    // Retain a local original at the keeper before retiring any duplicate record.
    let keeper_key = format!("bookfile:{}", preview.keep.id);
    if get_blob_record_inner(&tx, data_dir, &keeper_key)?.is_none() {
        for member in &preview.merged {
            if let Some((path, info)) =
                get_blob_record_inner(&tx, data_dir, &format!("bookfile:{}", member.id))?
            {
                let (size, filename) = copy_blob_file(data_dir, &keeper_key, &path)?;
                register_blob_inner(
                    &tx,
                    &keeper_key,
                    info.mime_type.as_deref(),
                    size,
                    info.sha256.ok_or_else(invalid)?,
                    filename,
                )?;
                break;
            }
        }
    }
    let report = commit_events_in_transaction(&tx, events)?;
    if report.appended != events.len() || report.applied != events.len() {
        return Err(conflict());
    }
    let mut redirects = Vec::new();
    for member in &preview.merged {
        let keeper: Option<String> = tx.query_row("SELECT a.keep_id FROM book_aliases a JOIN books b ON b.id=a.keep_id WHERE a.merged_id=?1", [&member.id], |row| row.get(0)).optional()?;
        if keeper.as_deref() != Some(preview.keep.id.as_str()) {
            return Err(conflict());
        }
        redirects.push(BookRedirect {
            from: member.id.clone(),
            to: preview.keep.id.clone(),
        });
    }
    tx.commit()?;
    Ok(MergeReceipt {
        committed: true,
        keep_id: preview.keep.id,
        redirects,
    })
}

#[tauri::command]
pub async fn library_merge_preview(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<MergePreview>, CommandError> {
    super::blocking("library_merge_preview", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let result = merge_preview(&tx, &book_id)?;
        tx.commit()?;
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn library_duplicate_groups(
    app: tauri::AppHandle,
    offset: usize,
    limit: usize,
) -> Result<DuplicatePage, CommandError> {
    super::blocking("library_duplicate_groups", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        duplicate_page(&conn, offset, limit)
    })
    .await
}
#[tauri::command]
pub async fn library_resolve_book(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<String>, CommandError> {
    super::blocking("library_resolve_book", move || { validate(&book_id)?; let db = app.state::<Db>(); let conn = db.0.lock()?; current(&conn)?;
        conn.query_row("SELECT id FROM books WHERE id=?1 UNION ALL SELECT a.keep_id FROM book_aliases a JOIN books b ON b.id=a.keep_id WHERE a.merged_id=?1 LIMIT 1",
            [&book_id], |row| row.get(0)).optional().map_err(Into::into) }).await
}
#[tauri::command]
pub async fn library_merge_commit(
    app: tauri::AppHandle,
    book_id: String,
    expected_revision: String,
    events: Vec<EventRow>,
) -> Result<MergeReceipt, CommandError> {
    super::blocking("library_merge_commit", move || {
        let db = app.state::<Db>();
        let data = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        merge_commit(&mut conn, &data.0, &book_id, &expected_revision, &events)
    })
    .await
}

#[cfg(test)]
#[path = "book_merge_tests.rs"]
mod tests;
