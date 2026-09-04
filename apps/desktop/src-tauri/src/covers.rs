//! Book covers: normalization, storage, and serving.
//!
//! A cover is a `cover:<bookId>` blob (kind `cover_image`, synced) plus the
//! `books.cover_status` / `cover_blob_key` projection that `book.coverExtracted`
//! maintains. Nothing about a cover is a data URL anymore: the shelf loads
//! artwork through the `rablob://` scheme served here, so the shelf payload
//! stays small no matter how many books it lists, and the same bytes travel to
//! other devices as the blob they already are.
//!
//! Every producer — the import extractors, the webview's engine job, the
//! legacy data-URL migration — funnels through [`normalize_cover`] so a
//! 20 MB scan and a 40 KB thumbnail land in the store as the same thing: a
//! bounded JPEG (or the original bytes when they are already small enough).

use std::io::Cursor;
use std::path::Path;

use rusqlite::Connection;

use crate::error::CommandError;
use crate::metadata::{image_mime, CoverImage};
use crate::storage::{get_blob_record_inner, put_blob_inner, BlobPutResult};

/// Longest edge the stored cover keeps. The shelf paints tiles well under
/// 300 CSS px wide; 900 px tall covers retina displays with room to spare.
pub const COVER_MAX_WIDTH: u32 = 600;
pub const COVER_MAX_HEIGHT: u32 = 900;
/// Originals at or under this size that already fit the box are kept verbatim
/// (no generation loss for a well-made cover).
const KEEP_ORIGINAL_MAX_BYTES: usize = 512 * 1024;
/// Vector covers cannot be rasterized here; a small SVG is served as-is.
const SVG_MAX_BYTES: usize = 1024 * 1024;
const JPEG_QUALITY: u8 = 85;

/// Blob key that holds a book's cover.
pub fn cover_blob_key(book_id: &str) -> String {
    format!("cover:{book_id}")
}

