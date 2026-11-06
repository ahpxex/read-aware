//! Book import, one implementation for the desktop app and the `ra` CLI.
//!
//! `import_book` runs the whole pipeline: a name/size dedupe, the format
//! decision, the durable import intent, staging (hash the source where it
//! sits, dedupe by content, copy into the blob store, extract metadata and a
//! cover natively), and the commit of `book.imported` (+ `book.coverExtracted`)
//! with stamps minted inside the write transaction. Hosts only turn their
//! source into a readable local file first (Android content URIs, resources).

use std::io::{BufReader, Read};
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::book_format::detect_format;
use crate::covers::{cover_blob_key, normalize_cover, store_cover};
use crate::error::CommandError;
use crate::file_name::parse_file_name;
use crate::metadata::BookMetadata;
use crate::storage::{
    begin_inner, blob_file_name, commit_events_in_transaction, copy_blob_file, delete_blob_inner,
    find_book_by_sha_inner, finish_inner, get_blob_record_inner, get_book_inner, next_local_stamps,
    register_blob_inner, Db, EventRow, LibraryBook,
};

/// What each format can get natively. `None` = the format carries no cover
/// at all (plain text, HTML), so the outcome is decided without any parsing.
pub enum Extractor {
    Native(fn(&Path) -> Result<BookMetadata, String>),
    NoCover,
    EngineOnly,
}

pub fn extractor_for(format: &str) -> Extractor {
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
pub fn hash_file(path: &Path) -> Result<(String, i64), CommandError> {
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

// --- Staging: bytes into the store, metadata and cover out ----------------

/// How the cover question was settled at import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CoverOutcome {
    /// Stored under `cover:<bookId>` — commit `coverExtracted{ready}`.
    Ready,
    /// The format was inspected and carries no cover — commit
    /// `coverExtracted{none}` so no device ever probes for one.
    None,
    /// The native extractors could not decide (PDF off macOS, RAR comics, a
    /// container they could not parse); the reading engine settles it later.
    Deferred,
}

/// What staging produced: the content identity, a duplicate verdict, and
/// whatever the native extractor found.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedImport {
    pub sha256: String,
    pub byte_size: i64,
    /// An existing book with this exact content (bytes were not kept, or
    /// filled a synced-in shell that lacked them).
    pub duplicate_of: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: CoverOutcome,
    /// Title/author still need the reading engine (every PDF, RAR comics,
    /// containers the native extractor could not parse).
    pub metadata_deferred: bool,
}

/// Where staging reads the book from.
#[derive(Debug, Clone, Copy)]
pub enum StageFrom<'a> {
    /// A local file (a picked path, a resource or content URI the host
    /// already materialized). It is hashed in place and copied in.
    File(&'a Path),
    /// Bytes the host already wrote under `bookfile:<bookId>` (drag-and-drop
    /// files, plugin imports).
    Staged,
}

