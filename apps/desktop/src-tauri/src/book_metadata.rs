use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use percent_encoding::percent_decode_str;
use quick_xml::{
    escape::resolve_xml_entity,
    events::{BytesStart, Event},
    Reader,
};
use serde::Serialize;
use zip::ZipArchive;

const MAX_XML_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover_url: Option<String>,
}

#[derive(Debug)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

fn attribute(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
    wanted: &[u8],
) -> Result<Option<String>, String> {
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if attribute.key.local_name().as_ref() == wanted {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(|error| error.to_string());
        }
    }
    Ok(None)
}

fn read_entry(
    archive: &mut ZipArchive<File>,
    name: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|error| format!("EPUB entry {name} is missing: {error}"))?;
    if entry.size() > max_bytes {
        return Err(format!(
            "EPUB entry {name} exceeds the {max_bytes}-byte safety limit"
        ));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn parse_package_path(container: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(container);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(element) | Event::Empty(element)
                if element.local_name().as_ref() == b"rootfile" =>
            {
                if let Some(path) = attribute(&element, &reader, b"full-path")? {
                    return Ok(path);
                }
            }
            Event::Eof => return Err("EPUB container has no package document".into()),
            _ => {}
        }
    }
}

type PackageMetadata = (Option<String>, Option<String>, Option<(String, String)>);

fn parse_package(opf: &str) -> Result<PackageMetadata, String> {
    let mut reader = Reader::from_str(opf);
    // Keep boundary spaces around entity/reference events ("A &amp; B" is
    // emitted as three events). The completed field is trimmed once below.
    reader.config_mut().trim_text(false);
    let mut current_text: Option<&'static str> = None;
    let mut title = String::new();
    let mut author = String::new();
    let mut cover_id = None;
    let mut items = Vec::new();

    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(element) => match element.local_name().as_ref() {
                b"title" if title.is_empty() => current_text = Some("title"),
                b"creator" if author.is_empty() => current_text = Some("author"),
                b"item" => items.push(parse_manifest_item(&element, &reader)?),
                b"meta" => {
                    if attribute(&element, &reader, b"name")?.as_deref() == Some("cover") {
                        cover_id = attribute(&element, &reader, b"content")?;
                    }
                }
                _ => {}
            },
            Event::Empty(element) => match element.local_name().as_ref() {
                b"item" => items.push(parse_manifest_item(&element, &reader)?),
                b"meta" => {
                    if attribute(&element, &reader, b"name")?.as_deref() == Some("cover") {
                        cover_id = attribute(&element, &reader, b"content")?;
                    }
                }
                _ => {}
            },
            Event::Text(text) => {
                let value = text.decode().map_err(|error| error.to_string())?;
                match current_text {
                    Some("title") => title.push_str(&value),
                    Some("author") => author.push_str(&value),
                    _ => {}
                }
            }
            Event::CData(text) => {
                let value = text.decode().map_err(|error| error.to_string())?;
                match current_text {
                    Some("title") => title.push_str(&value),
                    Some("author") => author.push_str(&value),
                    _ => {}
                }
            }
            Event::GeneralRef(reference) => {
                let name = reference.decode().map_err(|error| error.to_string())?;
                let value = if let Some(character) = reference
                    .resolve_char_ref()
                    .map_err(|error| error.to_string())?
                {
                    character.to_string()
                } else {
                    resolve_xml_entity(&name)
                        .ok_or_else(|| format!("Unsupported XML entity &{name};"))?
                        .to_owned()
                };
                match current_text {
                    Some("title") => title.push_str(&value),
                    Some("author") => author.push_str(&value),
                    _ => {}
                }
            }
            Event::End(element)
                if matches!(element.local_name().as_ref(), b"title" | b"creator") =>
            {
                current_text = None;
            }
            Event::Eof => break,
            _ => {}
        }
    }

    let cover = items
        .iter()
        .find(|item| {
            item.properties
                .split_whitespace()
                .any(|value| value == "cover-image")
        })
        .or_else(|| {
            cover_id.as_deref().and_then(|id| {
                items
                    .iter()
                    .find(|item| item.id == id && item.media_type.starts_with("image/"))
            })
        })
        .or_else(|| {
            items.iter().find(|item| {
                item.media_type.starts_with("image/")
                    && (item.id.to_ascii_lowercase().contains("cover")
                        || item.href.to_ascii_lowercase().contains("cover"))
            })
        });

    let title = (!title.trim().is_empty()).then(|| title.trim().to_owned());
    let author = (!author.trim().is_empty()).then(|| author.trim().to_owned());
    let cover = cover.map(|item| (item.href.clone(), item.media_type.clone()));
    Ok((title, author, cover))
}

