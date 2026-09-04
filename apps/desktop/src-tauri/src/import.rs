//! The import staging command: everything a picked book needs before the
//! `book.imported` event can be committed, in ONE native round trip.
//!
//! Order of operations, chosen so the common cases pay the least:
//!
//! 1. Hash the source where it sits (one streaming read; on Android the
//!    content URI is drained to a temp file exactly once, and that copy feeds
//!    every later step).
//! 2. Ask the registry whether the shelf already holds this content. A
//!    duplicate returns here — no copy, no extraction. If the existing record
//!    is a synced-in shell without local bytes, the picked file fills it.
//! 3. Copy into the blob store (`fs::copy` keeps clonefile/copy_file_range
//!    fast paths) and register under the sha computed in step 1 — the staged
//!    copy is never re-read to hash it.
//! 4. Run the format's native extractor over the stored copy; normalize and
//!    file the cover it found.
//!
//! The webview then commits `book.imported` (+ `book.coverExtracted`) with
//! what came back. Formats the extractors cannot serve — PDF metadata on every
//! platform, PDF covers off macOS, RAR comics — report `deferred` and the
//! engine cover job finishes them right after the shelf entry appears.

use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::covers::{cover_blob_key, normalize_cover, store_cover};
use crate::error::CommandError;
use crate::metadata::BookMetadata;
use crate::storage::{
    blob_file_name, copy_blob_file, delete_blob_inner, find_book_by_sha_inner,
    get_blob_record_inner, register_blob_inner, DataDir, Db,
};

/// Where the bytes are: a native path the user picked (desktop dialogs,
/// Android content URIs, file associations), or already written to
/// `bookfile:<bookId>` through the chunked IPC writer (drag-and-drop files,
/// plugin `importBook`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StageSource {
    Path { path: String },
    Blob,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageImportRequest {
    pub book_id: String,
    pub format: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub source: StageSource,
}

/// How the cover question was settled at import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CoverOutcome {
    /// Stored under `cover:<bookId>` — commit `coverExtracted{ready}`.
    Ready,
    /// The format was inspected and carries no cover — commit
    /// `coverExtracted{none}` so no device ever probes for one.
    None,
    /// Nothing native could decide; the engine cover job takes over.
    Deferred,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedImport {
    pub sha256: String,
    pub byte_size: i64,
    /// A shelf book that already holds this exact content. When set, nothing
    /// was created for `book_id` — the caller reports the duplicate.
    pub duplicate_of: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: CoverOutcome,
    /// The bibliographic fields need the engine (PDF: title/author come from
    /// the Info dictionary once pdf.js has parsed the document).
    pub metadata_deferred: bool,
}

/// What each format can get natively. `None` = the format carries no cover
/// at all (plain text, HTML), so the outcome is decided without any parsing.
enum Extractor {
    Native(fn(&Path) -> Result<BookMetadata, String>),
    NoCover,
    EngineOnly,
}

fn extractor_for(format: &str) -> Extractor {
    match format {
        "epub" => Extractor::Native(crate::book_metadata::extract_epub_metadata_from_path),
        "mobi" | "azw3" => Extractor::Native(crate::mobi_metadata::extract_mobi_metadata_from_path),
        "fb2" => Extractor::Native(crate::fb2_metadata::extract_fb2_metadata_from_path),
        "cbz" => Extractor::Native(crate::comic_metadata::extract_comic_metadata_from_path),
        "pdf" => Extractor::Native(crate::pdf_metadata::extract_pdf_metadata_from_path),
        "txt" | "html" => Extractor::NoCover,
        _ => Extractor::EngineOnly,
    }
}

