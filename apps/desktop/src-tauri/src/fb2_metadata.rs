//! Import-time metadata for FictionBook 2, plain (`.fb2`) or zipped
//! (`.fb2.zip` / `.fbz`).
//!
//! FB2 keeps its metadata in `<description><title-info>` at the head of the
//! file and its images, base64-encoded, in `<binary>` elements at the tail.
//! One streaming pass reads the first and, if the title info named a cover,
//! carries on to the matching binary — decoding no other image on the way.

use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use quick_xml::{escape::resolve_xml_entity, events::Event, Reader};
use zip::ZipArchive;

use crate::metadata::{clean, cover_image, BookMetadata};

/// FB2 books are single XML documents; a very large one is still bounded.
const MAX_XML_BYTES: u64 = 96 * 1024 * 1024;
const MAX_COVER_BYTES: usize = 20 * 1024 * 1024;

#[derive(Default)]
struct TitleInfo {
    title: String,
    author_parts: Vec<String>,
    cover_id: Option<String>,
}

pub fn extract_fb2_metadata_from_path(path: &Path) -> Result<BookMetadata, String> {
    let xml = read_document(path)?;
    parse_fb2(&xml)
}

/// Read the FictionBook document, unwrapping the ZIP form when present.
fn read_document(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut head = [0u8; 4];
    let is_zip = matches!(file.read(&mut head), Ok(4)) && head == [0x50, 0x4b, 0x03, 0x04];

    let bytes = if is_zip {
        let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
            .map_err(|error| error.to_string())?;
        let name = (0..archive.len())
            .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.name().to_owned()))
            .find(|name| name.to_ascii_lowercase().ends_with(".fb2"))
            .ok_or("Zipped FictionBook holds no .fb2 entry")?;
        let mut entry = archive.by_name(&name).map_err(|error| error.to_string())?;
        if entry.size() > MAX_XML_BYTES {
            return Err("FictionBook exceeds the size limit for metadata extraction".into());
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        bytes
    } else {
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        if size > MAX_XML_BYTES {
            return Err("FictionBook exceeds the size limit for metadata extraction".into());
        }
        let mut bytes = Vec::with_capacity(size as usize);
        File::open(path)
            .map_err(|e| e.to_string())?
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        bytes
    };

    Ok(decode_xml(&bytes))
}

