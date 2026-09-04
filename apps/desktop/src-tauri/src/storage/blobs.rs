//! The blob store: book files and derivatives.
//!
//! BYTES live on the filesystem under `<app_data>/blobs/`; SQLite holds only
//! the `blob_objects` registry (key, kind, sha256, size, storage_uri). Also
//! carries the staged chunked transfers mobile needs, where the IPC bridge
//! cannot move multi-megabyte payloads in one response.
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use crate::error::CommandError;
use super::*;

// --- Filesystem blob store ----------------------------------------------------
//
// Bytes live as ordinary files under `<data_dir>/blobs/`; SQLite keeps only the
// `blob_objects` registry row (kind, mime, size, sha256, storage_uri) plus the
// `blob_sync_state` outbox. Payloads still cross the IPC bridge RAW
// (`tauri::ipc::Request` / `Response`), never as JSON — a serde `Vec<u8>` would
// serialize a book file into a JSON array of numbers, which froze the webview
// main thread on large books.

/// Header carrying the blob key on raw-body `put_blob` requests (the body is
/// the payload itself, so the key can't ride in JSON args).
const BLOB_KEY_HEADER: &str = "x-blob-key";
/// Optional header carrying the payload MIME type on `put_blob` requests.
const BLOB_MIME_HEADER: &str = "x-blob-mime";

/// Map a blob key's prefix to its registry `kind` and whether it should sync
/// to the relay (font caches are re-downloadable; everything else is user data).
/// Also used by `apply`'s blob-manifest materialization, so a replayed manifest
/// row and a locally-written registry row can never disagree on kind.
pub(crate) fn blob_kind(key: &str) -> (&'static str, bool) {
    match key.split(':').next() {
        Some("bookfile") => ("book_source", true),
        Some("cover") => ("cover_image", true),
        Some("font") => ("font_face", false),
        // Extracted text cache — derivable from the book file, never synced.
        Some("booktext") => ("book_text", false),
        _ => ("unknown", true),
    }
}

/// Filesystem-safe file name for a blob key: percent-encode every byte outside
/// `[A-Za-z0-9._-]`. Injective (no two keys share a file) and reversible, so a
/// stray file in `blobs/` can always be traced back to its key.
pub(crate) fn blob_file_name(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for byte in key.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-' => out.push(byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobPutResult {
    pub sha256: String,
    pub byte_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobInfo {
    pub byte_size: u64,
    pub mime_type: Option<String>,
}

pub(crate) fn put_blob_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
    mime_type: Option<&str>,
    data: &[u8],
) -> Result<BlobPutResult, CommandError> {
    let blobs_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir)?;
    let file_name = blob_file_name(key);
    // Write-then-rename so a crash mid-write never leaves a torn blob behind
    // a committed registry row.
    let tmp_path = blobs_dir.join(format!("{file_name}.tmp"));
    let final_path = blobs_dir.join(&file_name);
    std::fs::write(&tmp_path, data)?;
    std::fs::rename(&tmp_path, &final_path)?;

    let sha256 = format!("{:x}", Sha256::digest(data));
    let byte_size = data.len() as i64;
    register_blob_inner(conn, key, mime_type, byte_size, sha256, file_name)
}

