//! Import-time metadata for the PalmDB family: MOBI 6, KF8 (AZW3), and the
//! "combo" files that carry both.
//!
//! Only record 0 (the headers plus EXTH block) and, at most, the one resource
//! record holding the cover are read — the compressed book text is never
//! touched. The header walk deliberately mirrors `MOBI.open()` in the vendored
//! engine (`apps/web/public/foliate-js/mobi.js`), including its choice to open
//! a combo file's KF8 half, so the shelf shows what the reader will show.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use crate::metadata::{clean, cover_data_url, unescape_entities, BookMetadata};

/// Headers plus EXTH; well short of where the text records begin.
const MAX_RECORD_BYTES: u64 = 256 * 1024;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const NOT_SET: u32 = 0xffff_ffff;

const EXTH_AUTHOR: u32 = 100;
const EXTH_BOUNDARY: u32 = 121;
const EXTH_COVER_OFFSET: u32 = 201;
const EXTH_THUMBNAIL_OFFSET: u32 = 202;
const EXTH_TITLE: u32 = 503;

struct Palm {
    file: File,
    /// Byte range of each PDB record, in file order.
    records: Vec<(u64, u64)>,
}

struct Headers {
    title: Option<String>,
    author: Option<String>,
    version: u32,
    resource_start: u32,
    boundary: Option<u32>,
    cover_offset: Option<u32>,
}

