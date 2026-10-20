//! Imported user fonts: staging, metadata parsing, serving, and cleanup.
//!
//! The reader's custom-font story is file-based — mobile platforms cannot
//! enumerate installed families the way desktops can — so the user picks a
//! font file, this module copies it into the blob store as `userfont:<sha256>`
//! (kind `user_font`, synced), parses the SFNT metadata for the registry, and
//! the webview commits `userFont.imported`. `apply_event` projects it into
//! `user_fonts`; `userFont.removed` drops the row and the AFTER DELETE
//! trigger enqueues the blob's release in `user_font_removal_cleanup` — the
//! same device-local intent pattern as `book_removal_cleanup`.
//!
//! Metadata parsing runs natively: WOFF wraps its SFNT tables in per-table
//! zlib streams and WOFF2 in a single Brotli transform buffer, and the
//! WebViews this app ships to cannot inflate either. `ttf-parser` reads the
//! unpacked SFNT — wrapper containers are re-emitted as a plain SFNT holding
//! only the tables that survived verbatim (metadata tables are never
//! transformed, so name/OS/2/fvar always come through).
//!
//! `fontId` is the file's content hash: importing the same file on two
//! devices converges on one registry row and one blob key.

use std::io::Read;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::Digest;
use tauri::Manager;

use crate::error::CommandError;
use crate::storage::{delete_blob_inner, get_blob_record_inner, put_blob_inner, DataDir, Db};

/// Fonts are a few hundred KB to a few dozen MB; 128 MB bounds the metadata
/// parse without rejecting any real font file.
const MAX_FONT_BYTES: i64 = 128 * 1024 * 1024;

/// Blob key the font's bytes live under (`userfont:<sha256>`).
pub(crate) fn user_font_blob_key(font_id: &str) -> String {
    format!("userfont:{font_id}")
}

fn font_invalid(message: impl Into<String>) -> CommandError {
    CommandError::new(crate::error::CODE_FONT_INVALID, message)
}

// ── Metadata parsing ────────────────────────────────────────────────────────

/// What `font_import_stage` learned about the file. `format`/`mime_type` are
/// the stored enum/mime strings shared with the `userFont.imported` payload.
pub(crate) struct FontMeta {
    pub format: &'static str,
    pub mime_type: &'static str,
    /// Parsed family/display name — `None` when the font carries no usable
    /// name record (the caller falls back to the file stem).
    pub name: Option<String>,
    pub weight: i64,
    pub weight_max: Option<i64>,
    pub italic: bool,
}

/// Magic bytes → (stored `format` label, blob MIME). The extension on the
/// file name is never trusted — a mislabeled file fails here or at parse.
fn sniff_format(data: &[u8]) -> Option<(&'static str, &'static str)> {
    let magic = data.get(..4)?;
    Some(match magic {
        [0x00, 0x01, 0x00, 0x00] | b"true" | b"typ1" => ("ttf", "font/ttf"),
        b"OTTO" => ("otf", "font/otf"),
        b"ttcf" | b"OTCF" => ("ttc", "font/collection"),
        b"wOFF" => ("woff", "font/woff"),
        b"wOF2" => ("woff2", "font/woff2"),
        _ => return None,
    })
}

fn be_u16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn be_u32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