/// Hash → dedupe → copy → extract → cover, the expensive part of an import.
/// A content duplicate returns early with `duplicate_of`; when that book is a
/// synced-in shell without local bytes, these bytes fill it.
pub fn stage_inner(
    db: &Db,
    data_dir: &Path,
    book_id: &str,
    format: &str,
    mime: Option<&str>,
    from: StageFrom<'_>,
) -> Result<StagedImport, CommandError> {
    let started = std::time::Instant::now();
    let own_key = format!("bookfile:{book_id}");
    let mime = mime.filter(|value| !value.is_empty());
    let duplicate = |sha256: String, byte_size: i64, existing_id: String| StagedImport {
        sha256,
        byte_size,
        duplicate_of: Some(existing_id),
        title: None,
        author: None,
        cover: CoverOutcome::Deferred,
        metadata_deferred: false,
    };

    // ── 1–3: bytes into the store, or a duplicate verdict ─────────────────
    let (sha256, byte_size, local_path) = match from {
        StageFrom::File(source) => {
            let (sha256, byte_size) = hash_file(source)?;
            let existing = {
                let conn = db.0.lock()?;
                find_book_by_sha_inner(&conn, &sha256, Some(book_id))?
            };
            if let Some(existing_id) = existing {
                let existing_key = format!("bookfile:{existing_id}");
                let has_bytes = {
                    let conn = db.0.lock()?;
                    get_blob_record_inner(&conn, data_dir, &existing_key)?.is_some()
                };
                if !has_bytes {
                    // A synced-in shell: the picked file is exactly what it lacks.
                    let (size, file_name) = copy_blob_file(data_dir, &existing_key, source)?;
                    let conn = db.0.lock()?;
                    register_blob_inner(
                        &conn,
                        &existing_key,
                        mime,
                        size,
                        sha256.clone(),
                        file_name,
                    )?;
                }
                return Ok(duplicate(sha256, byte_size, existing_id));
            }
            let (size, file_name) = copy_blob_file(data_dir, &own_key, source)?;
            {
                let conn = db.0.lock()?;
                register_blob_inner(
                    &conn,
                    &own_key,
                    mime,
                    size,
                    sha256.clone(),
                    file_name.clone(),
                )?;
            }
            (sha256, byte_size, data_dir.join("blobs").join(file_name))
        }
        StageFrom::Staged => {
            let conn = db.0.lock()?;
            let (sha256, byte_size): (String, i64) = conn
                .query_row(
                    "SELECT sha256, byte_size FROM blob_objects
                     WHERE key = ?1 AND deleted_at IS NULL AND storage_uri IS NOT NULL",
                    params![own_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| {
                    CommandError::internal(format!("stage import: no staged bytes under {own_key}"))
                })?;
            let Some((path, _)) = get_blob_record_inner(&conn, data_dir, &own_key)? else {
                return Err(CommandError::internal(format!(
                    "stage import: {own_key} has no file"
                )));
            };
            if let Some(existing_id) = find_book_by_sha_inner(&conn, &sha256, Some(book_id))? {
                let existing_key = format!("bookfile:{existing_id}");
                if get_blob_record_inner(&conn, data_dir, &existing_key)?.is_none() {
                    // Move our staged file under the existing record's key.
                    let target_name = blob_file_name(&existing_key);
                    let target = data_dir.join("blobs").join(&target_name);
                    std::fs::rename(&path, &target)?;
                    register_blob_inner(
                        &conn,
                        &existing_key,
                        mime,
                        byte_size,
                        sha256.clone(),
                        target_name,
                    )?;
                    // Our own row now points at a file that moved away.
                    conn.execute(
                        "DELETE FROM blob_sync_state WHERE blob_key = ?1",
                        params![own_key],
                    )?;
                    conn.execute("DELETE FROM blob_objects WHERE key = ?1", params![own_key])?;
                } else {
                    delete_blob_inner(&conn, data_dir, &own_key)?;
                }
                return Ok(duplicate(sha256, byte_size, existing_id));
            }
            (sha256, byte_size, path)
        }
    };

    let staged_at = started.elapsed();
    let mut extracted_at: Option<std::time::Duration> = None;

    // ── 4: metadata + cover from the stored copy ──────────────────────────
    let (metadata, cover, metadata_deferred) = match extractor_for(format) {
        Extractor::NoCover => (BookMetadata::default(), CoverOutcome::None, false),
        Extractor::EngineOnly => (BookMetadata::default(), CoverOutcome::Deferred, true),
        Extractor::Native(extract) => match extract(&local_path) {
            Ok(metadata) => {
                extracted_at = Some(started.elapsed());
                let is_pdf = format == "pdf";
                let cover = match metadata.cover.as_ref().and_then(normalize_cover) {
                    Some(normalized) => {
                        let conn = db.0.lock()?;
                        store_cover(&conn, data_dir, book_id, &normalized)?;
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
                log::warn!("native {format} metadata extraction failed for {book_id}: {error}");
                (BookMetadata::default(), CoverOutcome::Deferred, true)
            }
        },
    };

    // One line per import in the file log: the two phases users feel (bytes
    // into the store; metadata + cover) with their cost, so a slow import
    // can be read off the diagnostics bundle instead of guessed at.
    let extracted_at = extracted_at.unwrap_or(staged_at);
    log::info!(
        "staged {format} import {book_id} ({byte_size} bytes): store {} ms, extract {} ms, cover {} ms → {cover:?}",
        staged_at.as_millis(),
        (extracted_at - staged_at).as_millis(),
        (started.elapsed() - extracted_at).as_millis(),
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

// --- The whole import: one implementation for the app and the CLI ---------

/// What the caller knows about the book file before it is read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBookRequest {
    /// A new UUID; recorded in the import intent before any byte is written.
    pub book_id: String,
    /// The file's display name: drives the format guess and the title fallback.
    pub file_name: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    /// Where a folder import found the file, relative to the picked folder.
    #[serde(default)]
    pub source_path: Option<String>,
    /// The event origin (`user`, `agent`, `plugin:<id>`, `system`); None is a
    /// user action.
    #[serde(default)]
    pub origin: Option<String>,
    /// Skip a book whose file name and size match an existing one, before any
    /// copy. Off for sources whose names are not file names (resources).
    #[serde(default = "default_true")]
    pub dedupe_by_name: bool,
}

fn default_true() -> bool {
    true
}

/// Who records the import intent. Bytes staged by the host (`Staged`) were
/// written after the host recorded it; for a file this function records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportIntent {
    Record,
    AlreadyRecorded,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ImportBookOutcome {
    #[serde(rename_all = "camelCase")]
    Imported {
        book: LibraryBook,
        cover: CoverOutcome,
        /// Title/author still wait on the reading engine.
        metadata_deferred: bool,
        /// The committed events, so a host can observe their stamps and
        /// notify its listeners.
        events: Vec<EventRow>,
    },
    /// An existing book with the same file (by name and size, or by content).
    Duplicate { book: LibraryBook },
}

/// Import one book file: dedupe by name and size, decide the format, record the
/// import intent, stage the bytes (dedupe by content, fill a synced-in shell),
/// and commit `book.imported` (+ `book.coverExtracted`) with stamps minted
/// inside the write transaction. A failure before the commit releases this
/// import's files; the committed book clears the intent atomically.
pub fn import_book(
    db: &Db,
    data_dir: &Path,
    owner: &str,
    request: &ImportBookRequest,
    from: StageFrom<'_>,
    intent: ImportIntent,
) -> Result<ImportBookOutcome, CommandError> {
    let book_id = request.book_id.as_str();
    let own_key = format!("bookfile:{book_id}");
    let mime = request.mime_type.as_deref().unwrap_or("");

    // The file as it sits before staging: its size and readable path.
    let (path, size) = match from {
        StageFrom::File(path) => (path.to_path_buf(), std::fs::metadata(path)?.len() as i64),
        StageFrom::Staged => {
            let conn = db.0.lock()?;
            let Some((path, info)) = get_blob_record_inner(&conn, data_dir, &own_key)? else {
                return Err(CommandError::internal(format!(
                    "import: no staged bytes under {own_key}"
                )));
            };
            (path, info.byte_size as i64)
        }
    };

    if request.dedupe_by_name {
        let conn = db.0.lock()?;
        let same_file: Option<String> = conn
            .query_row(
                "SELECT id FROM books WHERE file_name = ?1 AND file_size = ?2 LIMIT 1",
                params![request.file_name, size],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing) = same_file.and_then(|id| get_book_inner(&conn, &id).transpose()) {
            return Ok(ImportBookOutcome::Duplicate { book: existing? });
        }
    }

    let format = detect_format(&request.file_name, mime, &path)?;

    if intent == ImportIntent::Record {
        let conn = db.0.lock()?;
        begin_inner(&conn, data_dir, book_id, owner)?;
    }
    let outcome = stage_and_commit(db, data_dir, request, format, from);
    if intent == ImportIntent::Record {
        // A committed book already cleared the intent; anything else releases
        // this import's files. A failed release stays durable for recovery
        // and must not mask the import's own outcome.
        let mut conn = db.0.lock()?;
        if let Err(error) = finish_inner(&mut conn, data_dir, book_id, owner) {
            log::warn!("import cleanup for {book_id} deferred: {error}");
        }
    }
    outcome
}

fn stage_and_commit(
    db: &Db,
    data_dir: &Path,
    request: &ImportBookRequest,
    format: &'static str,
    from: StageFrom<'_>,
) -> Result<ImportBookOutcome, CommandError> {
    let book_id = request.book_id.as_str();
    let mime = request
        .mime_type
        .as_deref()
        .filter(|value| !value.is_empty());
    let staged = stage_inner(db, data_dir, book_id, format, mime, from)?;
    if let Some(existing_id) = staged.duplicate_of {
        let conn = db.0.lock()?;
        let book = get_book_inner(&conn, &existing_id)?.ok_or_else(|| {
            // The registry matched a sha whose book row is gone.
            CommandError::internal(format!("duplicate of an unknown book {existing_id}"))
        })?;
        return Ok(ImportBookOutcome::Duplicate { book });
    }

    let guess = parse_file_name(&request.file_name);
    let pick = |found: &Option<String>, fallback: String| {
        found
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or(fallback)
    };
    let mut imported = serde_json::json!({
        "bookId": book_id,
        "title": pick(&staged.title, guess.title),
        "author": pick(&staged.author, guess.author),
        "format": format,
        "fileName": request.file_name,
        "fileSize": staged.byte_size,
        "sourceBlobKey": format!("bookfile:{book_id}"),
        "sourceSha256": staged.sha256,
        "metadataStatus": if staged.metadata_deferred { "deferred" } else { "settled" },
    });
    if let Some(mime) = mime {
        imported["mimeType"] = mime.into();
    }
    if let Some(source_path) = &request.source_path {
        imported["sourcePath"] = source_path.clone().into();
    }
    let mut drafts = vec![("book.imported", imported)];
    match staged.cover {
        CoverOutcome::Ready => drafts.push((
            "book.coverExtracted",
            serde_json::json!({
                "bookId": book_id,
                "status": "ready",
                "coverBlobKey": cover_blob_key(book_id),
            }),
        )),
        CoverOutcome::None => drafts.push((
            "book.coverExtracted",
            serde_json::json!({ "bookId": book_id, "status": "none" }),
        )),
        CoverOutcome::Deferred => {}
    }

    let mut conn = db.0.lock()?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let stamps = next_local_stamps(&tx, drafts.len())?;
    let events: Vec<EventRow> = drafts
        .into_iter()
        .zip(stamps)
        .map(|((event_type, payload), hlc)| EventRow {
            id: uuid::Uuid::new_v4().to_string(),
            event_type: event_type.to_owned(),
            hlc,
            schema_version: Some(1),
            aggregate_type: Some("book".to_owned()),
            aggregate_id: Some(book_id.to_owned()),
            actor_id: None,
            origin: request.origin.clone(),
            created_at: None,
            payload,
        })
        .collect();
    let report = commit_events_in_transaction(&tx, &events)?;
    if report.appended != events.len() {
        return Err(CommandError::internal(
            "import events were not all appended",
        ));
    }
    let book = get_book_inner(&tx, book_id)?
        .ok_or_else(|| CommandError::internal("imported book was not projected"))?;
    tx.commit()?;
    Ok(ImportBookOutcome::Imported {
        book,
        cover: staged.cover,
        metadata_deferred: staged.metadata_deferred,
        events,
    })
}

#[cfg(test)]
#[path = "import_tests.rs"]
mod tests;
