//! Desktop side of covers: the `rablob://` protocol handler and the cover IPC
//! commands. Extraction and normalization live in `read_aware_store::covers`.
use crate::error::CommandError;
use crate::metadata::{image_mime, CoverImage};
use crate::storage::get_blob_record_inner;
pub use read_aware_store::covers::*;

#[tauri::command]
pub async fn library_cover_backlog(
    app: tauri::AppHandle,
) -> Result<Vec<CoverBacklogEntry>, CommandError> {
    crate::storage::blocking("library_cover_backlog", move || {
        let db = tauri::Manager::state::<crate::storage::Db>(&app);
        let conn = db.0.lock()?;
        cover_backlog_inner(&conn)
    })
    .await
}

/// Restore a cover that is on record but missing on this device from the
/// book's local file. The database lock is not held while the file is parsed.
#[tauri::command]
pub async fn library_restore_local_cover(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<LocalCoverRestore, CommandError> {
    crate::storage::blocking("library_restore_local_cover", move || {
        let db = tauri::Manager::state::<crate::storage::Db>(&app);
        let data_dir = tauri::Manager::state::<crate::storage::DataDir>(&app);
        let source = {
            let conn = db.0.lock()?;
            local_cover_source(&conn, &data_dir.0, &book_id)?
        };
        let Some((path, format)) = source else {
            return Ok(LocalCoverRestore::Unavailable);
        };
        match derive_cover_from_file(&path, &format) {
            DerivedCover::Cover(cover) => {
                let conn = db.0.lock()?;
                // Settled meanwhile (the relay delivered it, or the book left):
                // nothing to overwrite.
                if local_cover_source(&conn, &data_dir.0, &book_id)?.is_none() {
                    return Ok(LocalCoverRestore::Unavailable);
                }
                store_cover(&conn, &data_dir.0, &book_id, &cover)?;
                Ok(LocalCoverRestore::Restored)
            }
            DerivedCover::Engine => Ok(LocalCoverRestore::Engine),
            DerivedCover::None => {
                log::warn!("book {book_id} has a cover on record but its local file yields none");
                Ok(LocalCoverRestore::Unavailable)
            }
        }
    })
    .await
}

/// Store a cover the webview produced (the engine cover job: PDFs off macOS,
/// RAR comics, anything the native extractors could not read). Raw IPC body
/// = the image bytes; the book id rides in a header. Returns the stored
/// blob's identity, or `null` when the bytes were not a usable image — the
/// caller then records `none` instead of `ready`.
#[tauri::command]
pub async fn library_put_cover(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<Option<StoredCover>, CommandError> {
    let book_id = request
        .headers()
        .get("x-book-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "library_put_cover: missing x-book-id header".to_string())?
        .to_string();
    let mime = request
        .headers()
        .get("x-blob-mime")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("library_put_cover: unsupported JSON body: {e}"))?,
    };
    crate::storage::blocking("library_put_cover", move || {
        let Some(normalized) = normalize_cover(&CoverImage { bytes, mime }) else {
            return Ok(None);
        };
        let db = tauri::Manager::state::<crate::storage::Db>(&app);
        let data_dir = tauri::Manager::state::<crate::storage::DataDir>(&app);
        let conn = db.0.lock()?;
        let stored = store_cover(&conn, &data_dir.0, &book_id, &normalized)?;
        Ok(Some(StoredCover {
            cover_blob_key: cover_blob_key(&book_id),
            sha256: stored.sha256,
        }))
    })
    .await
}

/// Serve `rablob://localhost/cover/<bookId>` — the shelf's `<img src>`. The
/// URL the webview builds carries `?v=<sha256>`, so the response can be
/// cached forever: a re-extracted cover changes the key, never the bytes
/// behind an old one.
pub fn serve_blob(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::Manager;

    fn respond(status: u16, mime: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(status)
            .header("access-control-allow-origin", "*")
            .header("content-type", mime)
            .header("cache-control", "public, max-age=31536000, immutable")
            .body(body)
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    }
    fn not_found() -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(404)
            .header("access-control-allow-origin", "*")
            .body(Vec::new())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    }

    let path = request.uri().path().trim_start_matches('/');
    // Two resources share the scheme: `cover/<bookId>` for shelf artwork and
    // `font/<sha256>` for imported font files (the reader's @font-face src).
    if let Some(font_id) = path.strip_prefix("font/") {
        return match crate::fonts::serve_font_blob(app, font_id) {
            Some((bytes, mime)) => respond(200, &mime, bytes),
            None => not_found(),
        };
    }
    // `book/<bookId>/<sha256>/<entry>`: one entry of a book's archive, which a
    // page of the reader loads as its image, stylesheet, font or media.
    // A book is untrusted content: its resources are typed as given, never
    // sniffed, and inert if anything opens one as a document.
    fn book_resource(resource: crate::book_files::Served) -> tauri::http::Response<Vec<u8>> {
        let (bytes, mime) = match resource {
            Ok(resource) => resource,
            // Why it was not served: gone (404) or damaged (422).
            Err(status) => {
                return tauri::http::Response::builder()
                    .status(status)
                    .header("access-control-allow-origin", "*")
                    .body(Vec::new())
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
            }
        };
        tauri::http::Response::builder()
            .status(200)
            .header("access-control-allow-origin", "*")
            .header("content-type", mime)
            .header("x-content-type-options", "nosniff")
            .header(
                "content-security-policy",
                read_aware_store::book_archive::RESOURCE_CONTENT_POLICY,
            )
            .header("cache-control", "public, max-age=31536000, immutable")
            .body(bytes)
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    }
    if let Some(resource) = path.strip_prefix("book/") {
        return book_resource(crate::book_archive::serve_book_resource(app, resource));
    }
    // `palm/<bookId>/<sha256>/…`: records, decompressed text and resources of
    // a Palm database book (MOBI, AZW3).
    if let Some(resource) = path.strip_prefix("palm/") {
        let query = request.uri().query().unwrap_or_default();
        return book_resource(crate::palm_book::serve_palm_resource(app, resource, query));
    }
    // Book ids are UUIDs, so anything outside that alphabet is not a lookup key.
    let Some(book_id) = path.strip_prefix("cover/") else {
        return not_found();
    };
    if book_id.is_empty()
        || !book_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return not_found();
    }
    let db = app.state::<crate::storage::Db>();
    let data_dir = app.state::<crate::storage::DataDir>();
    let Ok(conn) = db.0.lock() else {
        return not_found();
    };
    let key: String = match conn.query_row(
        "SELECT cover_blob_key FROM books WHERE id=?1 AND cover_status='ready' AND cover_blob_key IS NOT NULL",
        [book_id], |row| row.get(0),
    ) {
        Ok(key) => key,
        Err(rusqlite::Error::QueryReturnedNoRows) => return not_found(),
        Err(error) => { log::warn!("cover projection lookup failed: {error}"); return not_found(); }
    };
    let record = match get_blob_record_inner(&conn, &data_dir.0, &key) {
        Ok(Some(record)) => record,
        Ok(None) => return not_found(),
        Err(error) => {
            log::warn!("cover lookup failed for {key}: {error}");
            return not_found();
        }
    };
    drop(conn);
    let (file_path, info) = record;
    match std::fs::read(&file_path) {
        Ok(bytes) => {
            let mime = info
                .mime_type
                .or_else(|| image_mime(&bytes).map(str::to_owned))
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            respond(200, &mime, bytes)
        }
        Err(error) => {
            log::warn!("cover read failed for {key}: {error}");
            not_found()
        }
    }
}