pub(crate) fn register_blob_inner(
    conn: &Connection,
    key: &str,
    mime_type: Option<&str>,
    byte_size: i64,
    sha256: String,
    file_name: String,
) -> Result<BlobPutResult, CommandError> {
    let (kind, sync_required) = blob_kind(key);
    let storage_uri = format!("blobs/{file_name}");
    conn.execute(
        "INSERT INTO blob_objects
            (key, kind, mime_type, byte_size, sha256, storage_uri, sync_required, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET
            kind = excluded.kind,
            mime_type = COALESCE(excluded.mime_type, blob_objects.mime_type),
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            storage_uri = excluded.storage_uri,
            sync_required = excluded.sync_required,
            deleted_at = NULL",
        params![
            key,
            kind,
            mime_type,
            byte_size,
            sha256,
            storage_uri,
            sync_required as i64
        ],
    )
    ?;
    if sync_required {
        // (Re)writes reset the outbox: changed content must push again.
        conn.execute(
            "INSERT INTO blob_sync_state (blob_key, updated_at)
             VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(blob_key) DO UPDATE SET
                push_state = 'pending',
                pushed_at = NULL,
                updated_at = excluded.updated_at",
            params![key],
        )
        ?;
    }
    Ok(BlobPutResult { sha256, byte_size })
}

/// Copy a file into the managed blob directory under `key` and return its
/// size plus the file name it landed as. `std::fs::copy` deliberately stays
/// intact: it uses fclonefileat/fcopyfile on macOS, copy_file_range on Linux,
/// and CopyFileEx on Windows instead of forcing every platform through a
/// userspace read/write loop. Hashing is the caller's business (the import
/// path hashes the SOURCE once, before deciding whether to copy at all).
pub(crate) fn copy_blob_file(
    data_dir: &Path,
    key: &str,
    source_path: &Path,
) -> Result<(i64, String), CommandError> {
    let blobs_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir)?;
    let file_name = blob_file_name(key);
    let tmp_path = blobs_dir.join(format!("{file_name}.tmp"));
    let final_path = blobs_dir.join(&file_name);
    let staged = std::fs::copy(source_path, &tmp_path)
        .and_then(|byte_size| std::fs::rename(&tmp_path, &final_path).map(|()| byte_size));
    match staged {
        Ok(byte_size) => Ok((byte_size as i64, file_name)),
        Err(error) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(CommandError::from(format!(
                "Failed to copy selected book {}: {error}",
                source_path.display()
            )))
        }
    }
}

pub(crate) fn get_blob_record_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
) -> Result<Option<(PathBuf, BlobInfo)>, CommandError> {
    let record: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT storage_uri, mime_type FROM blob_objects
             WHERE key = ?1 AND deleted_at IS NULL AND storage_uri IS NOT NULL",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(CommandError::from(other)),
        })?;
    let Some((storage_uri, mime_type)) = record else {
        return Ok(None);
    };

    let relative = Path::new(&storage_uri);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(CommandError::internal(format!("Invalid managed blob path for {key}")));
    }

    let path = data_dir.join(relative);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    Ok(Some((
        path,
        BlobInfo {
            byte_size: metadata.len(),
            mime_type,
        },
    )))
}

/// Empty vec means "no such blob" (the raw-response contract; no real payload
/// is zero-length). A registry row whose file went missing is treated the same.
pub(crate) fn get_blob_inner(conn: &Connection, data_dir: &Path, key: &str) -> Result<Vec<u8>, CommandError> {
    let Some((path, _)) = get_blob_record_inner(conn, data_dir, key)? else {
        return Ok(Vec::new());
    };
    Ok(std::fs::read(path)?)
}

pub(crate) fn get_blob_range_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, CommandError> {
    let Some((path, info)) = get_blob_record_inner(conn, data_dir, key)? else {
        return Ok(Vec::new());
    };
    if offset >= info.byte_size || length == 0 {
        return Ok(Vec::new());
    }

    let read_len = length.min(info.byte_size - offset);
    let capacity = usize::try_from(read_len)
        .map_err(|_| format!("Requested blob range is too large: {read_len} bytes"))?;
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(offset))
        ?;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(read_len)
        .read_to_end(&mut bytes)
        ?;
    Ok(bytes)
}

