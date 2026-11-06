//! Disposable web illustrations: app cache only. No SQLite, blob store, event,
//! backup or sync registration. Keys are URL hashes, never caller-provided paths.
use crate::error::CommandError;
use crate::tauri_error::tauri_error;
use std::{
    io::Write,
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::Manager;

const MAX_IMAGE: u64 = 4 * 1024 * 1024;
const MAX_TOTAL: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 512;
const LIFETIME: Duration = Duration::from_secs(30 * 24 * 60 * 60);
// Versioned file format: one MIME index byte, then original image bytes.
const MIMES: [&str; 5] = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
];
static LOCK: Mutex<()> = Mutex::new(());

fn valid_key(key: &str) -> Result<(), CommandError> {
    if key.len() != 64
        || !key
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(CommandError::new(
            "search/invalid-input",
            "Invalid image cache key",
        ));
    }
    Ok(())
}
fn get(root: &Path, key: &str) -> Result<Vec<u8>, CommandError> {
    valid_key(key)?;
    let path = root.join(format!("{key}.v1"));
    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    if meta.len() <= 1
        || meta.len() > MAX_IMAGE + 1
        || meta.modified()?.elapsed().unwrap_or_default() > LIFETIME
    {
        std::fs::remove_file(path)?;
        return Ok(vec![]);
    }
    let bytes = std::fs::read(&path)?;
    if bytes
        .first()
        .is_none_or(|value| *value as usize >= MIMES.len())
    {
        std::fs::remove_file(path)?;
        return Ok(vec![]);
    }
    Ok(bytes)
}
fn prune(
    root: &Path,
    now: SystemTime,
    max_total: u64,
    max_entries: usize,
) -> Result<(), CommandError> {
    let mut entries = vec![];
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() || entry.path().extension().is_none_or(|e| e != "v1") {
            continue;
        }
        let meta = entry.metadata()?;
        let modified = meta.modified()?;
        if now.duration_since(modified).unwrap_or_default() > LIFETIME {
            std::fs::remove_file(entry.path())?;
        } else {
            entries.push((modified, meta.len(), entry.path()));
        }
    }
    entries.sort_by_key(|entry| entry.0);
    let mut total: u64 = entries.iter().map(|entry| entry.1).sum();
    let mut count = entries.len();
    for (_, size, path) in entries {
        if total <= max_total && count <= max_entries {
            break;
        }
        std::fs::remove_file(path)?;
        total -= size;
        count -= 1;
    }
    Ok(())
}
fn put(root: &Path, key: &str, mime: &str, bytes: &[u8]) -> Result<(), CommandError> {
    valid_key(key)?;
    let index = MIMES
        .iter()
        .position(|value| *value == mime)
        .ok_or_else(|| CommandError::new("search/invalid-input", "Unsupported image MIME"))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE {
        return Err(CommandError::new(
            "search/too-large",
            "Invalid image cache size",
        ));
    }
    std::fs::create_dir_all(root)?;
    let mut temporary = tempfile::NamedTempFile::new_in(root)?;
    temporary.write_all(&[index as u8])?;
    temporary.write_all(bytes)?;
    temporary
        .persist(root.join(format!("{key}.v1")))
        .map_err(|error| CommandError::from(error.error))?;
    prune(root, SystemTime::now(), MAX_TOTAL, MAX_ENTRIES)
}
#[tauri::command]
pub async fn web_image_cache_get(
    app: tauri::AppHandle,
    key: String,
) -> Result<tauri::ipc::Response, CommandError> {
    crate::storage::blocking("web_image_cache_get", move || {
        let _guard = LOCK.lock()?;
        get(
            &app.path()
                .app_cache_dir()
                .map_err(tauri_error)?
                .join("web-images"),
            &key,
        )
        .map(tauri::ipc::Response::new)
    })
    .await
}
#[tauri::command]
pub async fn web_image_cache_put(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), CommandError> {
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| {
                CommandError::new("search/invalid-input", "Missing image cache metadata")
            })
    };
    let key = header("x-image-key")?;
    let mime = header("x-image-mime")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() as u64 <= MAX_IMAGE => bytes.clone(),
        _ => {
            return Err(CommandError::new(
                "search/too-large",
                "Invalid image cache body",
            ))
        }
    };
    crate::storage::blocking("web_image_cache_put", move || {
        let _guard = LOCK.lock()?;
        put(
            &app.path()
                .app_cache_dir()
                .map_err(tauri_error)?
                .join("web-images"),
            &key,
            &mime,
            &bytes,
        )
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_survives_reopen_and_rejects_paths_or_unsupported_content() {
        let root = tempfile::tempdir().unwrap();
        let key = "a".repeat(64);
        assert!(get(root.path(), &key).unwrap().is_empty());
        put(root.path(), &key, "image/png", b"pixels").unwrap();
        assert_eq!(
            get(root.path(), &key).unwrap(),
            [vec![1], b"pixels".to_vec()].concat()
        );
        assert!(put(root.path(), "../outside", "image/png", b"pixels").is_err());
        assert!(put(root.path(), &key, "image/svg+xml", b"active").is_err());
        assert!(put(
            root.path(),
            &key,
            "image/png",
            &vec![0; MAX_IMAGE as usize + 1]
        )
        .is_err());
        std::fs::write(root.path().join(format!("{key}.v1")), [99, 1]).unwrap();
        assert!(get(root.path(), &key).unwrap().is_empty());
    }
    #[test]
    fn cache_enforces_age_bytes_and_entry_limits_without_touching_other_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("unrelated"), b"keep").unwrap();
        for c in ["a", "b", "c"] {
            put(root.path(), &c.repeat(64), "image/png", &[0; 10]).unwrap();
        }
        prune(root.path(), SystemTime::now(), 22, 2).unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 3);
        prune(
            root.path(),
            SystemTime::now() + LIFETIME + Duration::from_secs(1),
            MAX_TOTAL,
            MAX_ENTRIES,
        )
        .unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