/// Re-emit a table set as a minimal SFNT: offset table + records + padded
/// data. `ttf-parser` reads the directory only — searchRange/checksums are
/// ignored fields for it.
fn assemble_sfnt(flavor: u32, tables: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let count = tables.len() as u16;
    let mut out = Vec::new();
    out.extend_from_slice(&flavor.to_be_bytes());
    out.extend_from_slice(&count.to_be_bytes());
    out.extend_from_slice(&[0; 6]);
    let data_start = 12 + tables.len() * 16;
    let mut offset = data_start as u32;
    for (tag, bytes) in tables {
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&offset.to_be_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        offset += (bytes.len() as u32 + 3) & !3;
    }
    for (_, bytes) in tables {
        out.extend_from_slice(bytes);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    out
}

/// Re-emit one face of a TrueType/OpenType collection as a standalone SFNT.
/// WebViews cannot render `.ttc` through @font-face, and collections are the
/// shape CJK fonts actually ship in — the import stores face 0 instead of
/// holding bytes nothing can rasterize. Table offsets in a collection are
/// absolute file offsets, so this copies each recorded table verbatim.
fn extract_ttc_face(data: &[u8], index: usize) -> Result<Vec<u8>, CommandError> {
    if !data.starts_with(b"ttcf") && !data.starts_with(b"OTCF") {
        return Err(font_invalid("Not a font collection"));
    }
    let face_count = be_u32(data, 8).unwrap_or(0) as usize;
    if index >= face_count {
        return Err(font_invalid("Collection face index out of range"));
    }
    let face_offset = be_u32(data, 12 + index * 4)
        .ok_or_else(|| font_invalid("Truncated collection directory"))?
        as usize;
    let flavor =
        be_u32(data, face_offset).ok_or_else(|| font_invalid("Truncated collection face"))?;
    let num_tables = be_u16(data, face_offset + 4)
        .ok_or_else(|| font_invalid("Truncated collection face"))? as usize;
    let mut tables: Vec<(u32, Vec<u8>)> = Vec::with_capacity(num_tables);
    for i in 0..num_tables {
        let at = face_offset + 12 + i * 16;
        let tag = be_u32(data, at).ok_or_else(|| font_invalid("Truncated face directory"))?;
        let offset = be_u32(data, at + 8).unwrap_or(0) as usize;
        let len = be_u32(data, at + 12).unwrap_or(0) as usize;
        let slice = data
            .get(offset..offset.saturating_add(len))
            .filter(|s| s.len() == len)
            .ok_or_else(|| font_invalid("Face table data out of bounds"))?;
        tables.push((tag, slice.to_vec()));
    }
    Ok(assemble_sfnt(flavor, &tables))
}

/// Unpack a WOFF container into its SFNT tables: each table is either
/// verbatim or its own zlib stream.
fn unpack_woff(data: &[u8]) -> Result<Vec<u8>, CommandError> {
    if data.len() < 44 {
        return Err(font_invalid("Truncated WOFF header"));
    }
    let flavor = be_u32(data, 4).ok_or_else(|| font_invalid("Missing WOFF flavor"))?;
    let num_tables =
        be_u16(data, 12).ok_or_else(|| font_invalid("Missing WOFF table count"))? as usize;
    let mut tables: Vec<(u32, Vec<u8>)> = Vec::with_capacity(num_tables);
    for i in 0..num_tables {
        let at = 44 + i * 20;
        let tag = be_u32(data, at).ok_or_else(|| font_invalid("Truncated WOFF directory"))?;
        let offset = be_u32(data, at + 4).unwrap_or(0) as usize;
        let comp_len = be_u32(data, at + 8).unwrap_or(0) as usize;
        let orig_len = be_u32(data, at + 12).unwrap_or(0) as usize;
        let slice = data
            .get(offset..offset.saturating_add(comp_len))
            .filter(|s| s.len() == comp_len)
            .ok_or_else(|| font_invalid("WOFF table data out of bounds"))?;
        let bytes = if comp_len < orig_len {
            let inflated = miniz_oxide::inflate::decompress_to_vec_zlib(slice)
                .map_err(|_| font_invalid("WOFF table failed to inflate"))?;
            if inflated.len() != orig_len {
                return Err(font_invalid("WOFF table size mismatch"));
            }
            inflated
        } else {
            slice.to_vec()
        };
        tables.push((tag, bytes));
    }
    Ok(assemble_sfnt(flavor, &tables))
}

/// The WOFF2 known-tag table (spec section on the table directory): a flags
/// byte's low six bits index this list; `0x3F` means a literal tag follows.
const WOFF2_KNOWN_TAGS: [[u8; 4]; 63] = [
    *b"cmap", *b"head", *b"hhea", *b"hmtx", *b"maxp", *b"name", *b"OS/2", *b"post", *b"cvt ",
    *b"fpgm", *b"glyf", *b"loca", *b"prep", *b"CFF ", *b"VORG", *b"EBDT", *b"EBLC", *b"gasp",
    *b"hdmx", *b"kern", *b"LTSH", *b"PCLT", *b"VDMX", *b"vhea", *b"vmtx", *b"BASE", *b"GDEF",
    *b"GPOS", *b"GSUB", *b"EBSC", *b"JSTF", *b"MATH", *b"CBDT", *b"CBLC", *b"COLR", *b"CPAL",
    *b"SVG ", *b"sbix", *b"acnt", *b"avar", *b"bdat", *b"bloc", *b"bsln", *b"cvar", *b"fdsc",
    *b"feat", *b"fmtx", *b"fvar", *b"gvar", *b"hsty", *b"just", *b"lcar", *b"mort", *b"morx",
    *b"opbd", *b"prop", *b"trak", *b"Zapf", *b"Silf", *b"Glat", *b"Gloc", *b"Feat", *b"Sill",
];

/// A WOFF2 directory length field (255Base16 varint).
fn read_base255(data: &[u8], pos: &mut usize) -> Option<u32> {
    let first = *data.get(*pos)? as u32;
    *pos += 1;
    match first {
        255 => {
            let value = be_u16(data, *pos)? as u32;
            *pos += 2;
            Some(value)
        }
        254 | 253 => {
            let next = *data.get(*pos)? as u32;
            *pos += 1;
            Some(if first == 254 { next + 506 } else { next + 253 })
        }
        _ => Some(first),
    }
}

/// Unpack a WOFF2 container into the SFNT tables that carry metadata. The
/// transform buffer decompresses as one Brotli stream; inside it tables sit
/// contiguous, unpadded, in directory order. Only glyf/loca/hmtx can be
/// transformed — metadata tables always arrive verbatim — so transformed
/// slices are skipped rather than reconstructed.
fn unpack_woff2(data: &[u8]) -> Result<Vec<u8>, CommandError> {
    if data.len() < 48 {
        return Err(font_invalid("Truncated WOFF2 header"));
    }
    let flavor = be_u32(data, 4).ok_or_else(|| font_invalid("Missing WOFF2 flavor"))?;
    let num_tables =
        be_u16(data, 12).ok_or_else(|| font_invalid("Missing WOFF2 table count"))? as usize;
    let compressed_size =
        be_u32(data, 20).ok_or_else(|| font_invalid("Missing WOFF2 size"))? as usize;
    let sfnt_size = be_u32(data, 16).unwrap_or(0) as usize;

    struct Entry {
        tag: u32,
        orig_len: u32,
        transform_len: Option<u32>,
        transformed: bool,
    }
    let mut entries = Vec::with_capacity(num_tables);
    let mut pos = 48;
    for _ in 0..num_tables {
        let flags = *data
            .get(pos)
            .ok_or_else(|| font_invalid("Truncated WOFF2 directory"))?;
        pos += 1;
        let tag_index = flags & 0x3F;
        let tag = if tag_index == 0x3F {
            let literal = be_u32(data, pos).ok_or_else(|| font_invalid("Truncated WOFF2 tag"))?;
            pos += 4;
            literal
        } else {
            u32::from_be_bytes(WOFF2_KNOWN_TAGS[tag_index as usize])
        };
        let transform_version = flags >> 6;
        let orig_len =
            read_base255(data, &mut pos).ok_or_else(|| font_invalid("Truncated WOFF2 length"))?;
        // Spec: transforms only ever apply to glyf/loca (version 0) and hmtx
        // (version 1); every other table stores verbatim bytes.
        let transformed = match &tag.to_be_bytes() {
            b"glyf" | b"loca" => transform_version == 0,
            b"hmtx" => transform_version == 1,
            _ => false,
        };
        let transform_len = if transformed {
            Some(
                read_base255(data, &mut pos)
                    .ok_or_else(|| font_invalid("Truncated WOFF2 transform length"))?,
            )
        } else {
            None
        };
        entries.push(Entry {
            tag,
            orig_len,
            transform_len,
            transformed,
        });
    }

    let compressed = data
        .get(pos..pos.saturating_add(compressed_size))
        .filter(|s| s.len() == compressed_size)
        .ok_or_else(|| font_invalid("Truncated WOFF2 font data"))?;
    // totalSfntSize bounds the decompressed transform buffer.
    let mut buffer = Vec::with_capacity(sfnt_size.min(64 * 1024 * 1024));
    brotli::Decompressor::new(compressed, 4096)
        .read_to_end(&mut buffer)
        .map_err(|_| font_invalid("WOFF2 font data failed to decompress"))?;

    let mut tables: Vec<(u32, Vec<u8>)> = Vec::with_capacity(entries.len());
    let mut offset = 0usize;
    for entry in &entries {
        let len = entry.transform_len.unwrap_or(entry.orig_len) as usize;
        let slice = buffer
            .get(offset..offset.saturating_add(len))
            .filter(|s| s.len() == len)
            .ok_or_else(|| font_invalid("WOFF2 table data out of bounds"))?;
        offset += len;
        if !entry.transformed {
            tables.push((entry.tag, slice.to_vec()));
        }
    }
    Ok(assemble_sfnt(flavor, &tables))
}

/// The display name the font reports for itself: typographic family first
/// (it drops style words family records may carry), then family, then full
/// name. Unicode entries win; en-US ranks ahead of other locales.
fn family_name(face: &ttf_parser::Face) -> Option<String> {
    use ttf_parser::{name_id, PlatformId};
    for wanted in [
        name_id::TYPOGRAPHIC_FAMILY,
        name_id::FAMILY,
        name_id::FULL_NAME,
    ] {
        let mut best: Option<(u8, String)> = None;
        for record in face.names() {
            if record.name_id != wanted {
                continue;
            }
            let rank = match (record.platform_id, record.language_id) {
                (PlatformId::Windows, 0x0409) => 0,
                (PlatformId::Unicode, _) => 1,
                (PlatformId::Windows, _) => 2,
                (PlatformId::Macintosh, _) => 3,
                _ => 4,
            };
            let Some(raw) = record.to_string() else {
                continue;
            };
            let text = raw.trim();
            if text.is_empty() {
                continue;
            }
            // Names going into storage carry no control characters and stay
            // bounded — the string renders inside CSS-family contexts later.
            let clean: String = text
                .chars()
                .filter(|ch| !ch.is_control())
                .take(128)
                .collect();
            if best.as_ref().is_none_or(|(best_rank, _)| rank < *best_rank) {
                best = Some((rank, clean));
            }
        }
        if let Some((_, text)) = best {
            return Some(text);
        }
    }
    None
}

/// Parse the font's metadata: container detection, wrapper unpacking, and the
/// SFNT fields the registry stores. Rejects anything that is not a parseable
/// font — a file whose name table yields nothing still imports (the caller
/// falls back to the file stem) because name-sparse fonts do exist.
pub(crate) fn parse_font_metadata(data: &[u8]) -> Result<FontMeta, CommandError> {
    let (format, mime_type) = sniff_format(data)
        .ok_or_else(|| font_invalid("Not a supported font file (TTF, OTF, TTC, WOFF, WOFF2)"))?;
    let sfnt;
    let raw: &[u8] = match format {
        "woff" => {
            sfnt = unpack_woff(data)?;
            &sfnt
        }
        "woff2" => {
            sfnt = unpack_woff2(data)?;
            &sfnt
        }
        _ => data,
    };
    let face = ttf_parser::Face::parse(raw, 0)
        .map_err(|_| font_invalid("Font file could not be parsed"))?;
    let name = family_name(&face);
    let weight = i64::from(face.weight().to_number());
    let italic = face.is_italic();
    // Variable fonts publish a wght axis range; the reader's @font-face then
    // advertises the span instead of a single weight.
    let weight_max = face
        .variation_axes()
        .into_iter()
        .find(|axis| axis.tag == ttf_parser::Tag::from_bytes(b"wght"))
        .map(|axis| axis.max_value.round() as i64)
        .filter(|max| *max > weight);
    Ok(FontMeta {
        format,
        mime_type,
        name,
        weight,
        weight_max,
        italic,
    })
}

// ── Staging ─────────────────────────────────────────────────────────────────

/// What `font_import_stage` returns: everything the webview needs to commit
/// `userFont.imported` plus whether the row already existed (dedup note —
/// the bytes were still copied/registered, so a manifest-only synced row
/// gets its file).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontStageResult {
    pub font_id: String,
    pub name: String,
    pub format: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub blob_key: String,
    pub weight: i64,
    pub weight_max: Option<i64>,
    pub italic: bool,
    pub already_present: bool,
}