/// Stream-hash a file: one read pass, bounded memory.
pub(crate) fn hash_file(path: &Path) -> Result<(String, i64), CommandError> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut size: i64 = 0;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as i64;
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn stage_import(app: &AppHandle, request: StageImportRequest) -> Result<StagedImport, CommandError> {
    let started = std::time::Instant::now();
    let data_dir: PathBuf = app.state::<DataDir>().0.clone();
    let db = app.state::<Db>();
    let own_key = format!("bookfile:{}", request.book_id);
    let mime = request.mime_type.as_deref().filter(|value| !value.is_empty());

    // ── 1–3: bytes into the store, or a duplicate verdict ─────────────────
    let (sha256, byte_size, local_path) = match &request.source {
        StageSource::Path { path } => {
            let source = crate::native_path::materialize(app, path)?;
            let (sha256, byte_size) = hash_file(&source.path)?;
            let existing = {
                let conn = db.0.lock()?;
                find_book_by_sha_inner(&conn, &sha256, Some(&request.book_id))?
            };
            if let Some(existing_id) = existing {
                let existing_key = format!("bookfile:{existing_id}");
                let has_bytes = {
                    let conn = db.0.lock()?;
                    get_blob_record_inner(&conn, &data_dir, &existing_key)?.is_some()
                };
                if !has_bytes {
                    // A synced-in shell: the picked file is exactly what it lacks.
                    let (size, file_name) = copy_blob_file(&data_dir, &existing_key, &source.path)?;
                    let conn = db.0.lock()?;
                    register_blob_inner(&conn, &existing_key, mime, size, sha256.clone(), file_name)?;
                }
                return Ok(StagedImport {
                    sha256,
                    byte_size,
                    duplicate_of: Some(existing_id),
                    title: None,
                    author: None,
                    cover: CoverOutcome::Deferred,
                    metadata_deferred: false,
                });
            }
            let (size, file_name) = copy_blob_file(&data_dir, &own_key, &source.path)?;
            {
                let conn = db.0.lock()?;
                register_blob_inner(&conn, &own_key, mime, size, sha256.clone(), file_name.clone())?;
            }
            (sha256, byte_size, data_dir.join("blobs").join(file_name))
        }
        StageSource::Blob => {
            let conn = db.0.lock()?;
            let (sha256, byte_size): (String, i64) = conn
                .query_row(
                    "SELECT sha256, byte_size FROM blob_objects
                     WHERE key = ?1 AND deleted_at IS NULL AND storage_uri IS NOT NULL",
                    rusqlite::params![own_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| format!("stage import: no staged bytes under {own_key}"))?;
            let Some((path, _)) = get_blob_record_inner(&conn, &data_dir, &own_key)? else {
                return Err(CommandError::internal(format!("stage import: {own_key} has no file")));
            };
            if let Some(existing_id) = find_book_by_sha_inner(&conn, &sha256, Some(&request.book_id))? {
                let existing_key = format!("bookfile:{existing_id}");
                if get_blob_record_inner(&conn, &data_dir, &existing_key)?.is_none() {
                    // Move our staged file under the existing record's key.
                    let target_name = blob_file_name(&existing_key);
                    let target = data_dir.join("blobs").join(&target_name);
                    std::fs::rename(&path, &target)?;
                    register_blob_inner(&conn, &existing_key, mime, byte_size, sha256.clone(), target_name)?;
                    // Our own row now points at a file that moved away.
                    conn.execute(
                        "DELETE FROM blob_sync_state WHERE blob_key = ?1",
                        rusqlite::params![own_key],
                    )?;
                    conn.execute(
                        "DELETE FROM blob_objects WHERE key = ?1",
                        rusqlite::params![own_key],
                    )?;
                } else {
                    delete_blob_inner(&conn, &data_dir, &own_key)?;
                }
                return Ok(StagedImport {
                    sha256,
                    byte_size,
                    duplicate_of: Some(existing_id),
                    title: None,
                    author: None,
                    cover: CoverOutcome::Deferred,
                    metadata_deferred: false,
                });
            }
            (sha256, byte_size, path)
        }
    };

    let staged_at = started.elapsed();
    let mut extracted_at: Option<std::time::Duration> = None;

    // ── 4: metadata + cover from the stored copy ──────────────────────────
    let (metadata, cover, metadata_deferred) = match extractor_for(&request.format) {
        Extractor::NoCover => (BookMetadata::default(), CoverOutcome::None, false),
        Extractor::EngineOnly => (BookMetadata::default(), CoverOutcome::Deferred, true),
        Extractor::Native(extract) => match extract(&local_path) {
            Ok(metadata) => {
                extracted_at = Some(started.elapsed());
                let is_pdf = request.format == "pdf";
                let cover = match metadata.cover.as_ref().and_then(normalize_cover) {
                    Some(normalized) => {
                        let conn = db.0.lock()?;
                        store_cover(&conn, &data_dir, &request.book_id, &normalized)?;
                        CoverOutcome::Ready
                    }
                    // A PDF without a native render is not "no cover": the
                    // engine still renders page one. Every other native
                    // format was fully inspected.
                    None if is_pdf => CoverOutcome::Deferred,
                    None => CoverOutcome::None,
                };
                (metadata, cover, is_pdf)
            }
            Err(error) => {
                // A malformed container still imports: the reader may cope
                // where the lightweight parser did not, so leave the cover
                // and metadata to the engine job.
                log::warn!(
                    "native {} metadata extraction failed for {}: {error}",
                    request.format,
                    request.book_id
                );
                (BookMetadata::default(), CoverOutcome::Deferred, true)
            }
        },
    };
    debug_assert!(
        cover != CoverOutcome::Ready || {
            let conn = db.0.lock()?;
            get_blob_record_inner(&conn, &data_dir, &cover_blob_key(&request.book_id))?.is_some()
        }
    );

    // One line per import in the file log: the two phases users feel (bytes
    // into the store; metadata + cover) with their cost, so a slow import
    // can be read off the diagnostics bundle instead of guessed at.
    let extracted_at = extracted_at.unwrap_or(staged_at);
    log::info!(
        "staged {} import {} ({} bytes): store {} ms, extract {} ms, cover {} ms → {:?}",
        request.format,
        request.book_id,
        byte_size,
        staged_at.as_millis(),
        (extracted_at - staged_at).as_millis(),
        (started.elapsed() - extracted_at).as_millis(),
        cover
    );

    Ok(StagedImport {
        sha256,
        byte_size,
        duplicate_of: None,
        title: metadata.title,
        author: metadata.author,
        cover,
        metadata_deferred,
    })
}

/// Native import on every platform; runs on the blocking pool so hashing and
/// copying a large book never stall the async runtime or the window thread.
#[tauri::command]
pub async fn library_stage_import(
    app: AppHandle,
    request: StageImportRequest,
) -> Result<StagedImport, CommandError> {
    tauri::async_runtime::spawn_blocking(move || stage_import(&app, request))
        .await
        .map_err(|error| format!("library_stage_import task failed: {error}"))?
}
