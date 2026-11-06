//! Native import primitives shared by the desktop app and the CLI: the
//! streaming content hash and the per-format metadata/cover extractor choice.

use std::io::{BufReader, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::CommandError;
use crate::metadata::BookMetadata;

/// What each format can get natively. `None` = the format carries no cover
/// at all (plain text, HTML), so the outcome is decided without any parsing.
pub enum Extractor {
    Native(fn(&Path) -> Result<BookMetadata, String>),
    NoCover,
    EngineOnly,
}

pub fn extractor_for(format: &str) -> Extractor {
    match format {
        "epub" => Extractor::Native(crate::book_metadata::extract_epub_metadata_from_path),
        "mobi" | "azw3" => Extractor::Native(crate::mobi_metadata::extract_mobi_metadata_from_path),
        "fb2" => Extractor::Native(crate::fb2_metadata::extract_fb2_metadata_from_path),
        "cbz" => Extractor::Native(crate::comic_metadata::extract_comic_metadata_from_path),
        "pdf" => Extractor::Native(crate::pdf_metadata::extract_pdf_metadata_from_path),
        "txt" | "html" => Extractor::NoCover,
        _ => Extractor::EngineOnly,
    }
}

/// Stream-hash a file: one read pass, bounded memory.
pub fn hash_file(path: &Path) -> Result<(String, i64), CommandError> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut size: i64 = 0;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as i64;
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}