/// The picked file into the blob store, metadata parsed. The webview commits
/// the matching `userFont.imported` event afterwards — staging does not
/// write the registry projection (events own it).
#[tauri::command]
pub async fn font_import_stage(
    app: tauri::AppHandle,
    path: String,
    file_name: Option<String>,
) -> Result<FontStageResult, CommandError> {
    crate::storage::blocking("font_import_stage", move || {
        let source = crate::native_path::materialize(&app, &path)?;
        let picked_name = file_name
            .filter(|name| !name.trim().is_empty())
            .or_else(|| {
                source
                    .path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_default();
        let picked = std::fs::read(&source.path)?;
        if picked.len() as i64 > MAX_FONT_BYTES {
            return Err(CommandError::new(
                crate::error::CODE_FONT_TOO_LARGE,
                format!(
                    "Font file is {} bytes; the limit is {MAX_FONT_BYTES}",
                    picked.len()
                ),
            ));
        }
        let meta = parse_font_metadata(&picked)?;
        // A font with no usable name record still imports; the file stem is
        // the honest fallback label, never silently empty.
        let name = meta.name.unwrap_or_else(|| {
            picked_name
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .filter(|stem| !stem.trim().is_empty())
                .unwrap_or("Imported font")
                .to_string()
        });
        // Collections become a standalone face before storing: WebViews
        // cannot render .ttc via @font-face, and one deterministic extraction
        // keeps the content hash converging across devices.
        let (bytes, format, mime_type): (Vec<u8>, &'static str, &'static str) =
            if meta.format == "ttc" {
                let extracted = extract_ttc_face(&picked, 0)?;
                let (format, mime) = sniff_format(&extracted)
                    .ok_or_else(|| font_invalid("Extracted face is not a font"))?;
                (extracted, format, mime)
            } else {
                (picked, meta.format, meta.mime_type)
            };
        let sha256 = format!("{:x}", sha2::Sha256::digest(&bytes));
        let byte_size = bytes.len() as i64;
        let blob_key = user_font_blob_key(&sha256);
        let data_dir = app.state::<DataDir>();
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        put_blob_inner(&conn, &data_dir.0, &blob_key, Some(mime_type), &bytes)?;
        let already_present: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM user_fonts WHERE id = ?1)",
            params![sha256],
            |row| row.get(0),
        )?;
        Ok(FontStageResult {
            font_id: sha256.clone(),
            name,
            format: format.to_string(),
            file_name: picked_name,
            mime_type: mime_type.to_string(),
            byte_size,
            sha256,
            blob_key,
            weight: meta.weight,
            weight_max: meta.weight_max,
            italic: meta.italic,
            already_present,
        })
    })
    .await
}

