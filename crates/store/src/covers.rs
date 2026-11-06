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
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

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

/// Shortest side an in-book image must have to stand in as a cover when the
/// book declares none. Rules out spacer GIFs, drop caps and ornaments while
/// letting a modest frontispiece through.
pub const FALLBACK_MIN_SIDE: u32 = 120;

/// Whether bytes could serve as a fallback cover: a decodable raster at
/// least [`FALLBACK_MIN_SIDE`] on its shorter side, or a small SVG.
pub fn plausible_cover(bytes: &[u8]) -> bool {
    if image_mime(bytes) == Some("image/svg+xml") {
        return bytes.len() <= SVG_MAX_BYTES;
    }
    match image::load_from_memory(bytes) {
        Ok(decoded) => decoded.width().min(decoded.height()) >= FALLBACK_MIN_SIDE,
        Err(_) => false,
    }
}

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
    let keepable = matches!(
        sniffed,
        Some("image/jpeg") | Some("image/png") | Some("image/webp")
    );
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
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
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
    let mime = image_mime(&bytes)
        .map(str::to_owned)
        .unwrap_or_else(|| mime.to_owned());
    Some(CoverImage { bytes, mime })
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

/// What restoring a cover that is on record but missing here did.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalCoverRestore {
    /// Extracted again from this device's copy of the book and stored under
    /// the book's cover key.
    Restored,
    /// The book file is here, but only the reading engine extracts its cover
    /// (PDFs without a native render, RAR comics, containers the native
    /// parser rejects): the webview's engine job takes over.
    Engine,
    /// Nothing to restore locally: no cover on record, its bytes are already
    /// here, the book file is not, or the file yields no cover.
    Unavailable,
}

