//! Shared shape for import-time book metadata.
//!
//! Every format extractor answers the same three questions — title, author,
//! cover — by reading only the bytes that carry them. The whole book never
//! enters the webview and the reading engine never starts; the shelf paints a
//! real cover the moment a file is imported.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover_url: Option<String>,
}

/// Cover images are handed to the webview as data URLs, like EPUB covers.
pub fn cover_data_url(bytes: &[u8]) -> Option<String> {
    let mime = image_mime(bytes)?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Identify an image by its magic number. An unrecognized blob is not a cover:
/// a MOBI resource record can just as well hold a font or an audio clip.
pub fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xff, 0xd8, 0xff, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, ..] => Some("image/png"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'B', b'M', ..] => Some("image/bmp"),
        _ if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            Some("image/webp")
        }
        _ if starts_with_svg(bytes) => Some("image/svg+xml"),
        _ => None,
    }
}

fn starts_with_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(512)];
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim_start();
    trimmed.starts_with("<svg") || (trimmed.starts_with("<?xml") && text.contains("<svg"))
}

/// Collapse whitespace and drop empties, so a shelf never shows a blank title
/// that merely looked non-empty in the file.
pub fn clean(value: impl AsRef<str>) -> Option<String> {
    let collapsed = value.as_ref().split_whitespace().collect::<Vec<_>>().join(" ");
    (!collapsed.is_empty()).then_some(collapsed)
}

/// Resolve the handful of HTML entities that turn up in packed metadata
/// strings (MOBI titles routinely carry `&amp;`, FB2 ones `&#8212;`).
pub fn unescape_entities(value: &str) -> String {
    if !value.contains('&') {
        return value.to_owned();
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        match tail.find(';').filter(|end| *end <= 10) {
            Some(end) => {
                let entity = &tail[1..end];
                match resolve_entity(entity) {
                    Some(resolved) => out.push_str(&resolved),
                    None => out.push_str(&tail[..=end]),
                }
                rest = &tail[end + 1..];
            }
            None => {
                out.push_str(tail);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

fn resolve_entity(entity: &str) -> Option<String> {
    match entity {
        "amp" => Some("&".into()),
        "lt" => Some("<".into()),
        "gt" => Some(">".into()),
        "quot" => Some("\"".into()),
        "apos" | "#39" => Some("'".into()),
        "nbsp" => Some(" ".into()),
        _ => {
            let digits = entity.strip_prefix('#')?;
            let code = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => digits.parse().ok()?,
            };
            char::from_u32(code).map(String::from)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_images_and_rejects_other_resources() {
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff, 0xe0, 0, 0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"FONT\0\0\0\0"), None);
    }

    #[test]
    fn unescapes_named_and_numeric_entities() {
        assert_eq!(unescape_entities("A &amp; B"), "A & B");
        assert_eq!(unescape_entities("dash &#8212; here"), "dash — here");
        assert_eq!(unescape_entities("&unknown; stays"), "&unknown; stays");
        assert_eq!(unescape_entities("no entities"), "no entities");
    }

    #[test]
    fn cleans_whitespace_and_drops_empty() {
        assert_eq!(clean("  A   title\n"), Some("A title".to_owned()));
        assert_eq!(clean("   "), None);
    }
}