// ── Projection reads + removal cleanup ──────────────────────────────────────

/// A registry row as the webview lists it (`userFontsAtom`). `bytes_local`
/// distinguishes "registry knows it, bytes still syncing" — the row renders
/// either way, with the fetch landing lazily.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFontRow {
    pub id: String,
    pub name: String,
    pub format: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub blob_key: String,
    pub weight: i64,
    pub weight_max: Option<i64>,
    pub italic: bool,
    pub created_at: String,
    pub bytes_local: bool,
}

pub(crate) fn list_user_fonts_inner(conn: &Connection) -> Result<Vec<UserFontRow>, CommandError> {
    let mut stmt = conn.prepare(
        "SELECT uf.id, uf.name, uf.format, uf.file_name, uf.mime_type, uf.byte_size,
                uf.sha256, uf.blob_key, uf.weight, uf.weight_max, uf.italic, uf.created_at,
                (bo.storage_uri IS NOT NULL) AS bytes_local
           FROM user_fonts uf
           LEFT JOIN blob_objects bo ON bo.key = uf.blob_key AND bo.deleted_at IS NULL
          ORDER BY uf.created_at, uf.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(UserFontRow {
            id: row.get(0)?,
            name: row.get(1)?,
            format: row.get(2)?,
            file_name: row.get(3)?,
            mime_type: row.get(4)?,
            byte_size: row.get(5)?,
            sha256: row.get(6)?,
            blob_key: row.get(7)?,
            weight: row.get(8)?,
            weight_max: row.get(9)?,
            italic: row.get::<_, i64>(10)? != 0,
            created_at: row.get(11)?,
            bytes_local: row.get::<_, i64>(12)? != 0,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn user_fonts_list(app: tauri::AppHandle) -> Result<Vec<UserFontRow>, CommandError> {
    crate::storage::blocking("user_fonts_list", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        list_user_fonts_inner(&conn)
    })
    .await
}

/// Fonts the registry knows but whose bytes have not landed on this device —
/// the font hydrator's work list (cover_backlog's twin).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontBlobBacklogEntry {
    pub font_id: String,
    pub blob_key: String,
}

pub(crate) fn user_font_backlog_inner(
    conn: &Connection,
) -> Result<Vec<FontBlobBacklogEntry>, CommandError> {
    let mut stmt = conn.prepare(
        "SELECT uf.id, uf.blob_key FROM user_fonts uf
           LEFT JOIN blob_objects bo ON bo.key = uf.blob_key AND bo.deleted_at IS NULL
          WHERE bo.key IS NULL OR bo.storage_uri IS NULL
          ORDER BY uf.created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(FontBlobBacklogEntry {
            font_id: row.get(0)?,
            blob_key: row.get(1)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn user_font_blob_backlog(
    app: tauri::AppHandle,
) -> Result<Vec<FontBlobBacklogEntry>, CommandError> {
    crate::storage::blocking("user_font_blob_backlog", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        user_font_backlog_inner(&conn)
    })
    .await
}

fn require_current_projections(conn: &Connection) -> Result<(), CommandError> {
    if crate::storage::projections_stale_conn(conn)? {
        return Err(CommandError::new(
            crate::error::CODE_FONT_CLEANUP_STALE,
            "Wait for projection recovery before releasing font files",
        ));
    }
    Ok(())
}

/// Removal intents still owed release (font is gone, blob bytes still held).
#[tauri::command]
pub async fn user_fonts_removal_backlog(
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("user_fonts_removal_backlog", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        require_current_projections(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT c.font_id FROM user_font_removal_cleanup c
              WHERE NOT EXISTS(SELECT 1 FROM user_fonts uf WHERE uf.id = c.font_id)
              ORDER BY c.font_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(CommandError::from)
    })
    .await
}

pub(crate) fn release_user_font_files_inner(
    conn: &mut Connection,
    data_dir: &Path,
    ids: &[String],
) -> Result<(), CommandError> {
    let tx = conn.transaction()?;
    require_current_projections(&tx)?;
    for id in ids {
        let present: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM user_fonts WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if present {
            return Err(CommandError::new(
                crate::error::CODE_FONT_STILL_PRESENT,
                "Refusing to release bytes of an imported font",
            ));
        }
    }
    // Files are not transactional (same trade book files make): blob metadata
    // + intent deletion commit together; retries tolerate absent bytes.
    for id in ids {
        let blob_key: String = tx
            .query_row(
                "SELECT blob_key FROM user_font_removal_cleanup WHERE font_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| user_font_blob_key(id));
        delete_blob_inner(&tx, data_dir, &blob_key)?;
        tx.execute(
            "DELETE FROM user_font_removal_cleanup WHERE font_id = ?1",
            [id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Release a removed font's bytes on this device (called right after the
/// local `userFont.removed` commit; remote devices converge via the boot
/// recovery pass).
#[tauri::command]
pub async fn user_fonts_release_files(
    ids: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("user_fonts_release_files", move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        release_user_font_files_inner(&mut conn, &data_dir.0, &ids)
    })
    .await
}

/// One pass at boot — `recover_book_removal_cleanup`'s twin. Failures stay
/// durable and retry next boot.
pub fn recover_user_font_removal_cleanup(db: &Db, data_dir: &Path) -> Result<(), CommandError> {
    let ids = {
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare(
            "SELECT c.font_id FROM user_font_removal_cleanup c
              WHERE NOT EXISTS(SELECT 1 FROM user_fonts uf WHERE uf.id = c.font_id)
              ORDER BY c.font_id",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for id in &ids {
        let mut conn = db.0.lock()?;
        if let Err(error) =
            release_user_font_files_inner(&mut conn, data_dir, std::slice::from_ref(id))
        {
            log::warn!("user font blob cleanup remains pending for {id}: {error}");
        }
    }
    Ok(())
}

// ── rablob serving ─────────────────────────────────────────────────────────

/// Serve `rablob://localhost/font/<sha256>` — the reader's @font-face src.
/// Content-addressed: the key pins the bytes, so the response caches forever.
/// Returns None when the blob is unknown or its bytes never landed.
pub(crate) fn serve_font_blob(app: &tauri::AppHandle, font_id: &str) -> Option<(Vec<u8>, String)> {
    if font_id.len() != 64 || !font_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let db = app.state::<Db>();
    let data_dir = app.state::<DataDir>();
    let conn = db.0.lock().ok()?;
    let key = user_font_blob_key(font_id);
    let (path, info) = get_blob_record_inner(&conn, &data_dir.0, &key).ok()??;
    drop(conn);
    let bytes = std::fs::read(&path).ok()?;
    let mime = info
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    Some((bytes, mime))
}

#[cfg(test)]
#[path = "fonts_tests.rs"]
mod tests;