/// FB2 files are frequently windows-1251 or koi8-r rather than UTF-8; the
/// declaration in the XML prologue says which.
fn decode_xml(bytes: &[u8]) -> String {
    let prologue = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).to_ascii_lowercase();
    let is_utf8 = !prologue.contains("encoding=") || prologue.contains("utf-8");
    if is_utf8 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    if prologue.contains("windows-1251") {
        return bytes.iter().map(|byte| cp1251_char(*byte)).collect();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn cp1251_char(byte: u8) -> char {
    const HIGH: [char; 128] = [
        'Ђ', 'Ѓ', '‚', 'ѓ', '„', '…', '†', '‡', '€', '‰', 'Љ', '‹', 'Њ', 'Ќ', 'Ћ', 'Џ', 'ђ', '‘',
        '’', '“', '”', '•', '–', '—', '\u{FFFD}', '™', 'љ', '›', 'њ', 'ќ', 'ћ', 'џ', '\u{00A0}',
        'Ў', 'ў', 'Ј', '¤', 'Ґ', '¦', '§', 'Ё', '©', 'Є', '«', '¬', '\u{00AD}', '®', 'Ї', '°', '±',
        'І', 'і', 'ґ', 'µ', '¶', '·', 'ё', '№', 'є', '»', 'ј', 'Ѕ', 'ѕ', 'ї', 'А', 'Б', 'В', 'Г',
        'Д', 'Е', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф', 'Х',
        'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я', 'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з',
        'и', 'й', 'к', 'л', 'м', 'н', 'о', 'п', 'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч', 'ш', 'щ',
        'ъ', 'ы', 'ь', 'э', 'ю', 'я',
    ];
    if byte < 0x80 {
        byte as char
    } else {
        HIGH[(byte - 0x80) as usize]
    }
}

fn parse_fb2(xml: &str) -> Result<BookMetadata, String> {
    let mut reader = Reader::from_str(xml);
    // Keep the spaces around entity references: "A &amp; B" arrives as three
    // events, and trimming each would glue the parts together. `clean` collapses
    // the assembled field once at the end.
    reader.config_mut().trim_text(false);

    let mut info = TitleInfo::default();
    let mut in_title_info = false;
    let mut in_author = false;
    let mut field: Option<&'static str> = None;
    let mut binary: Option<(String, String)> = None;
    let mut cover: Option<Vec<u8>> = None;
    // Coverless fallback: the first sizeable image binary in the file.
    let mut in_fallback_binary = false;
    let mut fallback: Option<Vec<u8>> = None;

    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(element) => match element.local_name().as_ref() {
                b"title-info" => in_title_info = true,
                b"author" if in_title_info => in_author = true,
                b"book-title" if in_title_info => field = Some("title"),
                b"first-name" | b"middle-name" | b"last-name" | b"nickname" if in_author => {
                    field = Some("author");
                }
                b"binary" => {
                    let id = attribute(&element, b"id").unwrap_or_default();
                    let content_type = attribute(&element, b"content-type").unwrap_or_default();
                    // Only the cover binary is worth decoding; skip the rest.
                    if info
                        .cover_id
                        .as_deref()
                        .is_some_and(|wanted| wanted == id.trim_start_matches('#'))
                    {
                        binary = Some((id, content_type));
                    } else if fallback.is_none() && content_type.starts_with("image/") {
                        in_fallback_binary = true;
                    }
                }
                _ => {}
            },
            Event::Empty(element) if element.local_name().as_ref() == b"image" => {
                if in_title_info && info.cover_id.is_none() {
                    info.cover_id = attribute(&element, b"href")
                        .map(|href| href.trim_start_matches('#').to_owned());
                }
            }
            Event::Text(text) => {
                let value = text.decode().map_err(|error| error.to_string())?;
                match field {
                    Some("title") => info.title.push_str(&value),
                    Some("author") => {
                        if let Some(part) = clean(&*value) {
                            info.author_parts.push(part);
                        }
                    }
                    _ => {}
                }
                if binary.is_some() && cover.is_none() {
                    let packed: String = value.split_whitespace().collect();
                    cover = STANDARD
                        .decode(packed)
                        .ok()
                        .filter(|bytes| bytes.len() <= MAX_COVER_BYTES);
                } else if in_fallback_binary && fallback.is_none() {
                    let packed: String = value.split_whitespace().collect();
                    fallback = STANDARD
                        .decode(packed)
                        .ok()
                        .filter(|bytes| bytes.len() <= MAX_COVER_BYTES)
                        .filter(|bytes| crate::covers::plausible_cover(bytes));
                }
            }
            // Entity references arrive as their own event; a title like
            // "Отцы &amp; дети" would otherwise lose everything after "Отцы".
            Event::GeneralRef(reference) => {
                let name = reference.decode().map_err(|error| error.to_string())?;
                let resolved = match reference
                    .resolve_char_ref()
                    .map_err(|error| error.to_string())?
                {
                    Some(character) => character.to_string(),
                    None => resolve_xml_entity(&name).unwrap_or("").to_owned(),
                };
                match field {
                    Some("title") => info.title.push_str(&resolved),
                    Some("author") => info.author_parts.push(resolved),
                    _ => {}
                }
            }
            Event::End(element) => match element.local_name().as_ref() {
                b"title-info" => in_title_info = false,
                b"author" => {
                    in_author = false;
                    field = None;
                }
                b"binary" => {
                    if cover.is_some() {
                        break;
                    }
                    binary = None;
                    in_fallback_binary = false;
                }
                _ => field = None,
            },
            Event::Eof => break,
            _ => {}
        }

        // Nothing after the cover binary can change the answer; a book that
        // names no cover is settled by its first sizeable image just the same
        // (binaries sit past the description, so the title is complete).
        if cover.is_some() || (info.cover_id.is_none() && fallback.is_some()) {
            break;
        }
    }

    Ok(BookMetadata {
        title: clean(&info.title),
        author: clean(info.author_parts.join(" ")),
        cover: cover.or(fallback).and_then(cover_image),
    })
}

