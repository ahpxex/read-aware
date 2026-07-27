//! Import-time cover for comic archives (`.cbz`).
//!
//! A comic archive carries no metadata beyond its file names, so the cover is
//! simply its first page — the same page the reader opens on, chosen with the
//! same natural ordering the vendored comic loader uses.

use std::{fs::File, io::Read, path::Path};

use zip::ZipArchive;

use crate::metadata::{cover_data_url, BookMetadata};

const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS: [&str; 9] = [
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".jxl", ".avif",
];

pub fn extract_comic_metadata_from_path(path: &Path) -> Result<BookMetadata, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;

    let mut names: Vec<String> = (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.name().to_owned()))
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            IMAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
        })
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));

    let Some(first) = names.first() else {
        return Ok(BookMetadata::default());
    };

    let mut entry = archive.by_name(first).map_err(|error| error.to_string())?;
    if entry.size() > MAX_COVER_BYTES {
        return Ok(BookMetadata::default());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    Ok(BookMetadata {
        cover_url: cover_data_url(&bytes),
        ..BookMetadata::default()
    })
}

/// Compare names with embedded numbers by value, so `page2` precedes `page10`.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut left = a.chars().peekable();
    let mut right = b.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let left_number = take_number(&mut left);
                let right_number = take_number(&mut right);
                match left_number.cmp(&right_number) {
                    std::cmp::Ordering::Equal => {}
                    other => return other,
                }
            }
            (Some(x), Some(y)) => {
                let (x, y) = (x.to_ascii_lowercase(), y.to_ascii_lowercase());
                match x.cmp(&y) {
                    std::cmp::Ordering::Equal => {}
                    other => return other,
                }
                left.next();
                right.next();
            }
        }
    }
}

fn take_number(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> u64 {
    let mut value = 0u64;
    while let Some(digit) = chars.peek().and_then(|c| c.to_digit(10)) {
        value = value.saturating_mul(10).saturating_add(digit as u64);
        chars.next();
    }
    value
}

#[tauri::command]
pub async fn extract_comic_metadata(path: String) -> Result<BookMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || extract_comic_metadata_from_path(Path::new(&path)))
        .await
        .map_err(|error| format!("extract_comic_metadata task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    #[test]
    fn takes_the_first_page_by_natural_order_and_ignores_non_images() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("comic.cbz");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for name in ["page10.png", "ComicInfo.xml", "page2.png"] {
            writer.start_file(name, options).unwrap();
            if name.ends_with(".png") {
                let mut bytes = PNG.to_vec();
                bytes.push(if name == "page2.png" { 2 } else { 10 });
                writer.write_all(&bytes).unwrap();
            } else {
                writer.write_all(b"<ComicInfo/>").unwrap();
            }
        }
        writer.finish().unwrap();

        let metadata = extract_comic_metadata_from_path(&path).unwrap();
        let cover = metadata.cover_url.expect("cover");
        assert!(cover.starts_with("data:image/png;base64,"));
        // page2 sorts before page10, and its payload ends with the byte 2.
        let encoded =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, {
                let mut bytes = PNG.to_vec();
                bytes.push(2);
                bytes
            });
        assert!(cover.ends_with(&encoded));
    }

    #[test]
    fn an_archive_without_images_yields_no_cover() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("comic.cbz");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        writer
            .start_file("readme.txt", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"nothing here").unwrap();
        writer.finish().unwrap();

        assert_eq!(
            extract_comic_metadata_from_path(&path).unwrap(),
            BookMetadata::default()
        );
    }
}
