//! Which reader a book file needs: by name / MIME first, else by its leading
//! bytes. A port of the web app's `import-format.ts`, `book-format-sniff.ts`
//! and `palmdb-header.ts`; `import_cases/*.json`, generated from those, pins
//! both implementations to the same answers.
use crate::error::CommandError;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub struct FormatCapability {
    pub format: &'static str,
    pub extensions: &'static [&'static str],
    pub mime_types: &'static [&'static str],
}

/// Mirrors `BOOK_IMPORT_FORMATS` in packages/core/src/book-inspection.ts; the
/// first matching entry wins.
pub const BOOK_IMPORT_FORMATS: &[FormatCapability] = &[
    FormatCapability {
        format: "epub",
        extensions: &["epub"],
        mime_types: &["application/epub+zip"],
    },
    FormatCapability {
        format: "pdf",
        extensions: &["pdf"],
        mime_types: &["application/pdf"],
    },
    FormatCapability {
        format: "mobi",
        extensions: &["mobi", "prc"],
        mime_types: &[],
    },
    FormatCapability {
        format: "azw3",
        extensions: &["azw3", "azw", "kf8"],
        mime_types: &[],
    },
    FormatCapability {
        format: "fb2",
        extensions: &["fb2", "fb2.zip", "fbz"],
        mime_types: &["application/x-fictionbook+xml"],
    },
    FormatCapability {
        format: "cbz",
        extensions: &["cbz"],
        mime_types: &["application/vnd.comicbook+zip"],
    },
    FormatCapability {
        format: "cbr",
        extensions: &["cbr"],
        mime_types: &["application/vnd.comicbook-rar"],
    },
    FormatCapability {
        format: "txt",
        extensions: &["txt", "text"],
        mime_types: &["text/plain"],
    },
    FormatCapability {
        format: "html",
        extensions: &["html", "htm", "xhtml"],
        mime_types: &["text/html"],
    },
];

/// Format from the file name / MIME type alone; None when neither says.
pub fn format_from_name(name: &str, mime: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    BOOK_IMPORT_FORMATS
        .iter()
        .find(|entry| {
            entry
                .extensions
                .iter()
                .any(|extension| lower.ends_with(&format!(".{extension}")))
                || (!mime.is_empty() && entry.mime_types.contains(&mime))
        })
        .map(|entry| entry.format)
}

/// Decide a book's format: by name/MIME first (free), else by magic bytes
/// (extension-less Android picks, renamed files). Fails with
/// `book/unsupported-format` when neither recognizes it.
pub fn detect_format(name: &str, mime: &str, path: &Path) -> Result<&'static str, CommandError> {
    if let Some(format) = format_from_name(name, mime) {
        return Ok(format);
    }
    let mut file = File::open(path)?;
    match sniff_format(&mut file) {
        Ok(Some(format)) => Ok(format),
        Ok(None) => Err(unsupported(name)),
        Err(error) => {
            // The name is user content: it reaches the caller in the error,
            // never the log.
            log::warn!("unable to sniff the format of an imported file: {error}");
            Err(unsupported(name))
        }
    }
}

fn unsupported(name: &str) -> CommandError {
    CommandError::new(
        "book/unsupported-format",
        format!("{name} is not a supported book format"),
    )
}

const IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".jxl", ".avif",
];
const HEAD_BYTES: usize = 4096;

/// A readable, seekable book source (a file; a cursor in tests).
pub trait BookBytes: Read + Seek {}
impl<T: Read + Seek> BookBytes for T {}