/// Remove the bytes and tombstone the registry row (`deleted_at` set,
/// `storage_uri` cleared, outbox row dropped). The tombstone keeps sync and
/// backup-restore from resurrecting a deliberately deleted file.
pub(crate) fn delete_blob_inner(conn: &Connection, data_dir: &Path, key: &str) -> Result<(), CommandError> {
    let storage_uri: Option<String> = conn
        .query_row(
            "SELECT storage_uri FROM blob_objects WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(CommandError::from(other)),
        })?;
    if let Some(uri) = storage_uri {
        match std::fs::remove_file(data_dir.join(&uri)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    conn.execute(
        "UPDATE blob_objects SET
            deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            storage_uri = NULL
         WHERE key = ?1",
        params![key],
    )
    ?;
    conn.execute(
        "DELETE FROM blob_sync_state WHERE blob_key = ?1",
        params![key],
    )
    ?;
    Ok(())
}

/// One-time data migration: move any bytes still inline in the pre-v3 `blobs`
/// table out to `<data_dir>/blobs/` files + `blob_objects` rows, then drop the
/// table. Runs on every boot but is a no-op once the table is gone. Idempotent
/// under crashes: file writes are keyed deterministically and registry rows are
/// upserts, so a re-run after a partial pass simply overwrites its own work
/// before dropping the table.
pub(crate) fn externalize_inline_blobs(conn: &Connection, data_dir: &Path) -> Result<(), CommandError> {
    let has_inline_table: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blobs')",
            [],
            |row| row.get(0),
        )
        ?;
    if !has_inline_table {
        return Ok(());
    }
    {
        let mut stmt = conn
            .prepare("SELECT key, data FROM blobs")
            ?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            ?;
        for row in rows {
            let (key, data) = row?;
            put_blob_inner(conn, data_dir, &key, None, &data)?;
        }
    }
    conn.execute_batch("DROP TABLE blobs;")
        ?;
    // The inline pages are gone but the file doesn't shrink by itself; with the
    // library's book bytes leaving the database this is the one reclaim that is
    // actually worth a VACUUM.
    conn.execute_batch("VACUUM;")?;
    Ok(())
}

/// Open (creating if needed) the app database, apply the connection PRAGMA
/// baseline (WAL et al — see `apply_connection_pragmas`), run migrations,
/// externalize any pre-v3 inline blobs, and ensure the device identity row.
/// Returns the connection plus the app-data dir the blob store roots at.
pub fn init_db(app: &AppHandle) -> Result<(Connection, PathBuf), CommandError> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let mut conn = Connection::open(dir.join("read-aware.db"))?;
    apply_connection_pragmas(&conn)?;
    register_sql_functions(&conn)?;
    // Covers moved out of the books table (v24/v25). The data-URL rows must
    // be lifted into the blob store while both column sets exist, so the
    // migrations pause at v24 for that pass and finish afterwards.
    run_migrations_up_to(&mut conn, COVER_PROJECTION_VERSION)?;
    materialize_legacy_covers(&conn, &dir)?;
    run_migrations(&mut conn)?;
    externalize_inline_blobs(&conn, &dir)?;
    ensure_local_device(&conn)?;
    Ok((conn, dir))
}

/// Lift pre-v24 inline covers (`books.cover_url` data URLs) into `cover:`
/// blobs and point `cover_status`/`cover_blob_key` at them. No-op once the
/// column is gone (v25) or no row is marked 'legacy'. A row whose cover blob
/// already exists locally (imports since coverExtracted had a producer wrote
/// both) just gets its status flipped; undecodable data URLs fall back to
/// 'unchecked' so the engine job re-extracts from the book file.
///
/// The `book.coverExtracted` events these rows lack are synthesized by the
/// boot-time genesis pass (platform/event-genesis.ts), which reads the
/// projection this pass leaves behind.
pub(crate) fn materialize_legacy_covers(conn: &Connection, data_dir: &Path) -> Result<(), CommandError> {
    let has_cover_url: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('books') WHERE name = 'cover_url')",
        [],
        |row| row.get(0),
    )?;
    if !has_cover_url {
        return Ok(());
    }
    let legacy: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, cover_url FROM books WHERE cover_status = 'legacy' AND cover_url IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if legacy.is_empty() {
        return Ok(());
    }
    let mut lifted = 0usize;
    for (book_id, data_url) in legacy {
        let key = crate::covers::cover_blob_key(&book_id);
        let already_stored = get_blob_record_inner(conn, data_dir, &key)?.is_some();
        let stored = already_stored
            || crate::covers::cover_from_data_url(&data_url)
                .as_ref()
                .and_then(crate::covers::normalize_cover)
                .map(|cover| crate::covers::store_cover(conn, data_dir, &book_id, &cover))
                .transpose()?
                .is_some();
        if stored {
            conn.execute(
                "UPDATE books SET cover_status = 'ready', cover_blob_key = ?2, cover_url = NULL
                  WHERE id = ?1",
                params![book_id, key],
            )?;
            lifted += 1;
        } else {
            conn.execute(
                "UPDATE books SET cover_status = 'unchecked', cover_url = NULL WHERE id = ?1",
                params![book_id],
            )?;
        }
    }
    log::info!("lifted {lifted} inline cover(s) into the blob store");
    Ok(())
}


