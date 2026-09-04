use std::{fs::File, io::Read, path::Path};

use percent_encoding::percent_decode_str;
use quick_xml::{
    escape::resolve_xml_entity,
    events::{BytesStart, Event},
    Reader,
};
use zip::ZipArchive;

use crate::metadata::{BookMetadata, CoverImage};

const MAX_XML_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;

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

/// Where the package says the cover is: an image item, or a page (EPUB 2
/// `<guide><reference type="cover">`, or a `cover.xhtml` the metadata points
/// at) whose first image is the cover — the same fallback ladder Calibre and
/// the reading engine walk, so the shelf and the reader agree.
#[derive(Debug, PartialEq)]
enum CoverRef {
    Image { href: String, media_type: String },
    Page { href: String },
}

type PackageMetadata = (Option<String>, Option<String>, Option<CoverRef>);

fn parse_package(opf: &str) -> Result<PackageMetadata, String> {
    let mut reader = Reader::from_str(opf);
    // Keep boundary spaces around entity/reference events ("A &amp; B" is
    // emitted as three events). The completed field is trimmed once below.
    reader.config_mut().trim_text(false);
    let mut current_text: Option<&'static str> = None;
    let mut title = String::new();
    let mut author = String::new();
    let mut cover_id = None;
    let mut guide_cover = None;
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
                b"reference" => {
                    if let Some(href) = guide_cover_reference(&element, &reader)? {
                        guide_cover.get_or_insert(href);
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
                b"reference" => {
                    if let Some(href) = guide_cover_reference(&element, &reader)? {
                        guide_cover.get_or_insert(href);
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

    let is_image = |item: &&ManifestItem| item.media_type.starts_with("image/");
    let is_page = |item: &&ManifestItem| {
        item.media_type == "application/xhtml+xml" || item.media_type == "text/html"
    };
    let names_cover = |item: &&ManifestItem| {
        item.id.to_ascii_lowercase().contains("cover")
            || item.href.to_ascii_lowercase().contains("cover")
    };
    // `<meta name="cover">` should carry an item id; plenty of files put the
    // image's href there instead, so both readings are tried.
    let meta_item = cover_id.as_deref().and_then(|id| {
        items
            .iter()
            .find(|item| item.id == id)
            .or_else(|| items.iter().find(|item| item.href == id))
    });

    let cover_image = items
        .iter()
        .find(|item| {
            item.properties
                .split_whitespace()
                .any(|value| value == "cover-image")
        })
        .or_else(|| meta_item.filter(is_image))
        .or_else(|| items.iter().find(|item| is_image(item) && names_cover(item)));

    let cover = match cover_image {
        Some(item) => Some(CoverRef::Image {
            href: item.href.clone(),
            media_type: item.media_type.clone(),
        }),
        None => meta_item
            .filter(is_page)
            .map(|item| item.href.clone())
            .or(guide_cover)
            .or_else(|| {
                items
                    .iter()
                    .find(|item| is_page(item) && names_cover(item))
                    .map(|item| item.href.clone())
            })
            .map(|href| CoverRef::Page { href }),
    };

    let title = (!title.trim().is_empty()).then(|| title.trim().to_owned());
    let author = (!author.trim().is_empty()).then(|| author.trim().to_owned());
    Ok((title, author, cover))
}

/// `<guide><reference type="cover" href="…"/>` — EPUB 2's way of naming the
/// cover page. `type` may carry several words ("cover title-page").
fn guide_cover_reference(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<Option<String>, String> {
    let kind = attribute(element, reader, b"type")?.unwrap_or_default();
    if !kind.split_whitespace().any(|word| word.eq_ignore_ascii_case("cover")) {
        return Ok(None);
    }
    Ok(attribute(element, reader, b"href")?.filter(|href| !href.is_empty()))
}

/// The first image a cover page shows: `<img src>` or SVG `<image href>`
/// (xlink or plain). Returns the href as written, relative to the page.
fn first_image_in_page(page: &str) -> Option<String> {
    let mut reader = Reader::from_str(page);
    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            // Cover pages are frequently not well-formed XML; whatever was
            // parsed before the error is all there is.
            Err(_) => return None,
        };
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name();
                let wanted: &[&[u8]] = match name.as_ref() {
                    b"img" => &[b"src"],
                    b"image" => &[b"href"],
                    _ => continue,
                };
                for attribute_name in wanted {
                    if let Ok(Some(value)) = attribute(&element, &reader, attribute_name) {
                        if !value.is_empty() {
                            return Some(value);
                        }
                    }
                }
            }
            Event::Eof => return None,
            _ => {}
        }
    }
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

pub fn extract_epub_metadata_from_path(path: &Path) -> Result<BookMetadata, String> {
    let file = File::open(path)
        .map_err(|error| format!("Failed to open EPUB {}: {error}", path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let container_bytes = read_entry(&mut archive, "META-INF/container.xml", MAX_XML_BYTES)?;
    let container = String::from_utf8(container_bytes).map_err(|error| error.to_string())?;
    let package_path = parse_package_path(&container)?;
    let package_bytes = read_entry(&mut archive, &package_path, MAX_XML_BYTES)?;
    let package = String::from_utf8(package_bytes).map_err(|error| error.to_string())?;
    let (title, author, cover) = parse_package(&package)?;
    let cover_entry: Option<(String, Option<String>)> = match cover {
        Some(CoverRef::Image { href, media_type }) => {
            Some((resolve_archive_path(&package_path, &href)?, Some(media_type)))
        }
        Some(CoverRef::Page { href }) => {
            let page_path = resolve_archive_path(&package_path, &href)?;
            match read_entry(&mut archive, &page_path, MAX_XML_BYTES) {
                Ok(bytes) => match first_image_in_page(&String::from_utf8_lossy(&bytes)) {
                    Some(image_href) => Some((resolve_archive_path(&page_path, &image_href)?, None)),
                    None => None,
                },
                // A dangling guide reference is a broken file, not a broken
                // import: the book simply has no cover we can find.
                Err(_) => None,
            }
        }
        None => None,
    };
    let cover = match cover_entry {
        Some((cover_path, declared_type)) => match read_entry(&mut archive, &cover_path, MAX_COVER_BYTES) {
            Ok(bytes) => {
                // The manifest's media-type is the EPUB's own claim; the
                // sniffed MIME wins when the bytes say otherwise, and
                // unrecognized bytes keep the declared type (an SVG cover,
                // say) — the normalizer downstream decides what it can do
                // with them.
                crate::metadata::image_mime(&bytes)
                    .map(str::to_owned)
                    .or(declared_type)
                    .map(|mime| CoverImage { bytes, mime })
            }
            Err(_) => None,
        },
        None => None,
    };
    Ok(BookMetadata { title, author, cover })
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
        let cover = metadata.cover.expect("cover");
        assert_eq!(cover.bytes, b"cover bytes");
        assert_eq!(cover.mime, "image/jpeg");
    }

    #[test]
    fn a_cover_page_yields_its_first_image_and_meta_content_may_be_an_href() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sample.epub");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("META-INF/container.xml", options).unwrap();
        writer.write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
        writer.start_file("OEBPS/content.opf", options).unwrap();
        // No image is declared as the cover; the guide names the cover page.
        writer.write_all(br#"<package><metadata><dc:title xmlns:dc="dc">T</dc:title></metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="i1" href="Images/9780.jpg" media-type="image/jpeg"/></manifest><guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide></package>"#).unwrap();
        writer.start_file("OEBPS/cover.xhtml", options).unwrap();
        writer.write_all(br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div><img src="Images/9780.jpg" alt="cover"/></div></body></html>"#).unwrap();
        writer.start_file("OEBPS/Images/9780.jpg", options).unwrap();
        writer.write_all(&[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).unwrap();
        writer.finish().unwrap();

        let metadata = extract_epub_metadata_from_path(&path).unwrap();
        let cover = metadata.cover.expect("cover from the guide's cover page");
        assert_eq!(cover.mime, "image/jpeg");
        assert_eq!(cover.bytes, [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

        // `<meta name="cover" content="Images/9780.jpg">` — an href, not an id.
        let path = dir.path().join("meta-href.epub");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        writer.start_file("META-INF/container.xml", options).unwrap();
        writer.write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
        writer.start_file("OEBPS/content.opf", options).unwrap();
        writer.write_all(br#"<package><metadata><meta name="cover" content="Images/9780.jpg"/></metadata><manifest><item id="i1" href="Images/9780.jpg" media-type="image/jpeg"/></manifest></package>"#).unwrap();
        writer.start_file("OEBPS/Images/9780.jpg", options).unwrap();
        writer.write_all(&[0xff, 0xd8, 0xff, 0xe0, 9]).unwrap();
        writer.finish().unwrap();
        let metadata = extract_epub_metadata_from_path(&path).unwrap();
        assert_eq!(metadata.cover.unwrap().bytes, [0xff, 0xd8, 0xff, 0xe0, 9]);
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
        let cover = metadata.cover.expect("cover");
        assert_eq!(cover.bytes, b"png");
        assert_eq!(cover.mime, "image/png");
    }
}
