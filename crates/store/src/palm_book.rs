//! A Palm database book (MOBI, AZW3/KF8), read where the file is.
//!
//! The reading engine used to receive the whole file in the webview and do
//! everything there: PalmDOC and HUFF/CDIC decompression a byte at a time in
//! JavaScript, and every image copied into a Blob before its page could load.
//! Here the file stays where it is stored. The engine asks for records by
//! index, for text records already decompressed, and leaves images and fonts
//! to be fetched by URL.
//!
//! This is a codec, not a second parser. The engine still reads the headers,
//! the indexes and the markup, and it tells this module how the text is coded
//! (`TextCoding`, taken from the headers it parsed): which half of a combo
//! file is read, where a section starts and what a link points at are decided
//! in one place. Every routine here mirrors the engine's own
//! (`foliate-js/src/mobi-binary.ts`) and must keep producing the same bytes.
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use crate::error::CommandError;

const PDB_HEADER_BYTES: u64 = 78;
/// A Palm database addresses its records with a 16-bit count.
const MAX_RECORDS: usize = u16::MAX as usize;
/// One record read whole: text records are 4 KiB, a resource is an image.
const MAX_RECORD_BYTES: u64 = 256 * 1024 * 1024;
/// One answer to a request for several records, raw or decompressed.
const MAX_RESPONSE_BYTES: usize = 256 * 1024 * 1024;
/// A text record decompresses to its record size (4 KiB in practice); far
/// past that, the record is not text.
const MAX_TEXT_RECORD_BYTES: usize = 16 * 1024 * 1024;
/// An embedded font after inflation.
const MAX_FONT_BYTES: usize = 128 * 1024 * 1024;
/// Dictionary entries may be compressed with the dictionary itself; real
/// tables nest a few levels, and the native stack is not the place to find
/// out how deep a crafted one goes.
const MAX_HUFF_DEPTH: usize = 256;

const COMPRESSION_NONE: u32 = 1;
const COMPRESSION_PALMDOC: u32 = 2;
const COMPRESSION_HUFFCDIC: u32 = 17480;

/// The file is there but is not what its format says: damaged, truncated or hostile.
fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new("book/parse-failed", message.into())
}

fn be_u16(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u32::from(u16::from_be_bytes([slice[0], slice[1]])))
}

fn be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// How the engine's headers say the text records are coded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextCoding {
    /// PalmDOC header `compression`: 1 stored, 2 PalmDOC, 17480 HUFF/CDIC.
    pub compression: u32,
    /// MOBI header `trailingFlags`: bit 0 says a record ends with the tail
    /// of a multibyte character, every other set bit is one trailing entry.
    pub trailing_flags: u32,
    /// First HUFF record (absolute index) and how many records the
    /// HUFF/CDIC tables span. Read only for HUFF/CDIC text.
    pub huffcdic: u32,
    pub huffcdic_count: u32,
}

struct HuffEntry {
    value: Vec<u8>,
    decompressed: bool,
    /// Being expanded right now: an entry that reaches itself never ends.
    expanding: bool,
}

struct HuffTables {
    /// Indexed by the next byte: (terminal, code length, value).
    first: Vec<(bool, u32, u32)>,
    /// Indexed by code length - 1: (lower bound, base value).
    second: Vec<(u32, u32)>,
    dictionary: Vec<HuffEntry>,
}

pub struct PalmBook {
    file: File,
    /// Start and end of every record, in file order.
    records: Vec<(u64, u64)>,
    huff: HashMap<(u32, u32), HuffTables>,
}

