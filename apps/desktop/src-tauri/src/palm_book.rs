//! Desktop side of native Palm database books (MOBI, AZW3): the IPC the
//! reading engine opens one through, and the `rablob://localhost/palm/…`
//! resources it reads records, decompressed text and page resources from.
//! The file itself is read by `read_aware_store::palm_book`.
use base64::Engine as _;
use read_aware_store::palm_book::{frame, resource_media_type, PalmBook, TextCoding};
use serde::Serialize;
use tauri::Manager;

use crate::book_files::{failure_status, OpenBooks, Served, NOT_FOUND};
use crate::error::CommandError;

pub type PalmBooks = OpenBooks<PalmBook>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRecords {
    /// `sha256:<hex>`, the content version every consumer of the book shares.
    content_version: String,
    /// The byte length of every record, in file order.
    lengths: Vec<u64>,
    /// The tag of every record that starts with one (`INDX`, `RESC`…), else empty.
    magics: Vec<String>,
    /// Record 0 (the headers), base64: what the engine parses before it can
    /// ask for anything else.
    head: String,
}

/// The database's record table and its header record. `null` when the book's
/// file is not on this device.
#[tauri::command]
pub async fn book_records_open(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<Option<OpenedRecords>, CommandError> {
    crate::storage::blocking("book_records_open", move || {
        let books = app.state::<PalmBooks>();
        let Some((book, sha256)) = books.get(&app, &book_id, None, PalmBook::open)? else {
            return Ok(None);
        };
        let mut book = book.lock()?;
        Ok(Some(OpenedRecords {
            content_version: format!("sha256:{sha256}"),
            lengths: book.record_lengths(),
            magics: book.record_magics()?,
            head: base64::engine::general_purpose::STANDARD.encode(book.record(0)?),
        }))
    })
    .await
}

/// `first-last`, both inclusive.
fn span(value: &str) -> Option<(usize, usize)> {
    let (first, last) = value.split_once('-')?;
    Some((first.parse().ok()?, last.parse().ok()?))
}

/// The text coding the engine read from the book's headers, as the query
/// `c=<compression>&t=<trailingFlags>&h=<first HUFF record>&n=<HUFF records>`.
fn text_coding(query: &str) -> Option<TextCoding> {
    let mut coding = TextCoding {
        compression: 0,
        trailing_flags: 0,
        huffcdic: 0,
        huffcdic_count: 0,
    };
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=')?;
        let value: u32 = value.parse().ok()?;
        match name {
            "c" => coding.compression = value,
            "t" => coding.trailing_flags = value,
            "h" => coding.huffcdic = value,
            "n" => coding.huffcdic_count = value,
            _ => return None,
        }
    }
    Some(coding)
}

/// `rablob://localhost/palm/<bookId>/<sha256>/…`, pinned to the content like
/// an archive resource:
///
/// - `records/<first>-<last>`: those records as stored, framed;
/// - `text/<first>-<last>?c=…&t=…&h=…&n=…`: those text records decompressed,
///   framed;
/// - `resource/<index>`: one resource record as a page uses it.
pub fn serve_palm_resource(app: &tauri::AppHandle, path: &str, query: &str) -> Served {
    let mut parts = path.splitn(4, '/');
    let (Some(book_id), Some(sha256), Some(kind), Some(target)) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(NOT_FOUND);
    };
    let books = app.state::<PalmBooks>();
    let read = books
        .get(app, book_id, Some(sha256), PalmBook::open)
        .and_then(|opened| {
            let Some((book, _)) = opened else {
                return Ok(None);
            };
            let mut book = book.lock()?;
            Ok(match kind {
                "records" => match span(target) {
                    Some((first, last)) => Some((
                        frame(&book.records(first, last)?),
                        "application/octet-stream",
                    )),
                    None => None,
                },
                "text" => match span(target).zip(text_coding(query)) {
                    Some(((first, last), coding)) => Some((
                        frame(&book.text_records(first, last, coding)?),
                        "application/octet-stream",
                    )),
                    None => None,
                },
                "resource" => match target.parse() {
                    Ok(index) => {
                        let bytes = book.resource(index)?;
                        let media_type = resource_media_type(&bytes);
                        Some((bytes, media_type))
                    }
                    Err(_) => None,
                },
                _ => None,
            })
        });
    match read {
        Ok(Some(response)) => Ok(response),
        Ok(None) => Err(NOT_FOUND),
        Err(error) => {
            log::warn!("palm book {kind} read failed: {}", error.message);
            Err(failure_status(&error))
        }
    }
}