// --- Blob commands (book files + derivatives) ---

#[tauri::command]
pub fn put_blob(
    request: tauri::ipc::Request<'_>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<BlobPutResult, CommandError> {
    let key = request
        .headers()
        .get(BLOB_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("put_blob: missing {BLOB_KEY_HEADER} header"))?
        .to_string();
    let mime_type = request
        .headers()
        .get(BLOB_MIME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    // Desktop delivers the payload as a true raw body. Android cannot: the
    // WebView's request interception never exposes POST bodies, so Tauri falls
    // back to JSON there and the bytes arrive as a JSON number array (the
    // official fs plugin's write_file accepts both for the same reason).
    let data: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("put_blob: unsupported JSON body: {e}"))?,
    };
    let conn = db.0.lock()?;
    put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
}

/// Returns the blob's bytes as a raw (non-JSON) IPC response. A missing key
/// yields an EMPTY body — the JS wrapper maps zero length back to `null`.
/// (A raw `Response` cannot express `Option`, and no real payload here is
/// zero-length: book files and derivatives are never empty.)
#[tauri::command]
pub fn get_blob(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<tauri::ipc::Response, CommandError> {
    let conn = db.0.lock()?;
    get_blob_inner(&conn, &data_dir.0, &key).map(tauri::ipc::Response::new)
}


/// Metadata-only lookup used to create a random-access book source in the
/// webview without first transferring the whole file.
#[tauri::command]
pub fn get_blob_info(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<Option<BlobInfo>, CommandError> {
    let conn = db.0.lock()?;
    Ok(get_blob_record_inner(&conn, &data_dir.0, &key)?.map(|(_, info)| info))
}

/// Read only one byte range from a managed blob. PDF.js drives this through
/// its range transport, so opening a large PDF no longer copies the entire
/// source file into WKWebView before the first page can render.
#[tauri::command]
pub async fn get_blob_range(
    app: AppHandle,
    key: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let conn = db.0.lock()?;
        get_blob_range_inner(&conn, &data_dir.0, &key, offset, length)
    })
    .await
    .map_err(|e| format!("get_blob_range task failed: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn delete_blob(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<(), CommandError> {
    let conn = db.0.lock()?;
    delete_blob_inner(&conn, &data_dir.0, &key)
}

// --- Staged blob transfers (mobile) ---
//
// The raw-body/raw-response fast paths above don't exist on Android: the
// WebView never exposes POST bodies (uploads fall back to a JSON number
// array — parsing tens of millions of array elements stalls for minutes on a
// whole book), and IPC responses are injected via `evaluateJavascript`, which
// chokes on multi-megabyte payloads. Mirroring the `book_read_*` commands in
// lib.rs, mobile moves blobs through small staged chunks instead: downloads
// pull raw-response slices; uploads push base64 strings (one JSON string
// parses orders of magnitude faster than the number-array fallback).

/// Blobs staged for chunked download, keyed by blob key.
#[derive(Default)]
pub struct BlobReadSessions(Mutex<std::collections::HashMap<String, Vec<u8>>>);

/// Upload buffers accumulating base64 chunks until commit, keyed by blob key.
#[derive(Default)]
pub struct BlobWriteSessions(Mutex<std::collections::HashMap<String, Vec<u8>>>);

/// Stage a blob for chunked download and return its byte length.
/// 0 = no such key (same convention as `get_blob`'s empty body).
#[tauri::command]
pub fn blob_read_open(
    key: String,
    sessions: State<'_, BlobReadSessions>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<usize, CommandError> {
    let bytes = {
        let conn = db.0.lock()?;
        get_blob_inner(&conn, &data_dir.0, &key)?
    };
    let len = bytes.len();
    if len > 0 {
        sessions
            .0
            .lock()
            ?
            .insert(key, bytes);
    }
    Ok(len)
}

/// Return one chunk of a staged blob as a raw binary response.
#[tauri::command]
pub fn blob_read_chunk(
    key: String,
    offset: usize,
    length: usize,
    sessions: State<'_, BlobReadSessions>,
) -> Result<tauri::ipc::Response, CommandError> {
    let map = sessions.0.lock()?;
    let bytes = map
        .get(&key)
        .ok_or_else(|| format!("blob_read_chunk: no open session for {key}"))?;
    let start = offset.min(bytes.len());
    let end = offset.saturating_add(length).min(bytes.len());
    Ok(tauri::ipc::Response::new(bytes[start..end].to_vec()))
}

/// Drop a staged download once the webview has pulled every chunk.
#[tauri::command]
pub fn blob_read_close(
    key: String,
    sessions: State<'_, BlobReadSessions>,
) -> Result<(), CommandError> {
    sessions.0.lock()?.remove(&key);
    Ok(())
}

/// Open (or reset) an upload buffer for `key`.
#[tauri::command]
pub fn blob_write_open(
    key: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), CommandError> {
    sessions
        .0
        .lock()
        ?
        .insert(key, Vec::new());
    Ok(())
}

/// Append one base64-encoded chunk to an open upload buffer.
#[tauri::command]
pub fn blob_write_chunk(
    key: String,
    chunk_base64: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), CommandError> {
    use base64::Engine;
    let chunk = base64::engine::general_purpose::STANDARD
        .decode(chunk_base64.as_bytes())
        .map_err(|e| format!("blob_write_chunk: invalid base64: {e}"))?;
    let mut map = sessions.0.lock()?;
    let buffer = map
        .get_mut(&key)
        .ok_or_else(|| format!("blob_write_chunk: no open session for {key}"))?;
    buffer.extend_from_slice(&chunk);
    Ok(())
}

/// Append one raw-body chunk to an open upload buffer. The desktop twin of
/// `blob_write_chunk`: one 80MB `put_blob` body saturates the WKWebView main
/// thread for seconds, so large desktop uploads stream through this in slices
/// (the key rides the same header as `put_blob`).
#[tauri::command]
pub fn blob_write_chunk_raw(
    request: tauri::ipc::Request<'_>,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), CommandError> {
    let key = request
        .headers()
        .get(BLOB_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("blob_write_chunk_raw: missing {BLOB_KEY_HEADER} header"))?
        .to_string();
    let chunk: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("blob_write_chunk_raw: unsupported JSON body: {e}"))?,
    };
    let mut map = sessions.0.lock()?;
    let buffer = map
        .get_mut(&key)
        .ok_or_else(|| format!("blob_write_chunk_raw: no open session for {key}"))?;
    buffer.extend_from_slice(&chunk);
    Ok(())
}

/// Persist an upload buffer through the regular blob store path.
#[tauri::command]
pub fn blob_write_commit(
    key: String,
    mime_type: Option<String>,
    sessions: State<'_, BlobWriteSessions>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<BlobPutResult, CommandError> {
    let data = sessions
        .0
        .lock()
        ?
        .remove(&key)
        .ok_or_else(|| format!("blob_write_commit: no open session for {key}"))?;
    let conn = db.0.lock()?;
    put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
}

/// Discard an upload buffer after a failed transfer.
#[tauri::command]
pub fn blob_write_abort(
    key: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), CommandError> {
    sessions.0.lock()?.remove(&key);
    Ok(())
}