impl PalmBook {
    pub fn open(path: &Path) -> Result<Self, CommandError> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        let mut header = [0u8; PDB_HEADER_BYTES as usize];
        file.read_exact(&mut header)
            .map_err(|_| invalid("Book file is not a Palm database"))?;
        let count = usize::from(u16::from_be_bytes([header[76], header[77]]));
        if count == 0 || count > MAX_RECORDS {
            return Err(invalid("Palm database has no records"));
        }
        let mut table = vec![0u8; count * 8];
        file.read_exact(&mut table)
            .map_err(|_| invalid("Palm database record table is truncated"))?;
        let starts: Vec<u64> = (0..count)
            .map(|index| u64::from(be_u32(&table, index * 8).unwrap_or(0)))
            .collect();
        let first = PDB_HEADER_BYTES + (count as u64) * 8;
        let mut records = Vec::with_capacity(count);
        for (index, &start) in starts.iter().enumerate() {
            let end = starts.get(index + 1).copied().unwrap_or(size);
            if start < first || end < start || end > size {
                return Err(invalid("Invalid Palm database record offsets"));
            }
            records.push((start, end));
        }
        Ok(Self {
            file,
            records,
            huff: HashMap::new(),
        })
    }

    /// The byte length of every record, in file order.
    pub fn record_lengths(&self) -> Vec<u64> {
        self.records
            .iter()
            .map(|(start, end)| end - start)
            .collect()
    }

    fn range(&self, index: usize) -> Result<(u64, u64), CommandError> {
        self.records
            .get(index)
            .copied()
            .ok_or_else(|| invalid(format!("Palm database has no record {index}")))
    }

    fn read_at(&mut self, start: u64, length: usize) -> Result<Vec<u8>, CommandError> {
        let mut bytes = vec![0u8; length];
        // The record table was checked against the file's size: a short read is the file changing.
        self.file.seek(SeekFrom::Start(start))?;
        self.file.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    /// One record's bytes as stored.
    pub fn record(&mut self, index: usize) -> Result<Vec<u8>, CommandError> {
        let (start, end) = self.range(index)?;
        if end - start > MAX_RECORD_BYTES {
            return Err(invalid(format!(
                "Palm database record {index} exceeds the record limit"
            )));
        }
        self.read_at(start, (end - start) as usize)
    }

    /// The first four bytes of every record where they are a record tag —
    /// capitals and digits (`INDX`, `FDST`, `RESC`, `FONT`…) — which is how
    /// the engine finds the records the headers do not point at. Empty for
    /// anything else: a text record's first bytes are the book's words.
    pub fn record_magics(&mut self) -> Result<Vec<String>, CommandError> {
        let mut magics = Vec::with_capacity(self.records.len());
        for index in 0..self.records.len() {
            let (start, end) = self.records[index];
            if end - start < 4 {
                magics.push(String::new());
                continue;
            }
            let head = self.read_at(start, 4)?;
            magics.push(
                if head
                    .iter()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                {
                    String::from_utf8_lossy(&head).into_owned()
                } else {
                    String::new()
                },
            );
        }
        Ok(magics)
    }

    fn check_span(&self, first: usize, last: usize) -> Result<(), CommandError> {
        if first > last || last >= self.records.len() {
            return Err(invalid(format!(
                "Palm database has no records {first}-{last}"
            )));
        }
        Ok(())
    }

    /// Records `first..=last` as stored, for the engine's indexes.
    pub fn records(&mut self, first: usize, last: usize) -> Result<Vec<Vec<u8>>, CommandError> {
        self.check_span(first, last)?;
        let total = self.records[last].1 - self.records[first].0;
        if total > MAX_RESPONSE_BYTES as u64 {
            return Err(invalid("Palm database record range exceeds the limit"));
        }
        (first..=last).map(|index| self.record(index)).collect()
    }

    /// Text records `first..=last` (absolute record indexes), each with its
    /// trailing entries removed and decompressed: what the engine's
    /// `MOBI.loadText` returns for the same record.
    pub fn text_records(
        &mut self,
        first: usize,
        last: usize,
        coding: TextCoding,
    ) -> Result<Vec<Vec<u8>>, CommandError> {
        self.check_span(first, last)?;
        if !matches!(
            coding.compression,
            COMPRESSION_NONE | COMPRESSION_PALMDOC | COMPRESSION_HUFFCDIC
        ) {
            return Err(invalid("Unknown MOBI compression type"));
        }
        if coding.compression == COMPRESSION_HUFFCDIC {
            self.load_huff_tables(coding)?;
        }
        let mut out = Vec::with_capacity(last - first + 1);
        let mut total = 0usize;
        for index in first..=last {
            let record = self.record(index)?;
            let body = without_trailing_entries(&record, coding.trailing_flags)?;
            let text = match coding.compression {
                COMPRESSION_NONE => body.to_vec(),
                COMPRESSION_PALMDOC => decompress_palmdoc(body)?,
                _ => {
                    let tables = self
                        .huff
                        .get_mut(&(coding.huffcdic, coding.huffcdic_count))
                        .ok_or_else(|| invalid("HUFF/CDIC tables are not loaded"))?;
                    tables.decompress(body, 0)?
                }
            };
            total += text.len();
            if total > MAX_RESPONSE_BYTES {
                return Err(invalid("MOBI text range exceeds the limit"));
            }
            out.push(text);
        }
        Ok(out)
    }

    fn load_huff_tables(&mut self, coding: TextCoding) -> Result<(), CommandError> {
        let key = (coding.huffcdic, coding.huffcdic_count);
        if self.huff.contains_key(&key) {
            return Ok(());
        }
        let first = coding.huffcdic as usize;
        let count = coding.huffcdic_count as usize;
        if count == 0 || first.saturating_add(count) > self.records.len() {
            return Err(invalid("Invalid HUFF record"));
        }
        let huff = self.record(first)?;
        let dictionaries = (1..count)
            .map(|offset| self.record(first + offset))
            .collect::<Result<Vec<_>, _>>()?;
        self.huff
            .insert(key, HuffTables::parse(&huff, &dictionaries)?);
        Ok(())
    }

    /// A resource record as a page uses it: a `FONT` record deobfuscated and
    /// inflated, an `AUDI`/`VIDE` record without its header, anything else
    /// (an image) as stored. The engine's `MOBI.loadResource`.
    pub fn resource(&mut self, index: usize) -> Result<Vec<u8>, CommandError> {
        let record = self.record(index)?;
        Ok(match record.get(0..4) {
            Some(b"FONT") => decode_font(&record)?,
            Some(b"VIDE") | Some(b"AUDI") => record.get(12..).unwrap_or_default().to_vec(),
            _ => record,
        })
    }
}