fn attribute(element: &quick_xml::events::BytesStart<'_>, wanted: &[u8]) -> Option<String> {
    element
        .attributes()
        .with_checks(false)
        .filter_map(Result::ok)
        .find(|attribute| attribute.key.local_name().as_ref() == wanted)
        .map(|attribute| String::from_utf8_lossy(&attribute.value).into_owned())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    const JPEG: [u8; 6] = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02];

    fn document(cover: bool) -> String {
        let coverpage = if cover {
            r##"<coverpage><image xmlns:l="http://www.w3.org/1999/xlink" l:href="#cover.jpg"/></coverpage>"##
        } else {
            ""
        };
        let binary = if cover {
            format!(
                r#"<binary id="cover.jpg" content-type="image/jpeg">{}</binary>"#,
                STANDARD.encode(JPEG)
            )
        } else {
            String::new()
        };
        format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<FictionBook><description><title-info><author><first-name>Иван</first-name><last-name>Тургенев</last-name></author><book-title>Отцы &amp; дети</book-title>{coverpage}</title-info></description><body><section><p>text</p></section></body>{binary}</FictionBook>"#
        )
    }

    #[test]
    fn reads_title_author_and_the_referenced_cover_binary() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.fb2");
        File::create(&path)
            .unwrap()
            .write_all(document(true).as_bytes())
            .unwrap();

        let metadata = extract_fb2_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Отцы & дети"));
        assert_eq!(metadata.author.as_deref(), Some("Иван Тургенев"));
        assert_eq!(metadata.cover.unwrap().mime, "image/jpeg");
    }

    #[test]
    fn a_book_without_a_coverpage_still_yields_title_and_author() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.fb2");
        File::create(&path)
            .unwrap()
            .write_all(document(false).as_bytes())
            .unwrap();

        let metadata = extract_fb2_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Отцы & дети"));
        assert_eq!(metadata.cover, None);
    }

    #[test]
    fn a_book_without_a_coverpage_falls_back_to_its_first_sizeable_image() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.fb2");
        let mut picture = std::io::Cursor::new(Vec::new());
        image::RgbImage::from_pixel(200, 260, image::Rgb([5, 5, 5]))
            .write_to(&mut picture, image::ImageFormat::Png)
            .unwrap();
        let picture = picture.into_inner();
        let mut ornament = std::io::Cursor::new(Vec::new());
        image::RgbImage::from_pixel(16, 16, image::Rgb([5, 5, 5]))
            .write_to(&mut ornament, image::ImageFormat::Png)
            .unwrap();
        let xml = format!(
            r#"<FictionBook><description><title-info><book-title>T</book-title></title-info></description><body/><binary id="o.png" content-type="image/png">{}</binary><binary id="p.png" content-type="image/png">{}</binary></FictionBook>"#,
            STANDARD.encode(ornament.into_inner()),
            STANDARD.encode(&picture)
        );
        File::create(&path).unwrap().write_all(xml.as_bytes()).unwrap();

        let metadata = extract_fb2_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("T"));
        assert_eq!(metadata.cover.unwrap().bytes, picture);
    }

    #[test]
    fn reads_the_zipped_form() {
        use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
        let dir = tempdir().unwrap();
        let path = dir.path().join("book.fb2.zip");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        writer
            .start_file(
                "book.fb2",
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(document(true).as_bytes()).unwrap();
        writer.finish().unwrap();

        let metadata = extract_fb2_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Отцы & дети"));
        assert!(metadata.cover.is_some());
    }
}
