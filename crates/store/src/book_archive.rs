//! A book's ZIP archive (EPUB, CBZ), read where the file is.
//!
//! The reading engine used to copy a book's bytes into the webview and unpack
//! them there: every image and stylesheet a page referenced was inflated in
//! JavaScript, one after another, before the page could load. Here the
//! archive is opened natively and read an entry at a time, so the webview
//! asks for the few small documents it parses itself and leaves everything a
//! page merely displays to be fetched by URL, off its main thread.
//!
//! This is not a second parser: the engine still reads the package document,
//! the navigation and the pages. Only the unpacking moved.
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;
use zip::ZipArchive;

use crate::error::CommandError;

/// One entry read whole into memory may not exceed this: a larger one is a
/// malformed or hostile archive, not a page resource.
const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
/// A document the engine parses as text (package, navigation, a page).
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub name: String,
    /// Uncompressed size in bytes: what the engine weighs sections by.
    pub size: u64,
}

pub struct BookArchive {
    path: PathBuf,
    archive: ZipArchive<File>,
}

/// The file is there but is not what its format says: damaged, truncated or hostile.
fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new("book/parse-failed", message.into())
}

impl BookArchive {
    pub fn open(path: &Path) -> Result<Self, CommandError> {
        let file = File::open(path)?;
        let archive = ZipArchive::new(file)
            .map_err(|error| invalid(format!("Book archive is not a readable ZIP: {error}")))?;
        Ok(Self {
            path: path.to_path_buf(),
            archive,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every file in the archive, in archive order. Directories are not entries.
    pub fn entries(&mut self) -> Vec<ArchiveEntry> {
        let mut entries = Vec::with_capacity(self.archive.len());
        for index in 0..self.archive.len() {
            // An unreadable header hides that one entry, not the book.
            let Ok(entry) = self.archive.by_index_raw(index) else {
                continue;
            };
            if entry.is_dir() {
                continue;
            }
            entries.push(ArchiveEntry {
                name: entry.name().to_owned(),
                size: entry.size(),
            });
        }
        entries
    }

    fn read_bounded(&mut self, name: &str, limit: u64) -> Result<Option<Vec<u8>>, CommandError> {
        let mut entry = match self.archive.by_name(name) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::FileNotFound) => return Ok(None),
            Err(error) => {
                return Err(invalid(format!(
                    "Book archive entry {name} is unreadable: {error}"
                )))
            }
        };
        if entry.is_dir() {
            return Ok(None);
        }
        if entry.size() > limit {
            return Err(invalid(format!(
                "Book archive entry {name} exceeds the {limit}-byte limit"
            )));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        // The declared size is the archive's claim; the cap is enforced on what is actually read.
        (&mut entry)
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                invalid(format!("Book archive entry {name} is unreadable: {error}"))
            })?;
        if bytes.len() as u64 > limit {
            return Err(invalid(format!(
                "Book archive entry {name} exceeds the {limit}-byte limit"
            )));
        }
        Ok(Some(bytes))
    }

    /// An entry's bytes, or `None` when the archive has no such file.
    pub fn read(&mut self, name: &str) -> Result<Option<Vec<u8>>, CommandError> {
        self.read_bounded(name, MAX_ENTRY_BYTES)
    }

    /// An entry decoded as the engine decodes it: UTF-8, with a byte-order
    /// mark dropped and undecodable bytes replaced rather than refused.
    pub fn read_text(&mut self, name: &str) -> Result<Option<String>, CommandError> {
        let Some(bytes) = self.read_bounded(name, MAX_TEXT_BYTES)? else {
            return Ok(None);
        };
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        Ok(Some(String::from_utf8_lossy(bytes).into_owned()))
    }
}

/// The entry a resource URL's path names: percent-decoded UTF-8. A path that
/// does not decode names no entry.
pub fn entry_name_from_url_path(path: &str) -> Option<String> {
    percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()
        .map(|name| name.into_owned())
}

/// The media type a page resource is served with. The archive does not record
/// one and the webview refuses a font or an SVG image served as plain bytes,
/// so it follows the entry's extension, then the bytes for images.
///
/// A book is untrusted content, and these responses come from the app's own
/// resource scheme. Only what a page displays gets a type the webview acts on:
/// an entry that could run as a document or a script (HTML, XHTML, XML,
/// JavaScript) is served as opaque bytes, which the engine can still read but
/// nothing can navigate to or execute. See also `RESOURCE_CONTENT_POLICY`.
pub fn entry_media_type(name: &str, bytes: &[u8]) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "txt" => "text/plain",
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttc" => "font/collection",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        _ => crate::metadata::image_mime(bytes).unwrap_or("application/octet-stream"),
    }
}

