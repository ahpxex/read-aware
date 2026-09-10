//! Ephemeral, unsynced resource snapshots. Only the trusted host calls these
//! commands; Workers receive owner-scoped public references, never paths/IDs.
use crate::error::CommandError;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

const MAX_FILE: u64 = 1024 * 1024 * 1024;
const MAX_TOTAL: u64 = 2 * MAX_FILE;
const MAX_CHUNK: usize = 1024 * 1024;
const MAX_HANDLES: usize = 64;
const LIFETIME: Duration = Duration::from_secs(3600);

struct Entry {
    file: File,
    size: u64,
    ready: bool,
    created: Instant,
}
#[derive(Default)]
pub struct ResourceFiles(Mutex<HashMap<String, Entry>>);
#[derive(Serialize)]
pub struct ResourceInfo {
    id: String,
    size: u64,
}

fn invalid(message: &str) -> CommandError {
    CommandError::new("ui/invalid-target", message)
}
fn missing() -> CommandError {
    CommandError::new("fs/not-found", "Resource expired or released")
}

/// A sealed file lease for native consumers; expiry/release cannot invalidate the cloned descriptor.
pub(crate) fn reader(app: &tauri::AppHandle, id: &str) -> Result<File, CommandError> {
    let resources = app.state::<ResourceFiles>();
    let mut entries = resources.0.lock()?;
    lease(&mut entries, id)
}

fn lease(entries: &mut HashMap<String, Entry>, id: &str) -> Result<File, CommandError> {
    prune(entries);
    let entry = entries.get_mut(id).ok_or_else(missing)?;
    if !entry.ready { return Err(invalid("Seal the resource before importing")); }
    entry.file.seek(SeekFrom::Start(0))?;
    Ok(entry.file.try_clone()?)
}
fn quota() -> CommandError {
    CommandError::new("ui/unavailable", "Temporary resource quota exceeded")
}