/// The value of a backward variable-length integer at the end of `bytes`.
fn var_len_from_end(bytes: &[u8]) -> usize {
    let mut value = 0usize;
    for &byte in &bytes[bytes.len().saturating_sub(4)..] {
        // The high bit marks the first byte of the value.
        if byte & 0x80 != 0 {
            value = 0;
        }
        value = (value << 7) | usize::from(byte & 0x7f);
    }
    value
}

/// A text record without the entries appended after its text.
fn without_trailing_entries(record: &[u8], trailing_flags: u32) -> Result<&[u8], CommandError> {
    let mut body = record;
    for _ in 0..(trailing_flags >> 1).count_ones() {
        let length = var_len_from_end(body);
        if length == 0 || length > body.len() {
            return Err(invalid("Invalid MOBI trailing entry length"));
        }
        body = &body[..body.len() - length];
    }
    if trailing_flags & 1 != 0 {
        // The low two bits of the last byte count the bytes of a character
        // that continues into the next record.
        let length = usize::from(body.last().copied().unwrap_or(0) & 0b11) + 1;
        body = &body[..body.len().saturating_sub(length)];
    }
    Ok(body)
}

fn decompress_palmdoc(input: &[u8]) -> Result<Vec<u8>, CommandError> {
    let mut output = Vec::with_capacity(input.len() * 2);
    let mut index = 0;
    while index < input.len() {
        let byte = input[index];
        match byte {
            0 => output.push(0),
            1..=8 => {
                // The next 1-8 bytes are literals.
                let length = usize::from(byte);
                if index + length >= input.len() {
                    return Err(invalid("Truncated PalmDOC literal"));
                }
                output.extend_from_slice(&input[index + 1..=index + length]);
                index += length;
            }
            9..=0x7f => output.push(byte),
            0x80..=0xbf => {
                // A length-distance pair over two bytes: 11 bits of distance, 3 of length.
                if index + 1 >= input.len() {
                    return Err(invalid("Truncated PalmDOC back-reference"));
                }
                let pair = (usize::from(byte) << 8) | usize::from(input[index + 1]);
                index += 1;
                let distance = (pair & 0x3fff) >> 3;
                if distance == 0 || distance > output.len() {
                    return Err(invalid("Invalid PalmDOC back-reference"));
                }
                for _ in 0..(pair & 0b111) + 3 {
                    output.push(output[output.len() - distance]);
                }
            }
            // A space followed by the character with its high bit cleared.
            _ => output.extend_from_slice(&[b' ', byte ^ 0x80]),
        }
        index += 1;
        if output.len() > MAX_TEXT_RECORD_BYTES {
            return Err(invalid("PalmDOC text record exceeds the limit"));
        }
    }
    Ok(output)
}