impl Palm {
    fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path)
            .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
        let size = file
            .metadata()
            .map_err(|error| error.to_string())?
            .len();

        let mut header = [0u8; 78];
        file.read_exact(&mut header)
            .map_err(|_| "File is too short to be a PalmDB book".to_owned())?;
        let count = u16::from_be_bytes([header[76], header[77]]) as usize;
        if count == 0 {
            return Err("PalmDB container holds no records".into());
        }

        let mut list = vec![0u8; count * 8];
        file.read_exact(&mut list)
            .map_err(|_| "PalmDB record list is truncated".to_owned())?;
        let starts: Vec<u64> = (0..count)
            .map(|index| {
                let at = index * 8;
                u32::from_be_bytes([list[at], list[at + 1], list[at + 2], list[at + 3]]) as u64
            })
            .collect();
        let records = starts
            .iter()
            .enumerate()
            .map(|(index, start)| {
                let end = starts.get(index + 1).copied().unwrap_or(size);
                (*start, end.max(*start))
            })
            .collect();

        Ok(Self { file, records })
    }

    fn read_record(&mut self, index: usize, max_bytes: u64) -> Result<Vec<u8>, String> {
        let (start, end) = *self
            .records
            .get(index)
            .ok_or_else(|| format!("PalmDB record {index} is out of range"))?;
        let length = (end - start).min(max_bytes) as usize;
        self.file
            .seek(SeekFrom::Start(start))
            .map_err(|error| error.to_string())?;
        let mut bytes = vec![0u8; length];
        self.file
            .read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn parse_headers(record: &[u8]) -> Result<Headers, String> {
    // PalmDOC header occupies the first 16 bytes; the MOBI header follows.
    if record.get(16..20) != Some(b"MOBI") {
        return Err("Missing MOBI header".into());
    }
    let mobi_length = read_u32(record, 20).ok_or("Truncated MOBI header")?;
    let encoding = read_u32(record, 28).unwrap_or(65001);
    let version = read_u32(record, 36).unwrap_or(0);
    let title_offset = read_u32(record, 84).unwrap_or(0) as usize;
    let title_length = read_u32(record, 88).unwrap_or(0) as usize;
    let resource_start = read_u32(record, 108).unwrap_or(NOT_SET);
    let exth_flag = read_u32(record, 128).unwrap_or(0);

    let header_title = record
        .get(title_offset..title_offset.saturating_add(title_length))
        .and_then(|bytes| clean(decode(bytes, encoding)));

    let mut headers = Headers {
        title: header_title,
        author: None,
        version,
        resource_start,
        boundary: None,
        cover_offset: None,
    };

    if exth_flag & 0b100_0000 != 0 {
        let start = mobi_length as usize + 16;
        read_exth(record, start, encoding, &mut headers);
    }
    Ok(headers)
}

fn read_exth(record: &[u8], start: usize, encoding: u32, headers: &mut Headers) {
    if record.get(start..start + 4) != Some(b"EXTH") {
        return;
    }
    let Some(count) = read_u32(record, start + 8) else {
        return;
    };
    let mut offset = start + 12;
    let mut thumbnail = None;
    for _ in 0..count {
        let Some(kind) = read_u32(record, offset) else {
            break;
        };
        let Some(length) = read_u32(record, offset + 4) else {
            break;
        };
        if length < 8 {
            break;
        }
        let data = match record.get(offset + 8..offset + length as usize) {
            Some(data) => data,
            None => break,
        };
        match kind {
            EXTH_TITLE => headers.title = clean(unescape_entities(&decode(data, encoding))),
            EXTH_AUTHOR if headers.author.is_none() => {
                headers.author = clean(unescape_entities(&decode(data, encoding)));
            }
            EXTH_BOUNDARY => headers.boundary = read_u32(data, 0),
            EXTH_COVER_OFFSET => headers.cover_offset = read_u32(data, 0),
            EXTH_THUMBNAIL_OFFSET => thumbnail = read_u32(data, 0),
            _ => {}
        }
        offset += length as usize;
    }
    // A cover proper is preferred; the thumbnail is the documented fallback.
    if headers.cover_offset.filter(|value| *value < NOT_SET).is_none() {
        headers.cover_offset = thumbnail;
    }
}

/// MOBI declares its text encoding as a code page: UTF-8 or CP1252.
fn decode(bytes: &[u8], encoding: u32) -> String {
    if encoding == 65001 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    bytes.iter().map(|byte| cp1252_char(*byte)).collect()
}

fn cp1252_char(byte: u8) -> char {
    // 0x80..=0x9F is where CP1252 departs from Latin-1; the rest is identical.
    const HIGH: [char; 32] = [
        '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}',
        '\u{017D}', '\u{FFFD}', '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
        '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
    ];
    match byte {
        0x80..=0x9f => HIGH[(byte - 0x80) as usize],
        other => other as char,
    }
}

pub fn extract_mobi_metadata_from_path(path: &Path) -> Result<BookMetadata, String> {
    let mut palm = Palm::open(path)?;
    let record_zero = palm.read_record(0, MAX_RECORD_BYTES)?;
    let base = parse_headers(&record_zero)?;
    // The resource base stays the one declared by record 0 even for a combo
    // file — the same choice the engine makes when it loads cover resources.
    let resource_start = base.resource_start;

    let mut headers = base;
    if headers.version < 8 {
        if let Some(boundary) = headers.boundary.filter(|value| *value < NOT_SET) {
            // A combo MOBI/KF8: the engine opens the KF8 half, so its metadata
            // is the metadata the reader will show.
            if let Ok(record) = palm.read_record(boundary as usize, MAX_RECORD_BYTES) {
                if let Ok(kf8) = parse_headers(&record) {
                    headers = kf8;
                }
            }
        }
    }

    let cover_url = headers
        .cover_offset
        .filter(|offset| *offset < NOT_SET)
        .filter(|_| resource_start < NOT_SET)
        .and_then(|offset| {
            let index = resource_start.checked_add(offset)? as usize;
            let bytes = palm.read_record(index, MAX_COVER_BYTES).ok()?;
            cover_data_url(&bytes)
        });

    Ok(BookMetadata {
        title: headers.title,
        author: headers.author,
        cover_url,
    })
}

#[tauri::command]
pub async fn extract_mobi_metadata(path: String) -> Result<BookMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || extract_mobi_metadata_from_path(Path::new(&path)))
        .await
        .map_err(|error| format!("extract_mobi_metadata task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    const MOBI_HEADER_LENGTH: u32 = 232;

    struct ExthRecord {
        kind: u32,
        payload: Vec<u8>,
    }

    fn exth(records: &[ExthRecord]) -> Vec<u8> {
        let body_length: usize = records.iter().map(|record| 8 + record.payload.len()).sum();
        let mut bytes = Vec::with_capacity(12 + body_length);
        bytes.extend_from_slice(b"EXTH");
        bytes.extend_from_slice(&((12 + body_length) as u32).to_be_bytes());
        bytes.extend_from_slice(&(records.len() as u32).to_be_bytes());
        for record in records {
            bytes.extend_from_slice(&record.kind.to_be_bytes());
            bytes.extend_from_slice(&((8 + record.payload.len()) as u32).to_be_bytes());
            bytes.extend_from_slice(&record.payload);
        }
        bytes
    }

    fn record_zero(version: u32, title: &str, records: &[ExthRecord]) -> Vec<u8> {
        let exth_bytes = if records.is_empty() {
            Vec::new()
        } else {
            exth(records)
        };
        let title_offset = 16 + MOBI_HEADER_LENGTH as usize + exth_bytes.len();
        let mut record = vec![0u8; title_offset + title.len()];
        record[16..20].copy_from_slice(b"MOBI");
        record[20..24].copy_from_slice(&MOBI_HEADER_LENGTH.to_be_bytes());
        record[28..32].copy_from_slice(&65001u32.to_be_bytes());
        record[36..40].copy_from_slice(&version.to_be_bytes());
        record[84..88].copy_from_slice(&(title_offset as u32).to_be_bytes());
        record[88..92].copy_from_slice(&(title.len() as u32).to_be_bytes());
        // Resource records start right after record 0 and the text record.
        record[108..112].copy_from_slice(&2u32.to_be_bytes());
        record[128..132].copy_from_slice(&if records.is_empty() { 0u32 } else { 0b100_0000 }.to_be_bytes());
        if !exth_bytes.is_empty() {
            record[16 + MOBI_HEADER_LENGTH as usize..title_offset].copy_from_slice(&exth_bytes);
        }
        record[title_offset..].copy_from_slice(title.as_bytes());
        record
    }

    fn write_palm(path: &Path, records: &[Vec<u8>]) {
        let mut bytes = vec![0u8; 78];
        bytes[60..64].copy_from_slice(b"BOOK");
        bytes[64..68].copy_from_slice(b"MOBI");
        bytes[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
        let mut offset = 78 + records.len() * 8;
        for record in records {
            bytes.extend_from_slice(&(offset as u32).to_be_bytes());
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            offset += record.len();
        }
        for record in records {
            bytes.extend_from_slice(record);
        }
        File::create(path).unwrap().write_all(&bytes).unwrap();
    }

    const JPEG: [u8; 6] = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02];

    #[test]
    fn reads_title_author_and_cover_without_touching_text_records() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        let zero = record_zero(
            6,
            "Header Title",
            &[
                ExthRecord { kind: EXTH_TITLE, payload: b"EXTH &amp; Title".to_vec() },
                ExthRecord { kind: EXTH_AUTHOR, payload: b"A. Writer".to_vec() },
                ExthRecord { kind: EXTH_COVER_OFFSET, payload: 0u32.to_be_bytes().to_vec() },
            ],
        );
        // record 1 is book text, record 2 is the first resource (the cover).
        write_palm(&path, &[zero, vec![b'x'; 4096], JPEG.to_vec()]);

        let metadata = extract_mobi_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("EXTH & Title"));
        assert_eq!(metadata.author.as_deref(), Some("A. Writer"));
        assert!(metadata.cover_url.unwrap().starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn falls_back_to_the_palmdb_title_when_there_is_no_exth() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        write_palm(&path, &[record_zero(6, "Header Title", &[]), vec![b'x'; 16]]);

        let metadata = extract_mobi_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Header Title"));
        assert_eq!(metadata.author, None);
        assert_eq!(metadata.cover_url, None);
    }

    #[test]
    fn a_combo_file_reports_the_kf8_halfs_metadata() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        let zero = record_zero(
            6,
            "MOBI 6 Title",
            &[
                ExthRecord { kind: EXTH_TITLE, payload: b"MOBI 6 Title".to_vec() },
                ExthRecord { kind: EXTH_BOUNDARY, payload: 2u32.to_be_bytes().to_vec() },
            ],
        );
        let kf8 = record_zero(
            8,
            "KF8 Title",
            &[ExthRecord { kind: EXTH_TITLE, payload: b"KF8 Title".to_vec() }],
        );
        write_palm(&path, &[zero, vec![b'x'; 32], kf8]);

        let metadata = extract_mobi_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("KF8 Title"));
    }

    #[test]
    fn a_non_image_resource_is_not_offered_as_a_cover() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        let zero = record_zero(
            6,
            "Title",
            &[ExthRecord { kind: EXTH_COVER_OFFSET, payload: 0u32.to_be_bytes().to_vec() }],
        );
        write_palm(&path, &[zero, vec![b'x'; 16], b"FONT\0\0\0\0".to_vec()]);

        assert_eq!(extract_mobi_metadata_from_path(&path).unwrap().cover_url, None);
    }
}