/// A cover ready for the store.
#[derive(Debug, PartialEq)]
pub struct NormalizedCover {
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Bound a cover for storage. `None` means the bytes are not a usable image
/// (undecodable, or a vector format too large to keep) — callers record the
/// book as having no cover rather than storing junk.
pub fn normalize_cover(cover: &CoverImage) -> Option<NormalizedCover> {
    let sniffed = image_mime(&cover.bytes);
    if sniffed == Some("image/svg+xml") || cover.mime == "image/svg+xml" {
        return (cover.bytes.len() <= SVG_MAX_BYTES).then(|| NormalizedCover {
            bytes: cover.bytes.clone(),
            mime: "image/svg+xml".to_owned(),
        });
    }
    let decoded = image::load_from_memory(&cover.bytes).ok()?;
    let (width, height) = (decoded.width(), decoded.height());
    if width == 0 || height == 0 {
        return None;
    }
    let fits = width <= COVER_MAX_WIDTH && height <= COVER_MAX_HEIGHT;
    let keepable = matches!(sniffed, Some("image/jpeg") | Some("image/png") | Some("image/webp"));
    if fits && keepable && cover.bytes.len() <= KEEP_ORIGINAL_MAX_BYTES {
        return Some(NormalizedCover {
            bytes: cover.bytes.clone(),
            mime: sniffed.unwrap_or("image/jpeg").to_owned(),
        });
    }
    let resized = if fits {
        decoded
    } else {
        decoded.resize(
            COVER_MAX_WIDTH,
            COVER_MAX_HEIGHT,
            image::imageops::FilterType::Lanczos3,
        )
    };
    // JPEG has no alpha: composite onto white so a transparent PNG cover does
    // not turn black.
    let rgba = resized.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (source, target) in rgba.pixels().zip(rgb.pixels_mut()) {
        let alpha = u32::from(source[3]);
        let blend = |channel: u8| -> u8 {
            ((u32::from(channel) * alpha + 255 * (255 - alpha)) / 255) as u8
        };
        *target = image::Rgb([blend(source[0]), blend(source[1]), blend(source[2])]);
    }
    let mut out = Cursor::new(Vec::with_capacity(64 * 1024));
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .ok()?;
    Some(NormalizedCover {
        bytes: out.into_inner(),
        mime: "image/jpeg".to_owned(),
    })
}

/// File a normalized cover under the book's cover key. The blob registers as
/// `cover_image` and enters the push outbox; the caller commits the matching
/// `book.coverExtracted` event so the projection (and every other device)
/// learns the cover exists.
pub fn store_cover(
    conn: &Connection,
    data_dir: &Path,
    book_id: &str,
    cover: &NormalizedCover,
) -> Result<BlobPutResult, CommandError> {
    put_blob_inner(
        conn,
        data_dir,
        &cover_blob_key(book_id),
        Some(&cover.mime),
        &cover.bytes,
    )
}

/// Decode a `data:<mime>;base64,<payload>` cover (the pre-blob storage form).
pub fn cover_from_data_url(data_url: &str) -> Option<CoverImage> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let rest = data_url.strip_prefix("data:")?;
    let (header, payload) = rest.split_once(',')?;
    let mime = header.strip_suffix(";base64")?;
    let bytes = STANDARD.decode(payload.trim()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let mime = image_mime(&bytes).map(str::to_owned).unwrap_or_else(|| mime.to_owned());
    Some(CoverImage { bytes, mime })
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
    // Only covers are reachable through the scheme: `cover/<bookId>`. Book
    // ids are UUIDs, so anything outside that alphabet is not a lookup key.
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
    let key = cover_blob_key(book_id);
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

/// Which books have a cover on record but no local bytes yet — the sync
/// hydrator's work list. A cover is "on record" when `book.coverExtracted`
/// projected `ready`; the blob row it left behind is manifest-only until
/// the relay hands the bytes over.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverBacklogEntry {
    pub book_id: String,
    pub cover_blob_key: String,
}

pub fn cover_backlog_inner(conn: &Connection) -> Result<Vec<CoverBacklogEntry>, CommandError> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.cover_blob_key FROM books b
         LEFT JOIN blob_objects bo ON bo.key = b.cover_blob_key AND bo.deleted_at IS NULL
         WHERE b.cover_status = 'ready' AND b.cover_blob_key IS NOT NULL
           AND (bo.key IS NULL OR bo.storage_uri IS NULL)
         ORDER BY b.updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CoverBacklogEntry {
            book_id: row.get(0)?,
            cover_blob_key: row.get(1)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn library_cover_backlog(
    db: tauri::State<'_, crate::storage::Db>,
) -> Result<Vec<CoverBacklogEntry>, CommandError> {
    let conn = db.0.lock()?;
    cover_backlog_inner(&conn)
}

/// Store a cover the webview produced (the engine cover job: PDFs off macOS,
/// RAR comics, anything the native extractors could not read). Raw IPC body
/// = the image bytes; the book id rides in a header. Returns the stored
/// blob's identity, or `null` when the bytes were not a usable image — the
/// caller then records `none` instead of `ready`.
#[tauri::command]
pub fn library_put_cover(
    request: tauri::ipc::Request<'_>,
    db: tauri::State<'_, crate::storage::Db>,
    data_dir: tauri::State<'_, crate::storage::DataDir>,
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
    let Some(normalized) = normalize_cover(&CoverImage { bytes, mime }) else {
        return Ok(None);
    };
    let conn = db.0.lock()?;
    let stored = store_cover(&conn, &data_dir.0, &book_id, &normalized)?;
    Ok(Some(StoredCover {
        cover_blob_key: cover_blob_key(&book_id),
        sha256: stored.sha256,
    }))
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCover {
    pub cover_blob_key: String,
    pub sha256: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(width, height, image::Rgba([200, 30, 30, 255]))
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn small_originals_are_kept_verbatim() {
        let bytes = png(300, 450);
        let cover = CoverImage { bytes: bytes.clone(), mime: "image/png".into() };
        let normalized = normalize_cover(&cover).unwrap();
        assert_eq!(normalized.bytes, bytes);
        assert_eq!(normalized.mime, "image/png");
    }

    #[test]
    fn oversized_covers_shrink_into_the_box_as_jpeg() {
        let cover = CoverImage { bytes: png(2400, 3600), mime: "image/png".into() };
        let normalized = normalize_cover(&cover).unwrap();
        assert_eq!(normalized.mime, "image/jpeg");
        let decoded = image::load_from_memory(&normalized.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (600, 900));
    }

    /// Not an assertion: prints the cost of the worst realistic case so a
    /// `cargo test --release covers -- --nocapture` reports the production
    /// number (debug builds run the codecs at opt-level 3 but not the rest).
    #[test]
    fn normalization_cost_is_reported() {
        let cover = CoverImage { bytes: png(2400, 3600), mime: "image/png".into() };
        let started = std::time::Instant::now();
        let normalized = normalize_cover(&cover).unwrap();
        eprintln!(
            "normalize 2400x3600 PNG → {} bytes in {} ms",
            normalized.bytes.len(),
            started.elapsed().as_millis()
        );
    }

    #[test]
    fn undecodable_bytes_are_not_a_cover() {
        let cover = CoverImage { bytes: b"FONT\0\0\0\0".to_vec(), mime: "font/ttf".into() };
        assert_eq!(normalize_cover(&cover), None);
    }

    #[test]
    fn small_svg_passes_through() {
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec();
        let cover = CoverImage { bytes: svg.clone(), mime: "image/svg+xml".into() };
        let normalized = normalize_cover(&cover).unwrap();
        assert_eq!(normalized.bytes, svg);
        assert_eq!(normalized.mime, "image/svg+xml");
    }

    #[test]
    fn data_urls_decode_to_sniffed_images() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let bytes = png(4, 4);
        let url = format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes));
        let cover = cover_from_data_url(&url).unwrap();
        assert_eq!(cover.bytes, bytes);
        // The bytes are PNG whatever the header claimed.
        assert_eq!(cover.mime, "image/png");
        assert!(cover_from_data_url("data:image/png;base64,").is_none());
        assert!(cover_from_data_url("https://example.com/x.png").is_none());
    }
}