/// The 32 bits starting at bit `from`, zero past the end of `bytes`.
fn read_32_bits(bytes: &[u8], from: usize) -> u32 {
    let start = from >> 3;
    let end = from + 32;
    let mut bits = 0u64;
    for index in start..=(end >> 3) {
        bits = (bits << 8) | u64::from(bytes.get(index).copied().unwrap_or(0));
    }
    ((bits >> (8 - (end & 7))) & 0xffff_ffff) as u32
}

impl HuffTables {
    fn parse(huff: &[u8], dictionaries: &[Vec<u8>]) -> Result<Self, CommandError> {
        if huff.get(0..4) != Some(b"HUFF") {
            return Err(invalid("Invalid HUFF record"));
        }
        let bad = || invalid("Invalid HUFF record");
        let offset1 = be_u32(huff, 8).ok_or_else(bad)? as usize;
        let offset2 = be_u32(huff, 12).ok_or_else(bad)? as usize;
        let first = (0..256)
            .map(|index| {
                let entry = be_u32(huff, offset1 + index * 4).ok_or_else(bad)?;
                Ok((entry & 0x80 != 0, entry & 0x1f, entry >> 8))
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        let second = (0..32)
            .map(|index| {
                let offset = offset2 + index * 8;
                Ok((
                    be_u32(huff, offset).ok_or_else(bad)?,
                    be_u32(huff, offset + 4).ok_or_else(bad)?,
                ))
            })
            .collect::<Result<Vec<_>, CommandError>>()?;

        let mut dictionary = Vec::new();
        for record in dictionaries {
            let bad = || invalid("Invalid CDIC record");
            if record.get(0..4) != Some(b"CDIC") {
                return Err(bad());
            }
            let header = be_u32(record, 4).ok_or_else(bad)? as usize;
            let entries = be_u32(record, 8).ok_or_else(bad)? as usize;
            let code_length = be_u32(record, 12).ok_or_else(bad)?;
            // `entries` counts the whole dictionary; this record holds what its code length addresses.
            let here = 1usize
                .checked_shl(code_length)
                .ok_or_else(bad)?
                .min(entries.saturating_sub(dictionary.len()));
            let data = record.get(header..).ok_or_else(bad)?;
            for index in 0..here {
                let offset = be_u16(data, index * 2).ok_or_else(bad)? as usize;
                let head = be_u16(data, offset).ok_or_else(bad)?;
                let length = (head & 0x7fff) as usize;
                let start = (offset + 2).min(data.len());
                let end = (offset + 2 + length).min(data.len());
                dictionary.push(HuffEntry {
                    value: data[start..end].to_vec(),
                    decompressed: head & 0x8000 != 0,
                    expanding: false,
                });
            }
        }
        Ok(Self {
            first,
            second,
            dictionary,
        })
    }

    fn decompress(&mut self, input: &[u8], depth: usize) -> Result<Vec<u8>, CommandError> {
        if depth > MAX_HUFF_DEPTH {
            return Err(invalid("Invalid recursive CDIC reference"));
        }
        let mut output = Vec::new();
        let bit_length = input.len() * 8;
        let mut position = 0;
        while position < bit_length {
            let bits = read_32_bits(input, position);
            let (terminal, mut code_length, mut value) = self.first[(bits >> 24) as usize];
            if code_length == 0 {
                return Err(invalid("Invalid HUFF code length"));
            }
            if !terminal {
                while code_length <= 32
                    && (bits >> (32 - code_length)) < self.second[code_length as usize - 1].0
                {
                    code_length += 1;
                }
                if code_length > 32 {
                    return Err(invalid("HUFF code exceeds 32 bits"));
                }
                value = self.second[code_length as usize - 1].1;
            }
            position += code_length as usize;
            if position > bit_length {
                break;
            }
            let code = value
                .checked_sub(bits >> (32 - code_length))
                .map(|code| code as usize)
                .filter(|&code| code < self.dictionary.len())
                .ok_or_else(|| invalid("Invalid recursive CDIC reference"))?;
            if self.dictionary[code].expanding {
                return Err(invalid("Invalid recursive CDIC reference"));
            }
            if !self.dictionary[code].decompressed {
                // The entry is itself compressed: expand it once and keep the result.
                self.dictionary[code].expanding = true;
                let packed = std::mem::take(&mut self.dictionary[code].value);
                let expanded = self.decompress(&packed, depth + 1);
                let entry = &mut self.dictionary[code];
                entry.expanding = false;
                match expanded {
                    Ok(value) => {
                        entry.value = value;
                        entry.decompressed = true;
                    }
                    Err(error) => {
                        entry.value = packed;
                        return Err(error);
                    }
                }
            }
            output.extend_from_slice(&self.dictionary[code].value);
            if output.len() > MAX_TEXT_RECORD_BYTES {
                return Err(invalid("HUFF/CDIC text record exceeds the limit"));
            }
        }
        Ok(output)
    }
}

/// A `FONT` record's font: deobfuscated, then inflated when the record says
/// it is compressed. A font that does not inflate is returned as it is, as
/// the engine does: the webview then refuses it, which costs a typeface, not
/// the page.
fn decode_font(record: &[u8]) -> Result<Vec<u8>, CommandError> {
    let bad = || invalid("Invalid MOBI font record");
    let flags = be_u32(record, 8).ok_or_else(bad)?;
    let data_start = be_u32(record, 12).ok_or_else(bad)? as usize;
    let key_length = be_u32(record, 16).ok_or_else(bad)? as usize;
    let key_start = be_u32(record, 20).ok_or_else(bad)? as usize;
    let mut font = record.get(data_start..).unwrap_or_default().to_vec();
    if flags & 0b10 != 0 {
        let key_end = key_start.saturating_add(key_length).min(record.len());
        let key = record.get(key_start..key_end).unwrap_or_default();
        if key.is_empty() {
            return Err(invalid("MOBI font obfuscation key is empty"));
        }
        let obfuscated = if key_length == 16 { 1024 } else { 1040 };
        for (index, byte) in font.iter_mut().take(obfuscated).enumerate() {
            *byte ^= key[index % key.len()];
        }
    }
    if flags & 1 != 0 {
        match miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&font, MAX_FONT_BYTES) {
            Ok(inflated) => return Ok(inflated),
            Err(error) => log::warn!("MOBI font did not inflate: {:?}", error.status),
        }
    }
    Ok(font)
}

/// The media type a resource is served with: an image by its bytes, a font by
/// its signature. Nothing else gets a type the webview acts on (see
/// `book_archive::entry_media_type`).
pub fn resource_media_type(bytes: &[u8]) -> &'static str {
    match bytes.get(0..4) {
        Some([0, 1, 0, 0]) | Some(b"true") => "font/ttf",
        Some(b"OTTO") => "font/otf",
        Some(b"ttcf") => "font/collection",
        Some(b"wOFF") => "font/woff",
        Some(b"wOF2") => "font/woff2",
        _ => crate::metadata::image_mime(bytes).unwrap_or("application/octet-stream"),
    }
}