fn parse_manifest_item(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<ManifestItem, String> {
    Ok(ManifestItem {
        id: attribute(element, reader, b"id")?.unwrap_or_default(),
        href: attribute(element, reader, b"href")?.unwrap_or_default(),
        media_type: attribute(element, reader, b"media-type")?
            .unwrap_or_else(|| "application/octet-stream".into()),
        properties: attribute(element, reader, b"properties")?.unwrap_or_default(),
    })
}

fn resolve_archive_path(package_path: &str, href: &str) -> Result<String, String> {
    let decoded = percent_decode_str(href.split(['?', '#']).next().unwrap_or(href))
        .decode_utf8_lossy()
        .replace('\\', "/");
    if decoded.starts_with('/') {
        return Err("Absolute EPUB manifest paths are not supported".into());
    }

    let mut segments: Vec<&str> = package_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    segments.pop();
    for segment in decoded.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err("EPUB manifest path escapes the archive root".into());
                }
            }
            value => segments.push(value),
        }
    }
    Ok(segments.join("/"))
}

pub fn extract_epub_metadata_from_path(path: &Path) -> Result<EpubMetadata, String> {
    let file = File::open(path)
        .map_err(|error| format!("Failed to open EPUB {}: {error}", path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let container_bytes = read_entry(&mut archive, "META-INF/container.xml", MAX_XML_BYTES)?;
    let container = String::from_utf8(container_bytes).map_err(|error| error.to_string())?;
    let package_path = parse_package_path(&container)?;
    let package_bytes = read_entry(&mut archive, &package_path, MAX_XML_BYTES)?;
    let package = String::from_utf8(package_bytes).map_err(|error| error.to_string())?;
    let (title, author, cover) = parse_package(&package)?;
    let cover_url = match cover {
        Some((cover_href, cover_media_type)) => {
            let cover_path = resolve_archive_path(&package_path, &cover_href)?;
            let cover = read_entry(&mut archive, &cover_path, MAX_COVER_BYTES)?;
            Some(format!(
                "data:{cover_media_type};base64,{}",
                STANDARD.encode(cover)
            ))
        }
        None => None,
    };
    Ok(EpubMetadata {
        title,
        author,
        cover_url,
    })
}

#[tauri::command]
pub async fn extract_epub_metadata(path: String) -> Result<EpubMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || extract_epub_metadata_from_path(Path::new(&path)))
        .await
        .map_err(|error| format!("extract_epub_metadata task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    #[test]
    fn extracts_epub_two_metadata_and_cover_without_reading_book_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sample.epub");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("mimetype", stored).unwrap();
        writer.write_all(b"application/epub+zip").unwrap();
        writer
            .start_file("META-INF/container.xml", deflated)
            .unwrap();
        writer.write_all(br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>"#).unwrap();
        writer.start_file("OPS/package.opf", deflated).unwrap();
        writer.write_all(br#"<package><metadata><dc:title xmlns:dc="dc">A &amp; B</dc:title><dc:creator xmlns:dc="dc">Reader</dc:creator><meta name="cover" content="front"/></metadata><manifest><item id="front" href="images/front.jpg" media-type="image/jpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest></package>"#).unwrap();
        writer.start_file("OPS/images/front.jpg", deflated).unwrap();
        writer.write_all(b"cover bytes").unwrap();
        writer.start_file("OPS/chapter.xhtml", deflated).unwrap();
        writer.write_all(&vec![b'x'; 1024 * 1024]).unwrap();
        writer.finish().unwrap();

        let metadata = extract_epub_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("A & B"));
        assert_eq!(metadata.author.as_deref(), Some("Reader"));
        assert_eq!(
            metadata.cover_url.as_deref(),
            Some("data:image/jpeg;base64,Y292ZXIgYnl0ZXM=")
        );
    }

    #[test]
    fn supports_epub_three_cover_property_and_percent_encoded_paths() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sample.epub");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer
            .start_file("META-INF/container.xml", options)
            .unwrap();
        writer.write_all(br#"<container><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>"#).unwrap();
        writer.start_file("package.opf", options).unwrap();
        writer.write_all(br#"<package><metadata><title>Title</title></metadata><manifest><item id="art" href="cover%20art.png" media-type="image/png" properties="nav cover-image"/></manifest></package>"#).unwrap();
        writer.start_file("cover art.png", options).unwrap();
        writer.write_all(b"png").unwrap();
        writer.finish().unwrap();

        let metadata = extract_epub_metadata_from_path(&path).unwrap();
        assert_eq!(
            metadata.cover_url.as_deref(),
            Some("data:image/png;base64,cG5n")
        );
    }
}
