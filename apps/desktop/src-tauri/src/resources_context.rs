//! Durable source admission for sealed context resources, not actor authorization.
use super::*;
use rusqlite::Connection;

pub(super) fn seal(conn: &mut Connection, entries: &mut HashMap<String, Entry>, id: &str, expected: &str) -> Result<(), CommandError> {
    prune(entries);
    let entry = entries.get_mut(id).ok_or_else(missing)?;
    if entry.ready || entry.context_revision.is_some() {
        return Err(invalid("Cannot rebind a sealed context resource"));
    }
    // JSON object field names add bounded overhead to the 1 MiB canonical tuple.
    if entry.size > 2 * MAX_CHUNK as u64 { return Err(invalid("Context resource is too large")); }
    let tx = conn.transaction()?;
    crate::storage::require_context_source_revision(&tx, expected)?;
    entry.file.seek(SeekFrom::Start(0))?;
    let mut bytes = vec![0; entry.size as usize];
    entry.file.read_exact(&mut bytes)?;
    crate::storage::validate_context_resource(&bytes)?;
    entry.file.sync_all()?;
    tx.commit()?;
    entry.context_revision = Some(expected.to_owned());
    entry.ready = true;
    Ok(())
}

fn with_revision<T>(conn: &mut Connection, revision: &str, work: impl FnOnce() -> Result<T, CommandError>) -> Result<T, CommandError> {
    let tx = conn.transaction()?;
    crate::storage::require_context_source_revision(&tx, revision)?;
    let result = work();
    // This transaction only reads. Ending it must not mask a completed external write.
    drop(tx);
    result
}

pub(super) fn admit<T>(app: &tauri::AppHandle, entries: &mut HashMap<String, Entry>, id: &str,
    work: impl FnOnce(&mut HashMap<String, Entry>) -> Result<T, CommandError>) -> Result<T, CommandError> {
    prune(entries);
    let revision = entries.get(id).ok_or_else(missing)?.context_revision.clone();
    if let Some(revision) = revision {
        let db = app.state::<crate::storage::Db>();
        let mut conn = db.0.lock()?;
        with_revision(&mut conn, &revision, || work(entries))
    } else {
        work(entries)
    }
}

#[cfg(test)]
#[path = "resources_context_tests.rs"]
mod tests;