/// Several byte strings in one response body: a little-endian `u32` count,
/// that many `u32` lengths, then the bytes end to end.
pub fn frame(parts: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = parts.iter().map(Vec::len).sum();
    let mut body = Vec::with_capacity(4 + parts.len() * 4 + total);
    body.extend_from_slice(&(parts.len() as u32).to_le_bytes());
    for part in parts {
        body.extend_from_slice(&(part.len() as u32).to_le_bytes());
    }
    for part in parts {
        body.extend_from_slice(part);
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A Palm database holding `records`, in a temporary file.
    fn database(records: &[Vec<u8>]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        let mut header = vec![0u8; PDB_HEADER_BYTES as usize];
        header[60..68].copy_from_slice(b"BOOKMOBI");
        header[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
        let mut offset = PDB_HEADER_BYTES as u32 + records.len() as u32 * 8;
        let mut table = Vec::new();
        for record in records {
            table.extend_from_slice(&offset.to_be_bytes());
            table.extend_from_slice(&[0, 0, 0, 0]);
            offset += record.len() as u32;
        }
        let mut file = File::create(&path).unwrap();
        file.write_all(&header).unwrap();
        file.write_all(&table).unwrap();
        for record in records {
            file.write_all(record).unwrap();
        }
        (dir, path)
    }

    const STORED: TextCoding = TextCoding {
        compression: COMPRESSION_NONE,
        trailing_flags: 0,
        huffcdic: 0,
        huffcdic_count: 0,
    };

    #[test]
    fn records_are_read_by_index_with_their_lengths_and_printable_magics() {
        let (_dir, path) = database(&[
            b"Some text".to_vec(),
            b"INDXrest".to_vec(),
            vec![0xff, 0xd8, 0xff, 0xe0, 1, 2],
            b"ab".to_vec(),
        ]);
        let mut book = PalmBook::open(&path).unwrap();
        assert_eq!(book.record_lengths(), vec![9, 8, 6, 2]);
        assert_eq!(book.record_magics().unwrap(), vec!["", "INDX", "", ""]);
        assert_eq!(book.record(1).unwrap(), b"INDXrest");
        assert_eq!(
            book.records(1, 3).unwrap(),
            vec![
                b"INDXrest".to_vec(),
                vec![0xff, 0xd8, 0xff, 0xe0, 1, 2],
                b"ab".to_vec()
            ]
        );
        assert_eq!(book.record(4).err().unwrap().code, "book/parse-failed");
        assert!(book.records(2, 1).is_err());
        assert!(book.records(0, 4).is_err());
    }

    #[test]
    fn a_file_that_is_not_a_palm_database_is_damaged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.mobi");
        std::fs::write(&path, b"short").unwrap();
        assert_eq!(
            PalmBook::open(&path).err().unwrap().code,
            "book/parse-failed"
        );
        // Record offsets that run backwards or past the file are refused, not read.
        let mut bytes = vec![0u8; PDB_HEADER_BYTES as usize];
        bytes[76..78].copy_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&4000u32.to_be_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        std::fs::write(&path, &bytes).unwrap();
        assert!(PalmBook::open(&path).is_err());
    }

    #[test]
    fn palmdoc_expands_literals_spaces_and_back_references() {
        // "abcabcabc": three literals, then a pair copying 6 bytes from 3 back.
        let pair = 0x8000u16 | (3 << 3) | (6 - 3);
        let mut packed = b"abc".to_vec();
        packed.extend_from_slice(&pair.to_be_bytes());
        assert_eq!(decompress_palmdoc(&packed).unwrap(), b"abcabcabc");
        // 0x01-0x08 copy that many bytes as they are; 0xC0-0xFF are a space and a character.
        assert_eq!(
            decompress_palmdoc(&[3, 0xff, 0x00, 0x09, b'x', b'a' | 0x80, 0]).unwrap(),
            [0xff, 0x00, 0x09, b'x', b' ', b'a', 0]
        );
        for damaged in [
            &[0x80u8][..],
            &[3, b'a'][..],
            &[0x80, 0x08][..],
            &[b'a', 0x80, 0x10][..],
        ] {
            assert_eq!(
                decompress_palmdoc(damaged).err().unwrap().code,
                "book/parse-failed"
            );
        }
    }

    #[test]
    fn trailing_entries_and_a_split_character_are_removed_before_decompression() {
        // One trailing entry of 3 bytes (its own length byte included), flags 0b10.
        assert_eq!(
            without_trailing_entries(b"text\x01\x02\x83", 0b10).unwrap(),
            b"text"
        );
        // The start of a split character (two bytes and their count), then two
        // entries of 2 and 1 bytes: the entries go first, from the end.
        assert_eq!(
            without_trailing_entries(b"text\xe4\xb8\x02\x01\x82\x81", 0b111).unwrap(),
            b"text"
        );
        // An entry longer than the record, and one of no length.
        assert!(without_trailing_entries(b"ab\x89", 0b10).is_err());
        assert!(without_trailing_entries(b"ab\x80", 0b10).is_err());
        assert_eq!(without_trailing_entries(b"", 0b1).unwrap(), b"");

        let pair = 0x8000u16 | (3 << 3);
        let mut packed = b"abc".to_vec();
        packed.extend_from_slice(&pair.to_be_bytes());
        packed.extend_from_slice(b"\x00\x82");
        let (_dir, path) = database(&[b"header".to_vec(), packed, b"plain\x81".to_vec()]);
        let mut book = PalmBook::open(&path).unwrap();
        let coding = TextCoding {
            compression: COMPRESSION_PALMDOC,
            trailing_flags: 0b10,
            ..STORED
        };
        assert_eq!(
            book.text_records(1, 2, coding).unwrap(),
            vec![b"abcabc".to_vec(), b"plain".to_vec()]
        );
        assert_eq!(
            book.text_records(1, 2, STORED).unwrap()[1],
            b"plain\x81".to_vec()
        );
        assert!(book
            .text_records(
                1,
                1,
                TextCoding {
                    compression: 3,
                    ..STORED
                }
            )
            .is_err());
    }

    /// HUFF/CDIC tables in which every byte is an 8-bit code for the
    /// dictionary entry `codes[byte]`.
    fn huff_records(codes: &[(u8, u32)], entries: &[(&[u8], bool)]) -> Vec<Vec<u8>> {
        let mut huff = b"HUFF".to_vec();
        huff.extend_from_slice(&[0; 4]);
        huff.extend_from_slice(&24u32.to_be_bytes());
        huff.extend_from_slice(&(24u32 + 1024).to_be_bytes());
        huff.extend_from_slice(&[0; 8]);
        for byte in 0..=255u8 {
            // Terminal, 8 bits long; the entry is `value - byte`.
            let entry = codes
                .iter()
                .find(|(code, _)| *code == byte)
                .map(|(_, entry)| ((entry + u32::from(byte)) << 8) | 0x80 | 8)
                .unwrap_or(0);
            huff.extend_from_slice(&entry.to_be_bytes());
        }
        huff.extend_from_slice(&[0; 32 * 8]);

        let mut cdic = b"CDIC".to_vec();
        cdic.extend_from_slice(&16u32.to_be_bytes());
        cdic.extend_from_slice(&(entries.len() as u32).to_be_bytes());
        cdic.extend_from_slice(&8u32.to_be_bytes());
        let mut offset = entries.len() * 2;
        let mut data = Vec::new();
        for (value, _) in entries {
            cdic.extend_from_slice(&(offset as u16).to_be_bytes());
            offset += 2 + value.len();
        }
        for (value, decompressed) in entries {
            let head = value.len() as u16 | if *decompressed { 0x8000 } else { 0 };
            data.extend_from_slice(&head.to_be_bytes());
            data.extend_from_slice(value);
        }
        cdic.extend_from_slice(&data);
        vec![huff, cdic]
    }

    #[test]
    fn huffcdic_expands_codes_through_the_dictionary_including_packed_entries() {
        // Entry 2 is itself coded: the bytes A, B, which are entries 0 and 1.
        let mut records = vec![b"header".to_vec(), b"ABC".to_vec(), b"CA\x81".to_vec()];
        records.extend(huff_records(
            &[(b'A', 0), (b'B', 1), (b'C', 2)],
            &[(b"Hello, ", true), (b"world", true), (b"AB", false)],
        ));
        let (_dir, path) = database(&records);
        let mut book = PalmBook::open(&path).unwrap();
        let coding = TextCoding {
            compression: COMPRESSION_HUFFCDIC,
            trailing_flags: 0b10,
            huffcdic: 3,
            huffcdic_count: 2,
        };
        assert_eq!(
            book.text_records(1, 1, STORED).unwrap(),
            vec![b"ABC".to_vec()]
        );
        assert_eq!(
            book.text_records(
                1,
                1,
                TextCoding {
                    trailing_flags: 0,
                    ..coding
                }
            )
            .unwrap(),
            vec![b"Hello, worldHello, world".to_vec()]
        );
        // The packed entry was expanded once and is reused; a trailing entry is dropped first.
        assert_eq!(
            book.text_records(2, 2, coding).unwrap(),
            vec![b"Hello, worldHello, ".to_vec()]
        );
        // A byte the tables have no code for, tables that are not there, an entry coded with itself.
        let (_dir, path) = database(&records);
        let mut book = PalmBook::open(&path).unwrap();
        assert!(book
            .text_records(
                0,
                0,
                TextCoding {
                    trailing_flags: 0,
                    ..coding
                }
            )
            .is_err());
        assert!(book
            .text_records(
                1,
                1,
                TextCoding {
                    huffcdic: 1,
                    ..coding
                }
            )
            .is_err());
        let mut looping = vec![b"header".to_vec(), b"A".to_vec()];
        looping.extend(huff_records(&[(b'A', 0)], &[(b"A", false)]));
        let (_dir, path) = database(&looping);
        let mut book = PalmBook::open(&path).unwrap();
        let error = book
            .text_records(
                1,
                1,
                TextCoding {
                    huffcdic: 2,
                    trailing_flags: 0,
                    ..coding
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.message, "Invalid recursive CDIC reference");
    }

    #[test]
    fn read_32_bits_crosses_bytes_and_pads_with_zero() {
        let bytes = [0b1010_1010, 0xff, 0x00, 0x0f, 0xf0];
        assert_eq!(read_32_bits(&bytes, 0), 0xaaff_000f);
        assert_eq!(read_32_bits(&bytes, 4), 0xaff0_00ff);
        assert_eq!(read_32_bits(&bytes, 8), 0xff00_0ff0);
        assert_eq!(read_32_bits(&bytes, 36), 0);
    }

    fn font_record(flags: u32, key: &[u8], data: &[u8]) -> Vec<u8> {
        let mut record = b"FONT".to_vec();
        record.extend_from_slice(&[0; 4]);
        record.extend_from_slice(&flags.to_be_bytes());
        record.extend_from_slice(&(24 + key.len() as u32).to_be_bytes());
        record.extend_from_slice(&(key.len() as u32).to_be_bytes());
        record.extend_from_slice(&24u32.to_be_bytes());
        record.extend_from_slice(key);
        record.extend_from_slice(data);
        record
    }

    #[test]
    fn resources_are_decoded_as_a_page_uses_them() {
        let font: Vec<u8> = (0..3000u32).map(|index| (index % 251) as u8).collect();
        let key = [7u8, 9, 11];
        let mut obfuscated = font.clone();
        for (index, byte) in obfuscated.iter_mut().take(1040).enumerate() {
            *byte ^= key[index % key.len()];
        }
        let packed = miniz_oxide::deflate::compress_to_vec_zlib(&font, 6);
        let mut packed_obfuscated = packed.clone();
        for (index, byte) in packed_obfuscated.iter_mut().take(1040).enumerate() {
            *byte ^= key[index % key.len()];
        }
        let mut media = b"AUDI".to_vec();
        media.extend_from_slice(&[0; 8]);
        media.extend_from_slice(b"sound");
        let (_dir, path) = database(&[
            b"\x89PNG\r\n\x1a\nimage".to_vec(),
            font_record(0, &[], &font),
            font_record(0b10, &key, &obfuscated),
            font_record(0b11, &key, &packed_obfuscated),
            font_record(0b01, &[], b"not zlib"),
            font_record(0b10, &[], &font),
            media,
        ]);
        let mut book = PalmBook::open(&path).unwrap();
        assert_eq!(book.resource(0).unwrap(), b"\x89PNG\r\n\x1a\nimage");
        assert_eq!(book.resource(1).unwrap(), font);
        assert_eq!(book.resource(2).unwrap(), font);
        assert_eq!(book.resource(3).unwrap(), font);
        // A font that does not inflate is handed over as it is.
        assert_eq!(book.resource(4).unwrap(), b"not zlib");
        assert_eq!(
            book.resource(5).err().unwrap().message,
            "MOBI font obfuscation key is empty"
        );
        assert_eq!(book.resource(6).unwrap(), b"sound");
    }

    #[test]
    fn resource_types_and_frames() {
        assert_eq!(resource_media_type(&[0, 1, 0, 0, 9]), "font/ttf");
        assert_eq!(resource_media_type(b"OTTO...."), "font/otf");
        assert_eq!(resource_media_type(b"wOF2...."), "font/woff2");
        assert_eq!(resource_media_type(&[0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
        assert_eq!(
            resource_media_type(b"<html><script>"),
            "application/octet-stream"
        );
        assert_eq!(
            frame(&[b"ab".to_vec(), Vec::new(), b"c".to_vec()]),
            [3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, b'a', b'b', b'c']
        );
    }
}