/// The `Content-Security-Policy` every book resource response carries: opened
/// as a document (an SVG is one), it runs nothing and loads nothing, whatever
/// its bytes say. Inline styles stay, which an SVG shown as an image needs.
pub const RESOURCE_CONTENT_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    fn archive(entries: &[(&str, &[u8], CompressionMethod)]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes, method) in entries {
            if name.ends_with('/') {
                writer
                    .add_directory(name.trim_end_matches('/'), SimpleFileOptions::default())
                    .unwrap();
                continue;
            }
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(*method),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        (dir, path)
    }

    #[test]
    fn lists_files_with_uncompressed_sizes_and_reads_them_by_name() {
        let page = "<html><body>text</body></html>".repeat(200);
        let (_dir, path) = archive(&[
            (
                "mimetype",
                b"application/epub+zip",
                CompressionMethod::Stored,
            ),
            ("OEBPS/", b"", CompressionMethod::Stored),
            (
                "OEBPS/Text/one.xhtml",
                page.as_bytes(),
                CompressionMethod::Deflated,
            ),
            (
                "OEBPS/Images/a b.png",
                b"\x89PNG\r\n\x1a\nrest",
                CompressionMethod::Stored,
            ),
        ]);
        let mut book = BookArchive::open(&path).unwrap();
        assert_eq!(
            book.entries(),
            vec![
                ArchiveEntry {
                    name: "mimetype".into(),
                    size: 20
                },
                ArchiveEntry {
                    name: "OEBPS/Text/one.xhtml".into(),
                    size: page.len() as u64
                },
                ArchiveEntry {
                    name: "OEBPS/Images/a b.png".into(),
                    size: 12
                },
            ]
        );
        assert_eq!(
            book.read_text("OEBPS/Text/one.xhtml").unwrap().unwrap(),
            page
        );
        assert_eq!(
            book.read("OEBPS/Images/a b.png").unwrap().unwrap(),
            b"\x89PNG\r\n\x1a\nrest"
        );
        // Absent files and directories are not content; neither is an error.
        assert_eq!(book.read("OEBPS/missing.css").unwrap(), None);
        assert_eq!(book.read("OEBPS/").unwrap(), None);
        // The same archive answers again after a miss.
        assert_eq!(
            book.read_text("mimetype").unwrap().unwrap(),
            "application/epub+zip"
        );
    }

    #[test]
    fn text_is_utf8_without_its_byte_order_mark_and_never_refused_for_bad_bytes() {
        let (_dir, path) = archive(&[
            (
                "bom.opf",
                b"\xEF\xBB\xBF<package/>",
                CompressionMethod::Stored,
            ),
            ("broken.xhtml", b"<p>caf\xE9</p>", CompressionMethod::Stored),
            (
                "中文.xhtml",
                "<p>中文</p>".as_bytes(),
                CompressionMethod::Deflated,
            ),
        ]);
        let mut book = BookArchive::open(&path).unwrap();
        assert_eq!(book.read_text("bom.opf").unwrap().unwrap(), "<package/>");
        assert_eq!(
            book.read_text("broken.xhtml").unwrap().unwrap(),
            "<p>caf\u{fffd}</p>"
        );
        assert_eq!(
            book.read_text("中文.xhtml").unwrap().unwrap(),
            "<p>中文</p>"
        );
    }

    #[test]
    fn a_file_that_is_not_an_archive_is_damaged_and_a_missing_one_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        std::fs::write(&path, b"not a zip").unwrap();
        let error = BookArchive::open(&path).err().unwrap();
        assert_eq!(error.code, "book/parse-failed");
        let missing = BookArchive::open(&dir.path().join("absent.epub"))
            .err()
            .unwrap();
        assert_eq!(missing.code, "fs/not-found");
    }

    #[test]
    fn a_resource_url_path_names_its_entry_percent_decoded() {
        assert_eq!(
            entry_name_from_url_path("OEBPS/Images/a%20b.png").as_deref(),
            Some("OEBPS/Images/a b.png")
        );
        assert_eq!(
            entry_name_from_url_path("%E4%B8%AD%E6%96%87.xhtml").as_deref(),
            Some("中文.xhtml")
        );
        assert_eq!(
            entry_name_from_url_path("plain.css").as_deref(),
            Some("plain.css")
        );
        assert_eq!(entry_name_from_url_path("bad%FFname"), None);
    }

    #[test]
    fn media_types_follow_the_extension_and_fall_back_to_image_bytes() {
        assert_eq!(entry_media_type("OEBPS/Styles/main.CSS", b""), "text/css");
        assert_eq!(entry_media_type("fonts/a.woff2", b""), "font/woff2");
        assert_eq!(entry_media_type("fonts/a.otf", b""), "font/otf");
        assert_eq!(entry_media_type("img/photo.JPG", b""), "image/jpeg");
        assert_eq!(entry_media_type("img/figure.svg", b""), "image/svg+xml");
        // Nothing a book carries is served as a document or a script.
        for active in [
            "page.xhtml",
            "page.HTML",
            "run.js",
            "package.opf",
            "toc.ncx",
            "data.xml",
        ] {
            assert_eq!(
                entry_media_type(active, b"<html/>"),
                "application/octet-stream"
            );
        }
        assert_eq!(entry_media_type("cover", b"\x89PNG\r\n\x1a\n"), "image/png");
        assert_eq!(
            entry_media_type("data.bin", b"plain"),
            "application/octet-stream"
        );
    }
}
