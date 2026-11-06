//! Device-local intent recorded before an import writes its first blob.
//! Each intent names the process that recorded it (its presence lock id).
//! Recovery reclaims only intents whose process has exited: the app and the
//! CLI may both be importing into the same library, and the current process
//! may still be copying bytes while startup recovery runs.
use super::{
    events::projections_stale_conn, library_cleanup::release_book_files_inner, process_alive, Db,
    ProcessPresence,
};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// This process's identity on the import intents it records: its presence
/// lock, held until the process exits.
pub struct ImportSession(ProcessPresence);
impl ImportSession {
    pub fn claim(dir: &Path) -> Result<Self, CommandError> {
        Ok(Self(ProcessPresence::claim(dir)?))
    }
    pub fn owner(&self) -> &str {
        &self.0.id
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

pub fn begin_inner(
    conn: &Connection,
    dir: &Path,
    id: &str,
    owner: &str,
) -> Result<(), CommandError> {
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

pub fn finish_inner(
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

/// Release every intent whose recording process has exited. Intents of live
/// processes, this one included, are left to their owners.
pub fn recover_import_cleanup(db: &Db, dir: &Path) -> Result<(), CommandError> {
    let mut alive: HashMap<String, bool> = HashMap::new();
    let mut after = String::new();
    loop {
        let rows = {
            let conn = db.0.lock()?;
            let mut query = conn.prepare(
                "SELECT book_id,owner FROM book_import_cleanup WHERE book_id>?1 ORDER BY book_id LIMIT 100",
            )?;
            let rows = query
                .query_map(params![after], |row| {
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
            let live = match alive.get(&owner) {
                Some(live) => *live,
                None => {
                    let live = process_alive(dir, &owner)?;
                    alive.insert(owner.clone(), live);
                    live
                }
            };
            if live {
                continue;
            }
            let mut conn = db.0.lock()?;
            if let Err(error) = finish_inner(&mut conn, dir, &id, &owner) {
                log::warn!("Interrupted import cleanup remains pending: {error}");
            }
        }
    }
}

#[cfg(test)]
#[path = "import_cleanup_tests.rs"]
mod tests;