/// The local file of a book whose cover is on record (`ready`) but whose
/// cover bytes are not on this device — a cover the relay never delivered, a
/// restore that brought the book but not its artwork. The cover is content
/// derived from that file, so it can be derived again here instead of waiting
/// on sync; the verdict itself does not change, so no event is written.
pub fn local_cover_source(
    conn: &Connection,
    data_dir: &Path,
    book_id: &str,
) -> Result<Option<(PathBuf, String)>, CommandError> {
    let row: Option<(String, bool)> = conn
        .query_row(
            "SELECT b.format, bo.storage_uri IS NOT NULL FROM books b
               LEFT JOIN blob_objects bo ON bo.key = b.cover_blob_key AND bo.deleted_at IS NULL
              WHERE b.id = ?1 AND b.cover_status = 'ready' AND b.cover_blob_key IS NOT NULL",
            params![book_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((format, present)) = row else {
        return Ok(None);
    };
    if present {
        return Ok(None);
    }
    Ok(
        get_blob_record_inner(conn, data_dir, &format!("bookfile:{book_id}"))?
            .map(|(path, _)| (path, format)),
    )
}

/// A cover extracted again from a book file, with the import's extractors.
#[derive(Debug, PartialEq)]
pub enum DerivedCover {
    Cover(NormalizedCover),
    Engine,
    None,
}

pub fn derive_cover_from_file(path: &Path, format: &str) -> DerivedCover {
    match crate::import::extractor_for(format) {
        crate::import::Extractor::NoCover => DerivedCover::None,
        crate::import::Extractor::EngineOnly => DerivedCover::Engine,
        crate::import::Extractor::Native(extract) => match extract(path) {
            Ok(metadata) => match metadata.cover.as_ref().and_then(normalize_cover) {
                Some(cover) => DerivedCover::Cover(cover),
                // As at import: page one of a PDF is still the engine's to render.
                None if format == "pdf" => DerivedCover::Engine,
                None => DerivedCover::None,
            },
            Err(error) => {
                log::warn!(
                    "native {format} cover extraction failed for {}: {error}",
                    path.display()
                );
                DerivedCover::Engine
            }
        },
    }
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

    fn library(dir: &Path) -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::storage::register_sql_functions(&conn).unwrap();
        crate::storage::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at,cover_status,cover_blob_key)
             VALUES ('b','Refactoring','Martin Fowler','epub','refactoring.epub',1,'now','now','ready','cover:b')",
            [],
        )
        .unwrap();
        // The verdict arrived; the bytes never did (a manifest-only row).
        conn.execute(
            "INSERT INTO blob_objects(key,kind,sync_required,created_at) VALUES ('cover:b','cover_image',1,'now')",
            [],
        )
        .unwrap();
        crate::storage::put_blob_inner(
            &conn,
            dir,
            "bookfile:b",
            None,
            &refactoring_shaped_epub(dir),
        )
        .unwrap();
        conn
    }

    /// Refactoring's package: the EPUB 2 meta names the cover image by path,
    /// and the guide's cover reference is the page that shows it.
    fn refactoring_shaped_epub(dir: &Path) -> Vec<u8> {
        use std::io::Write;
        let path = dir.join("source.epub");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let files: [(&str, Vec<u8>); 4] = [
            ("META-INF/container.xml", br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#.to_vec()),
            ("OEBPS/content.opf", br#"<package><metadata><dc:title xmlns:dc="dc">Refactoring</dc:title><meta name="cover" content="Images/front.png"/></metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="img_front" href="Images/front.png" media-type="image/png"/></manifest><spine><itemref idref="cover"/></spine><guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide></package>"#.to_vec()),
            ("OEBPS/cover.xhtml", br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="Cover"><img src="Images/front.png"/></div></body></html>"#.to_vec()),
            ("OEBPS/Images/front.png", png(300, 450)),
        ];
        for (name, bytes) in files {
            writer.start_file(name, options).unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap();
        std::fs::read(&path).unwrap()
    }

    #[test]
    fn a_cover_on_record_but_missing_here_is_derived_again_from_the_local_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = library(dir.path());
        let (path, format) = local_cover_source(&conn, dir.path(), "b")
            .unwrap()
            .expect("restorable");
        let DerivedCover::Cover(cover) = derive_cover_from_file(&path, &format) else {
            panic!("the local file yields its cover");
        };
        assert_eq!(cover.mime, "image/png");
        store_cover(&conn, dir.path(), "b", &cover).unwrap();
        // Restored: the shelf's backlog no longer lists it, nor does a second pass.
        assert!(cover_backlog_inner(&conn).unwrap().is_empty());
        assert_eq!(local_cover_source(&conn, dir.path(), "b").unwrap(), None);
    }

    #[test]
    fn only_a_ready_cover_with_absent_bytes_and_a_local_file_is_restorable() {
        let dir = tempfile::tempdir().unwrap();
        let conn = library(dir.path());
        assert!(local_cover_source(&conn, dir.path(), "b")
            .unwrap()
            .is_some());
        conn.execute(
            "UPDATE blob_objects SET deleted_at='now' WHERE key='bookfile:b'",
            [],
        )
        .unwrap();
        assert_eq!(
            local_cover_source(&conn, dir.path(), "b").unwrap(),
            None,
            "no local file"
        );
        conn.execute(
            "UPDATE blob_objects SET deleted_at=NULL WHERE key='bookfile:b'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE books SET cover_status='none', cover_blob_key=NULL WHERE id='b'",
            [],
        )
        .unwrap();
        assert_eq!(
            local_cover_source(&conn, dir.path(), "b").unwrap(),
            None,
            "no cover on record"
        );
        assert_eq!(
            local_cover_source(&conn, dir.path(), "missing").unwrap(),
            None
        );
    }

    #[test]
    fn formats_without_a_native_cover_defer_to_the_engine_or_have_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book");
        std::fs::write(&path, b"not a container").unwrap();
        assert_eq!(derive_cover_from_file(&path, "cbr"), DerivedCover::Engine);
        assert_eq!(derive_cover_from_file(&path, "txt"), DerivedCover::None);
        // A container the native parser rejects is still the engine's to try.
        assert_eq!(derive_cover_from_file(&path, "epub"), DerivedCover::Engine);
    }

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
        let cover = CoverImage {
            bytes: bytes.clone(),
            mime: "image/png".into(),
        };
        let normalized = normalize_cover(&cover).unwrap();
        assert_eq!(normalized.bytes, bytes);
        assert_eq!(normalized.mime, "image/png");
    }

    #[test]
    fn oversized_covers_shrink_into_the_box_as_jpeg() {
        let cover = CoverImage {
            bytes: png(2400, 3600),
            mime: "image/png".into(),
        };
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
        let cover = CoverImage {
            bytes: png(2400, 3600),
            mime: "image/png".into(),
        };
        let started = std::time::Instant::now();
        let normalized = normalize_cover(&cover).unwrap();
        eprintln!(
            "normalize 2400x3600 PNG → {} bytes in {} ms",
            normalized.bytes.len(),
            started.elapsed().as_millis()
        );
    }

    #[test]
    fn plausibility_rejects_ornaments_and_accepts_frontispieces() {
        assert!(!plausible_cover(&png(40, 40)));
        assert!(!plausible_cover(&png(600, 8)));
        assert!(plausible_cover(&png(200, 300)));
        assert!(!plausible_cover(b"not an image"));
    }

    #[test]
    fn undecodable_bytes_are_not_a_cover() {
        let cover = CoverImage {
            bytes: b"FONT\0\0\0\0".to_vec(),
            mime: "font/ttf".into(),
        };
        assert_eq!(normalize_cover(&cover), None);
    }

    #[test]
    fn small_svg_passes_through() {
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec();
        let cover = CoverImage {
            bytes: svg.clone(),
            mime: "image/svg+xml".into(),
        };
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
