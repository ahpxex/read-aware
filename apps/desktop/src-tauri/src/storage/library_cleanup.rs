use super::{blobs::delete_blob_inner, events::projections_stale_conn, DataDir, Db};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRemovalCleanup {
    pub book_id: String,
    pub title: String,
    pub removed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRemovalCleanupPage {
    pub items: Vec<BookRemovalCleanup>,
    pub next_cursor: Option<String>,
}

fn require_current_projections(conn: &Connection) -> Result<(), CommandError> {
    if projections_stale_conn(conn)? {
        return Err(CommandError::new("library/cleanup-stale", "Wait for projection recovery before releasing book files"));
    }
    Ok(())
}

pub(crate) fn list_removal_cleanup_inner(conn: &Connection, after: Option<&str>, limit: i64) -> Result<BookRemovalCleanupPage, CommandError> {
    if !(1..=100).contains(&limit) || after.is_some_and(|id| id.trim().is_empty() || id.encode_utf16().count() > 256) {
        return Err(CommandError::new("library/invalid-cleanup-query", "Expected limit 1-100 and an optional book ID cursor"));
    }
    require_current_projections(conn)?;
    let mut stmt = conn.prepare(
        "SELECT c.book_id, c.title, c.removed_at FROM book_removal_cleanup c
         WHERE (?1 IS NULL OR c.book_id > ?1)
           AND NOT EXISTS(SELECT 1 FROM books b WHERE b.id=c.book_id)
         ORDER BY c.book_id LIMIT ?2"
    )?;
    let mut items = stmt.query_map(params![after, limit + 1], |row| Ok(BookRemovalCleanup {
        book_id: row.get(0)?, title: row.get(1)?, removed_at: row.get(2)?,
    }))?.collect::<Result<Vec<_>, _>>()?;
    let next_cursor = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| item.book_id.clone())
    } else { None };
    Ok(BookRemovalCleanupPage { items, next_cursor })
}

pub(crate) fn release_book_files_inner(conn: &mut Connection, data_dir: &Path, ids: &[String]) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    require_current_projections(&tx)?;
    for id in ids {
        let present: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)", [id], |row| row.get(0))?;
        if present {
            return Err(CommandError::new("library/book-reappeared", "Refusing to release files belonging to a current book"));
        }
        let live_alias: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM book_aliases a JOIN books b ON b.id=a.keep_id WHERE a.merged_id=?1)", [id], |row| row.get(0))?;
        if live_alias {
            return Err(CommandError::new("library/cleanup-stale", "Merged assets remain pinned while their keeper exists"));
        }
    }
    // Files are not transactional. Keep every intent until both blob metadata
    // updates and intent deletion commit; retry tolerates already absent bytes.
    for id in ids {
        delete_blob_inner(&tx, data_dir, &format!("bookfile:{id}"))?;
        delete_blob_inner(&tx, data_dir, &crate::covers::cover_blob_key(id))?;
        tx.execute("DELETE FROM book_removal_cleanup WHERE book_id=?1", [id])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub async fn library_list_removal_cleanup(
    after: Option<String>,
    limit: i64,
    app: tauri::AppHandle,
) -> Result<BookRemovalCleanupPage, CommandError> {
    crate::storage::blocking("library_list_removal_cleanup", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        list_removal_cleanup_inner(&conn, after.as_deref(), limit)
    })
    .await
}

#[tauri::command]
pub async fn library_release_book_files(
    ids: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("library_release_book_files", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let mut conn = db.0.lock()?;
        release_book_files_inner(&mut conn, &data_dir.0, &ids)
    })
    .await
}

/// One pass at boot. Failures stay durable, but do not starve later entries.
pub fn recover_book_removal_cleanup(db: &Db, data_dir: &Path) -> Result<(), CommandError> {
    let mut cursor: Option<String> = None;
    loop {
        let page = {
            let conn = db.0.lock()?;
            list_removal_cleanup_inner(&conn, cursor.as_deref(), 100)?
        };
        for item in page.items {
            let mut conn = db.0.lock()?;
            if let Err(error) = release_book_files_inner(&mut conn, data_dir, &[item.book_id]) {
                log::warn!("book file cleanup remains pending: {error}");
            }
        }
        cursor = page.next_cursor;
        if cursor.is_none() { return Ok(()); }
    }
}

#[cfg(test)]
#[path = "library_cleanup_tests.rs"]
mod tests;