fn prune(entries: &mut HashMap<String, Entry>) {
    entries.retain(|_, entry| entry.created.elapsed() < LIFETIME);
}
fn used(entries: &HashMap<String, Entry>) -> u64 {
    entries.values().map(|entry| entry.size).sum()
}
fn insert(
    entries: &mut HashMap<String, Entry>,
    source: Option<File>,
) -> Result<ResourceInfo, CommandError> {
    prune(entries);
    if entries.len() >= MAX_HANDLES {
        return Err(quota());
    }
    let budget = MAX_FILE.min(MAX_TOTAL.saturating_sub(used(entries)));
    let mut file = tempfile::tempfile()?;
    let ready = source.is_some();
    let size = if let Some(source) = source {
        let metadata = source.metadata()?;
        if !metadata.is_file() {
            return Err(invalid("Resource must be a regular file"));
        }
        if metadata.len() > budget {
            return Err(quota());
        }
        let copied = std::io::copy(&mut source.take(budget + 1), &mut file)?;
        if copied > budget {
            return Err(quota());
        }
        copied
    } else {
        0
    };
    let id = uuid::Uuid::new_v4().to_string();
    entries.insert(
        id.clone(),
        Entry {
            file,
            size,
            ready,
            created: Instant::now(),
        },
    );
    Ok(ResourceInfo { id, size })
}
fn append(
    entries: &mut HashMap<String, Entry>,
    id: &str,
    offset: u64,
    bytes: &[u8],
) -> Result<u64, CommandError> {
    prune(entries);
    if bytes.len() > MAX_CHUNK {
        return Err(invalid("Resource chunk exceeds 1 MiB"));
    }
    let total = used(entries);
    let entry = entries.get_mut(id).ok_or_else(missing)?;
    if entry.ready || offset != entry.size {
        return Err(invalid("Resource is sealed or append offset changed"));
    }
    let next = entry.size + bytes.len() as u64;
    if next > MAX_FILE || total + bytes.len() as u64 > MAX_TOTAL {
        return Err(quota());
    }
    entry.file.seek(SeekFrom::Start(entry.size))?;
    if let Err(error) = entry.file.write_all(bytes) {
        // Retire a partially written file rather than promising a retryable offset.
        entries.remove(id);
        return Err(error.into());
    }
    entry.size = next;
    Ok(next)
}
fn read(
    entries: &mut HashMap<String, Entry>,
    id: &str,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, CommandError> {
    prune(entries);
    if length > MAX_CHUNK {
        return Err(invalid("Resource read exceeds 1 MiB"));
    }
    let entry = entries.get_mut(id).ok_or_else(missing)?;
    if !entry.ready || offset > entry.size {
        return Err(invalid("Resource is not sealed or range is invalid"));
    }
    let mut bytes = vec![0; (entry.size - offset).min(length as u64) as usize];
    entry.file.seek(SeekFrom::Start(offset))?;
    entry.file.read_exact(&mut bytes)?;
    Ok(bytes)
}
fn save(entries: &mut HashMap<String, Entry>, id: &str, path: &Path) -> Result<(), CommandError> {
    prune(entries);
    let entry = entries.get_mut(id).ok_or_else(missing)?;
    if !entry.ready {
        return Err(invalid("Seal the resource before exporting"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Export destination has no parent"))?;
    let mut staging = tempfile::NamedTempFile::new_in(parent)?;
    entry.file.seek(SeekFrom::Start(0))?;
    std::io::copy(&mut entry.file, staging.as_file_mut())?;
    staging.as_file().sync_all()?;
    staging
        .persist(path)
        .map_err(|error| CommandError::from(error.error))?;
    Ok(())
}

#[tauri::command]
pub async fn resource_open_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<ResourceInfo, CommandError> {
    crate::storage::blocking("resource_open_file", move || {
        if !std::fs::metadata(&path)?.is_file() {
            return Err(invalid("Resource must be a regular file"));
        }
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        insert(&mut entries, Some(File::open(path)?))
    })
    .await
}
#[tauri::command]
pub async fn resource_open_book(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<ResourceInfo>, CommandError> {
    crate::storage::blocking("resource_open_book", move || {
        let file = {
            let db = app.state::<crate::storage::Db>();
            let conn = db.0.lock()?;
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
                [&book_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(CommandError::new("fs/not-found", "Book no longer exists"));
            }
            let data = app.state::<crate::storage::DataDir>();
            let Some((path, _)) = crate::storage::get_blob_record_inner(
                &conn,
                &data.0,
                &format!("bookfile:{book_id}"),
            )?
            else {
                return Ok(None);
            };
            File::open(path)?
        };
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        insert(&mut entries, Some(file)).map(Some)
    })
    .await
}
#[tauri::command]
pub async fn resource_create(app: tauri::AppHandle) -> Result<ResourceInfo, CommandError> {
    crate::storage::blocking("resource_create", move || {
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        insert(&mut entries, None)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverResourceInfo {
    #[serde(flatten)]
    resource: ResourceInfo,
    mime_type: String,
}

#[tauri::command]
pub async fn resource_open_cover(app: tauri::AppHandle, book_id: String) -> Result<Option<CoverResourceInfo>, CommandError> {
    crate::storage::blocking("resource_open_cover", move || {
        let (file, mime_type) = {
            use rusqlite::OptionalExtension;
            let db = app.state::<crate::storage::Db>();
            let conn = db.0.lock()?;
            let cover: Option<(String, Option<String>)> = conn.query_row(
                "SELECT cover_status, cover_blob_key FROM books WHERE id=?1", [&book_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            let (status, key) = cover.ok_or_else(|| CommandError::new("reader/book-not-found", "Book no longer exists"))?;
            let Some(key) = key.filter(|_| status == "ready") else { return Ok(None); };
            let data = app.state::<crate::storage::DataDir>();
            let Some((path, info)) = crate::storage::get_blob_record_inner(&conn, &data.0, &key)? else { return Ok(None); };
            (File::open(path)?, info.mime_type.unwrap_or_else(|| "application/octet-stream".into()))
        };
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        Ok(Some(CoverResourceInfo { resource: insert(&mut entries, Some(file))?, mime_type }))
    }).await
}
#[tauri::command]
pub async fn resource_append(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<u64, CommandError> {
    let id = request
        .headers()
        .get("x-resource-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(missing)?
        .to_owned();
    let offset = request
        .headers()
        .get("x-resource-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| invalid("Missing resource offset"))?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= MAX_CHUNK => bytes.clone(),
        _ => return Err(invalid("Resource append requires a binary body")),
    };
    crate::storage::blocking("resource_append", move || {
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        append(&mut entries, &id, offset, &bytes)
    })
    .await
}
#[tauri::command]
pub async fn resource_commit(app: tauri::AppHandle, id: String) -> Result<(), CommandError> {
    crate::storage::blocking("resource_commit", move || {
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        prune(&mut entries);
        let entry = entries.get_mut(&id).ok_or_else(missing)?;
        entry.file.sync_all()?;
        entry.ready = true;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn resource_read(
    app: tauri::AppHandle,
    id: String,
    offset: u64,
    length: usize,
) -> Result<tauri::ipc::Response, CommandError> {
    crate::storage::blocking("resource_read", move || {
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        read(&mut entries, &id, offset, length).map(tauri::ipc::Response::new)
    })
    .await
}
#[tauri::command]
pub async fn resource_save(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<(), CommandError> {
    crate::storage::blocking("resource_save", move || {
        let resources = app.state::<ResourceFiles>();
        let mut entries = resources.0.lock()?;
        save(&mut entries, &id, Path::new(&path))
    })
    .await
}
#[tauri::command]
pub async fn resource_release(app: tauri::AppHandle, id: String) -> Result<(), CommandError> {
    crate::storage::blocking("resource_release", move || {
        app.state::<ResourceFiles>().0.lock()?.remove(&id);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn importing_requires_a_sealed_lease_and_keeps_it_alive_after_release() {
        let mut entries = HashMap::new();
        let info = insert(&mut entries, None).unwrap();
        append(&mut entries, &info.id, 0, b"import me").unwrap();
        assert!(lease(&mut entries, &info.id).is_err());
        entries.get_mut(&info.id).unwrap().ready = true;
        let mut file = lease(&mut entries, &info.id).unwrap();
        entries.remove(&info.id);
        let mut bytes = Vec::new(); file.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"import me");
        assert!(lease(&mut entries, &info.id).is_err());
    }
    #[test]
    fn staged_bytes_are_bounded_sealed_and_atomically_exported() {
        let mut entries = HashMap::new();
        let info = insert(&mut entries, None).unwrap();
        assert_eq!(append(&mut entries, &info.id, 0, b"hello").unwrap(), 5);
        assert!(append(&mut entries, &info.id, 0, b"again").is_err());
        assert!(read(&mut entries, &info.id, 0, 5).is_err());
        entries.get_mut(&info.id).unwrap().ready = true;
        assert_eq!(read(&mut entries, &info.id, 2, 20).unwrap(), b"llo");
        assert!(read(&mut entries, &info.id, 0, MAX_CHUNK + 1).is_err());
        assert!(append(&mut entries, &info.id, 5, b"!").is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("output.txt");
        std::fs::write(&path, "previous").unwrap();
        save(&mut entries, &info.id, &path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        assert!(save(&mut entries, &info.id, &dir.path().join("missing/output")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
    }
    #[test]
    fn selected_files_are_independent_snapshots_and_expire() {
        let mut entries = HashMap::new();
        let mut source = tempfile::NamedTempFile::new().unwrap();
        source.write_all(b"original").unwrap();
        let info = insert(&mut entries, Some(File::open(source.path()).unwrap())).unwrap();
        std::fs::write(source.path(), "changed").unwrap();
        assert_eq!(read(&mut entries, &info.id, 0, 100).unwrap(), b"original");
        entries.get_mut(&info.id).unwrap().created = Instant::now() - LIFETIME;
        assert!(read(&mut entries, &info.id, 0, 1).is_err());
        assert!(entries.is_empty());
    }
}
