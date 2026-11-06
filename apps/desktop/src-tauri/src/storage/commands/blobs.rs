//! IPC commands over `read_aware_store::storage::blobs`.
use crate::error::CommandError;
use crate::storage::*;
use tauri::Manager;

#[tauri::command]
pub async fn put_blob(
    request: tauri::ipc::Request<'_>,
    app: AppHandle,
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
    crate::storage::blocking("put_blob", move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let conn = db.0.lock()?;
        put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
    })
    .await
}

/// Returns the blob's bytes as a raw (non-JSON) IPC response. A missing key
/// yields an EMPTY body — the JS wrapper maps zero length back to `null`.
/// (A raw `Response` cannot express `Option`, and no real payload here is
/// zero-length: book files and derivatives are never empty.)
#[tauri::command]
pub async fn get_blob(
    key: String,
    app: tauri::AppHandle,
) -> Result<tauri::ipc::Response, CommandError> {
    crate::storage::blocking("get_blob", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let conn = db.0.lock()?;
        get_blob_inner(&conn, &data_dir.0, &key).map(tauri::ipc::Response::new)
    })
    .await
}

/// Metadata-only lookup used to create a random-access book source in the
/// webview without first transferring the whole file.
#[tauri::command]
pub async fn get_blob_info(
    key: String,
    app: tauri::AppHandle,
) -> Result<Option<BlobInfo>, CommandError> {
    crate::storage::blocking("get_blob_info", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let conn = db.0.lock()?;
        Ok(get_blob_record_inner(&conn, &data_dir.0, &key)?.map(|(_, info)| info))
    })
    .await
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
pub async fn delete_blob(key: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("delete_blob", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let conn = db.0.lock()?;
        delete_blob_inner(&conn, &data_dir.0, &key)
    })
    .await
}

/// Stage a blob for chunked download and return its byte length.
/// 0 = no such key (same convention as `get_blob`'s empty body).
#[tauri::command]
pub async fn blob_read_open(key: String, app: tauri::AppHandle) -> Result<usize, CommandError> {
    crate::storage::blocking("blob_read_open", move || {
        let sessions = tauri::Manager::state::<BlobReadSessions>(&app);
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let bytes = {
            let conn = db.0.lock()?;
            get_blob_inner(&conn, &data_dir.0, &key)?
        };
        let len = bytes.len();
        if len > 0 {
            sessions.0.lock()?.insert(key, bytes);
        }
        Ok(len)
    })
    .await
}

/// Return one chunk of a staged blob as a raw binary response.
#[tauri::command]
pub async fn blob_read_chunk(
    key: String,
    offset: usize,
    length: usize,
    app: tauri::AppHandle,
) -> Result<tauri::ipc::Response, CommandError> {
    crate::storage::blocking("blob_read_chunk", move || {
        let sessions = tauri::Manager::state::<BlobReadSessions>(&app);
        let map = sessions.0.lock()?;
        let bytes = map
            .get(&key)
            .ok_or_else(|| format!("blob_read_chunk: no open session for {key}"))?;
        let start = offset.min(bytes.len());
        let end = offset.saturating_add(length).min(bytes.len());
        Ok(tauri::ipc::Response::new(bytes[start..end].to_vec()))
    })
    .await
}

/// Drop a staged download once the webview has pulled every chunk.
#[tauri::command]
pub async fn blob_read_close(key: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("blob_read_close", move || {
        let sessions = tauri::Manager::state::<BlobReadSessions>(&app);
        sessions.0.lock()?.remove(&key);
        Ok(())
    })
    .await
}

/// Open (or reset) an upload buffer for `key`.
#[tauri::command]
pub async fn blob_write_open(key: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("blob_write_open", move || {
        let sessions = tauri::Manager::state::<BlobWriteSessions>(&app);
        sessions.0.lock()?.insert(key, Vec::new());
        Ok(())
    })
    .await
}

/// Append one base64-encoded chunk to an open upload buffer.
#[tauri::command]
pub async fn blob_write_chunk(
    key: String,
    chunk_base64: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("blob_write_chunk", move || {
        let sessions = tauri::Manager::state::<BlobWriteSessions>(&app);
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
    })
    .await
}

/// Append one raw-body chunk to an open upload buffer. The desktop twin of
/// `blob_write_chunk`: one 80MB `put_blob` body saturates the WKWebView main
/// thread for seconds, so large desktop uploads stream through this in slices
/// (the key rides the same header as `put_blob`).
#[tauri::command]
pub async fn blob_write_chunk_raw(
    request: tauri::ipc::Request<'_>,
    app: AppHandle,
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
    crate::storage::blocking("blob_write_chunk_raw", move || {
        let sessions = app.state::<BlobWriteSessions>();
        let mut map = sessions.0.lock()?;
        let buffer = map
            .get_mut(&key)
            .ok_or_else(|| format!("blob_write_chunk_raw: no open session for {key}"))?;
        buffer.extend_from_slice(&chunk);
        Ok(())
    })
    .await
}

/// Persist an upload buffer through the regular blob store path.
#[tauri::command]
pub async fn blob_write_commit(
    key: String,
    mime_type: Option<String>,
    app: tauri::AppHandle,
) -> Result<BlobPutResult, CommandError> {
    crate::storage::blocking("blob_write_commit", move || {
        let sessions = tauri::Manager::state::<BlobWriteSessions>(&app);
        let db = tauri::Manager::state::<Db>(&app);
        let data_dir = tauri::Manager::state::<DataDir>(&app);
        let data = sessions
            .0
            .lock()?
            .remove(&key)
            .ok_or_else(|| format!("blob_write_commit: no open session for {key}"))?;
        let conn = db.0.lock()?;
        put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
    })
    .await
}

/// Discard an upload buffer after a failed transfer.
#[tauri::command]
pub async fn blob_write_abort(key: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("blob_write_abort", move || {
        let sessions = tauri::Manager::state::<BlobWriteSessions>(&app);
        sessions.0.lock()?.remove(&key);
        Ok(())
    })
    .await
}
