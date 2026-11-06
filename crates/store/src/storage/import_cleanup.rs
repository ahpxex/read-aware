//! Device-local intent recorded before an import writes its first blob.
//! Recovery only considers previous processes; the current process may still
//! be copying bytes while startup recovery finishes replaying remote events.
use super::{
    events::projections_stale_conn, library_cleanup::release_book_files_inner, DataDir, Db,
};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub struct ImportSession(pub String);
impl Default for ImportSession {
    fn default() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}

fn paths(dir: &Path, id: &str) -> Vec<PathBuf> {
    [format!("bookfile:{id}"), format!("cover:{id}")]
        .into_iter()
        .flat_map(|key| {
            let name = super::blob_file_name(&key);
            [
                dir.join("blobs").join(&name),
                dir.join("blobs").join(format!("{name}.tmp")),
            ]
        })
        .collect()
}

fn begin_inner(conn: &Connection, dir: &Path, id: &str, owner: &str) -> Result<(), CommandError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(CommandError::new(
            "library/invalid-query",
            "Import ID must be a fresh UUID",
        ));
    }
    let occupied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)
        OR EXISTS(SELECT 1 FROM book_aliases WHERE merged_id=?1 OR keep_id=?1)
        OR EXISTS(SELECT 1 FROM blob_objects WHERE key IN ('bookfile:'||?1,'cover:'||?1))",
        [id],
        |row| row.get(0),
    )?;
    if occupied {
        return Err(CommandError::new(
            "library/book-reappeared",
            "Import ID already owns data",
        ));
    }
    for path in paths(dir, id) {
        match std::fs::symlink_metadata(path) {
            Ok(_) => {
                return Err(CommandError::new(
                    "library/book-reappeared",
                    "Import ID already has files",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    conn.execute(
        "INSERT INTO book_import_cleanup(book_id,owner) VALUES (?1,?2)",
        params![id, owner],
    )?;
    Ok(())
}

fn finish_inner(
    conn: &mut Connection,
    dir: &Path,
    id: &str,
    owner: &str,
) -> Result<(), CommandError> {
    let owned: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM book_import_cleanup WHERE book_id=?1 AND owner=?2)",
        params![id, owner],
        |row| row.get(0),
    )?;
    if !owned {
        return Ok(());
    }
    if projections_stale_conn(conn)? {
        return Err(CommandError::new(
            "library/cleanup-stale",
            "Import cleanup requires current projections",
        ));
    }
    let present: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
        [id],
        |row| row.get(0),
    )?;
    if !present {
        release_book_files_inner(conn, dir, &[id.to_owned()])?;
        // A crash can precede registration, leaving the copied file or its
        // .tmp without a blob row. The prior intent owns these exact paths.
        for path in paths(dir, id) {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    // Retain the intent across any file/metadata failure. Repeating an already
    // successful release after a crash is harmless.
    conn.execute(
        "DELETE FROM book_import_cleanup WHERE book_id=?1 AND owner=?2",
        params![id, owner],
    )?;
    Ok(())
}

pub fn recover_import_cleanup(
    db: &Db,
    dir: &Path,
    current_owner: &str,
) -> Result<(), CommandError> {
    let mut after = String::new();
    loop {
        let rows = {
            let conn = db.0.lock()?;
            let mut query = conn.prepare("SELECT book_id,owner FROM book_import_cleanup WHERE owner<>?1 AND book_id>?2 ORDER BY book_id LIMIT 100")?;
            let rows = query
                .query_map(params![current_owner, after], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if rows.is_empty() {
            return Ok(());
        }
        for (id, owner) in rows {
            after = id.clone();
            let mut conn = db.0.lock()?;
            if let Err(error) = finish_inner(&mut conn, dir, &id, &owner) {
                log::warn!("Interrupted import cleanup remains pending: {error}");
            }
        }
    }
}

#[tauri::command]
pub async fn library_begin_import(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<(), CommandError> {
    super::blocking("library_begin_import", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        begin_inner(
            &conn,
            &app.state::<DataDir>().0,
            &book_id,
            &app.state::<ImportSession>().0,
        )
    })
    .await
}

#[tauri::command]
pub async fn library_finish_import(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<(), CommandError> {
    super::blocking("library_finish_import", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        finish_inner(
            &mut conn,
            &app.state::<DataDir>().0,
            &book_id,
            &app.state::<ImportSession>().0,
        )
    })
    .await
}

#[cfg(test)]
#[path = "import_cleanup_tests.rs"]
mod tests;