fn read_at(source: &mut dyn BookBytes, offset: u64, length: usize) -> std::io::Result<Vec<u8>> {
    source.seek(SeekFrom::Start(offset))?;
    let mut buffer = Vec::with_capacity(length);
    source.take(length as u64).read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn total_size(source: &mut dyn BookBytes) -> std::io::Result<u64> {
    source.seek(SeekFrom::End(0))
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty()
        || haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// `slice(start, end)` with JavaScript's clamping.
fn window(bytes: &[u8], start: usize, end: usize) -> &[u8] {
    let end = end.min(bytes.len());
    &bytes[start.min(end)..end]
}

/// Detect a book's format from its leading bytes; None when they match no
/// supported format.
pub fn sniff_format(source: &mut dyn BookBytes) -> std::io::Result<Option<&'static str>> {
    let head = read_at(source, 0, HEAD_BYTES)?;
    if head.len() < 8 {
        return Ok(None);
    }
    // PDF — the spec allows junk before the header, within the first 1024 bytes.
    if contains(window(&head, 0, 1024), b"%PDF-") {
        return Ok(Some("pdf"));
    }
    // ZIP container: decided from the first local file header alone.
    if head.starts_with(&[0x50, 0x4b, 0x03, 0x04]) {
        let name_length = usize::from(head[26]) | (usize::from(head[27]) << 8);
        let first_entry = window(&head, 30, 30 + name_length);
        let lower = first_entry.to_ascii_lowercase();
        if first_entry == b"mimetype" && contains(window(&head, 38, 88), b"application/epub+zip") {
            return Ok(Some("epub"));
        }
        if lower.ends_with(b".fb2") {
            return Ok(Some("fb2"));
        }
        if IMAGE_EXTENSIONS
            .iter()
            .any(|extension| lower.ends_with(extension.as_bytes()))
        {
            return Ok(Some("cbz"));
        }
        return Ok(None);
    }
    // RAR: comic archives are the only RAR files this app reads.
    if head.starts_with(b"Rar!") {
        return Ok(Some("cbr"));
    }
    // PalmDB type/creator code at offset 60.
    let palm_type = window(&head, 60, 68);
    if palm_type == b"BOOKMOBI" {
        return Ok(Some(palm_doc_format(source, &head)));
    }
    if palm_type == b"TEXtREAd" {
        return Ok(Some("mobi"));
    }
    // Bare FictionBook XML (optionally after a BOM / XML declaration).
    if contains(&head, b"<FictionBook") {
        return Ok(Some("fb2"));
    }
    Ok(sniff_textual_format(&head))
}

fn looks_like_html(head: &[u8]) -> bool {
    let start = window(head, 0, 1024).to_ascii_lowercase();
    contains(&start, b"<!doctype html")
        || contains(&start, b"<html")
        || (contains(&start, b"<head") && contains(&start, b"<body"))
}

fn sniff_textual_format(head: &[u8]) -> Option<&'static str> {
    if looks_like_html(head) {
        return Some("html");
    }
    // A truncated multi-byte sequence at the window edge would fail the
    // strict decode, so the last few bytes are dropped first.
    let trimmed = &head[..head.len().saturating_sub(4)];
    if trimmed.len() < 4 {
        return None;
    }
    let text = std::str::from_utf8(trimmed).ok()?;
    // JavaScript's trim also strips the BOM.
    if text
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .is_empty()
    {
        return None;
    }
    if text
        .chars()
        .any(|c| (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r'))
    {
        return None;
    }
    Some("txt")
}

// --- PalmDB: MOBI 6 or KF8 (AZW3) --------------------------------------------

const MAX_RECORD_BYTES: u64 = 128 * 1024;
const EXTH_BOUNDARY_TYPE: u32 = 121;
const NOT_SET: u32 = 0xffff_ffff;
const PDB_RECORD_LIST_OFFSET: usize = 78;
const PDB_RECORD_ENTRY_BYTES: usize = 8;

/// Mirrors `MOBI.open()` in the reading engine so the shelf's label matches
/// the loader that will run: version 8+ is KF8, and a MOBI 6 file with an
/// EXTH boundary record is a combo whose KF8 part the engine prefers. Any
/// malformed header still reads as "mobi", which the loader may recover.
fn palm_doc_format(source: &mut dyn BookBytes, head: &[u8]) -> &'static str {
    match first_record(source, head) {
        Some(record) if is_kf8_record(&record) => "azw3",
        _ => "mobi",
    }
}

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn first_record(source: &mut dyn BookBytes, head: &[u8]) -> Option<Vec<u8>> {
    let records = usize::from(u16_at(head, 76)?);
    if records < 1 {
        return None;
    }
    let list_end = PDB_RECORD_LIST_OFFSET + records * PDB_RECORD_ENTRY_BYTES;
    let read_list;
    let list = if list_end <= head.len() {
        head
    } else {
        read_list = read_at(source, 0, list_end).ok()?;
        &read_list
    };
    if list.len() < PDB_RECORD_LIST_OFFSET + PDB_RECORD_ENTRY_BYTES {
        return None;
    }
    let size = total_size(source).ok()?;
    let start = u64::from(u32_at(list, PDB_RECORD_LIST_OFFSET)?);
    let next = if records > 1 {
        u64::from(u32_at(
            list,
            PDB_RECORD_LIST_OFFSET + PDB_RECORD_ENTRY_BYTES,
        )?)
    } else {
        size
    };
    let end = (if next > start { next } else { size }).min(start + MAX_RECORD_BYTES);
    if end <= start {
        return None;
    }
    read_at(source, start, (end - start) as usize).ok()
}

fn is_kf8_record(record: &[u8]) -> bool {
    // The PalmDOC header takes the first 16 bytes; the MOBI header follows.
    if record.len() < 132 || window(record, 16, 20) != b"MOBI" {
        return false;
    }
    let (Some(version), Some(flags), Some(header_length)) =
        (u32_at(record, 36), u32_at(record, 128), u32_at(record, 20))
    else {
        return false;
    };
    if version >= 8 {
        return true;
    }
    if flags & 0b100_0000 == 0 {
        return false;
    }
    exth_boundary(record, header_length as usize + 16).is_some_and(|boundary| boundary < NOT_SET)
}

/// The EXTH `boundary` record (type 121): where a combo file's KF8 part starts.
fn exth_boundary(record: &[u8], start: usize) -> Option<u32> {
    if start + 12 > record.len() || window(record, start, start + 4) != b"EXTH" {
        return None;
    }
    let count = u32_at(record, start + 8)?;
    let mut offset = start + 12;
    for _ in 0..count {
        if offset + 8 > record.len() {
            return None;
        }
        let kind = u32_at(record, offset)?;
        let length = u32_at(record, offset + 4)? as usize;
        if length < 8 {
            return None;
        }
        if kind == EXTH_BOUNDARY_TYPE {
            return if offset + 12 <= record.len() {
                u32_at(record, offset + 8)
            } else {
                None
            };
        }
        offset += length;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::Cursor;

    #[test]
    fn names_and_mime_types_resolve_like_the_web_importer() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("import_cases/import_format_name_cases.json"))
                .unwrap();
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let mime = case["mime"].as_str().unwrap();
            assert_eq!(
                format_from_name(name, mime),
                case["format"].as_str(),
                "{name} / {mime}"
            );
        }
    }

    #[test]
    fn leading_bytes_sniff_like_the_web_importer() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("import_cases/import_sniff_cases.json")).unwrap();
        for case in cases {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(case["base64"].as_str().unwrap())
                .unwrap();
            assert_eq!(
                sniff_format(&mut Cursor::new(bytes)).unwrap(),
                case["format"].as_str(),
                "{}",
                case["label"]
            );
        }
    }
}
