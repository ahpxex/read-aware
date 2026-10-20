//! Tests for the font container/metadata layer. The SFNTs under test are
//! synthetic: real fixtures would be license-encumbered binaries, and a
//! hand-built `head`+`name`+`OS/2` face exercises exactly what the importer
//! reads — the directory, the name records and the weight/italic fields.

use super::*;

const TAG_HEAD: u32 = u32::from_be_bytes(*b"head");
const TAG_HHEA: u32 = u32::from_be_bytes(*b"hhea");
const TAG_MAXP: u32 = u32::from_be_bytes(*b"maxp");
const TAG_NAME: u32 = u32::from_be_bytes(*b"name");
const TAG_OS2: u32 = u32::from_be_bytes(*b"OS/2");

/// Minimal valid `head`: unitsPerEm + the magic at offset 12 that ttf-parser
/// validates, plus macStyle so italic is observable.
fn head_table(italic: bool) -> Vec<u8> {
    let mut table = vec![0u8; 54];
    table[12..16].copy_from_slice(&0x5F0F3CF5u32.to_be_bytes());
    table[18..20].copy_from_slice(&1000u16.to_be_bytes()); // unitsPerEm
    if italic {
        table[45] = 0x02; // macStyle italic bit
    }
    table
}

/// `hhea` needs only its length (36 bytes) and a nonzero metrics count.
fn hhea_table() -> Vec<u8> {
    let mut table = vec![0u8; 36];
    table[34..36].copy_from_slice(&1u16.to_be_bytes());
    table
}

/// `maxp` v1.0 with one glyph — ttf-parser requires head/hhea/maxp to parse.
fn maxp_table() -> Vec<u8> {
    let mut table = vec![0u8; 32];
    table[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    table[4..6].copy_from_slice(&1u16.to_be_bytes());
    table
}

/// `OS/2` v0 with the given usWeightClass (offset 4); fsSelection's italic
/// bit (offset 62) is where ttf-parser reads the italic style from.
fn os2_table(weight_class: u16, italic: bool) -> Vec<u8> {
    let mut table = vec![0u8; 78];
    table[4..6].copy_from_slice(&weight_class.to_be_bytes());
    if italic {
        table[63] = 0x01;
    }
    table
}

/// A `name` table (format 0). Windows strings are UTF-16BE as the spec
/// requires; Macintosh strings are single-byte.
fn name_table(records: &[(u16, u16, u16, u16, &[u8])]) -> Vec<u8> {
    let header = 6 + records.len() * 12;
    let mut table = Vec::new();
    table.extend_from_slice(&0u16.to_be_bytes());
    table.extend_from_slice(&(records.len() as u16).to_be_bytes());
    table.extend_from_slice(&(header as u16).to_be_bytes());
    let mut storage = Vec::new();
    for (platform, encoding, language, name_id, text) in records {
        table.extend_from_slice(&platform.to_be_bytes());
        table.extend_from_slice(&encoding.to_be_bytes());
        table.extend_from_slice(&language.to_be_bytes());
        table.extend_from_slice(&name_id.to_be_bytes());
        table.extend_from_slice(&(text.len() as u16).to_be_bytes());
        table.extend_from_slice(&(storage.len() as u16).to_be_bytes());
        storage.extend_from_slice(text);
    }
    table.extend_from_slice(&storage);
    table
}

fn utf16be(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .flat_map(|unit| unit.to_be_bytes())
        .collect()
}

/// nameIDs: 1 = family, 16 = typographic family.
fn face_bytes(family: &str, weight: u16, italic: bool) -> Vec<u8> {
    assemble_sfnt(
        0x0001_0000,
        &[
            (TAG_HEAD, head_table(italic)),
            (TAG_HHEA, hhea_table()),
            (TAG_MAXP, maxp_table()),
            (TAG_NAME, name_table(&[(3, 1, 0x0409, 1, &utf16be(family))])),
            (TAG_OS2, os2_table(weight, italic)),
        ],
    )
}

/// Wrap a face's tables in a WOFF container, compressing the `name` table.
fn woff_wrap(sfnt: &[u8], compress_name: bool) -> Vec<u8> {
    let num_tables = be_u16(sfnt, 4).unwrap() as usize;
    let mut entries = Vec::new();
    for i in 0..num_tables {
        let at = 12 + i * 16;
        entries.push((
            be_u32(sfnt, at).unwrap(),
            be_u32(sfnt, at + 8).unwrap() as usize,
            be_u32(sfnt, at + 12).unwrap() as usize,
        ));
    }
    let mut out = Vec::new();
    out.extend_from_slice(b"wOFF");
    out.extend_from_slice(&sfnt[..4]);
    out.extend_from_slice(&44u32.to_be_bytes()); // length, patched later
    out.extend_from_slice(&(entries.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0; 30]); // reserved + sizes + version fields
    let dir_start = out.len();
    out.resize(dir_start + entries.len() * 20, 0);
    for (i, (tag, offset, len)) in entries.iter().enumerate() {
        let raw = &sfnt[*offset..*offset + *len];
        // WOFF only marks a table compressed when compression actually
        // shrinks it (comp_len < orig_len); tiny tables stay verbatim.
        let packed = if compress_name && *tag == TAG_NAME {
            let deflated = miniz_oxide::deflate::compress_to_vec_zlib(raw, 6);
            if deflated.len() < raw.len() {
                deflated
            } else {
                raw.to_vec()
            }
        } else {
            raw.to_vec()
        };
        let data_offset = out.len();
        out.extend_from_slice(&packed);
        while out.len() % 4 != 0 {
            out.push(0);
        }
        let at = dir_start + i * 20;
        out[at..at + 4].copy_from_slice(&tag.to_be_bytes());
        out[at + 4..at + 8].copy_from_slice(&(data_offset as u32).to_be_bytes());
        out[at + 8..at + 12].copy_from_slice(&(packed.len() as u32).to_be_bytes());
        out[at + 12..at + 16].copy_from_slice(&(*len as u32).to_be_bytes());
    }
    let total = (out.len() as u32).to_be_bytes();
    out[8..12].copy_from_slice(&total);
    out
}

/// Wrap a face's tables in a WOFF2 container: the whole table block travels
/// as one Brotli stream (untransformed — metadata tables never transform).
fn woff2_wrap(sfnt: &[u8]) -> Vec<u8> {
    use std::io::Read;
    let num_tables = be_u16(sfnt, 4).unwrap() as usize;
    let mut entries = Vec::new();
    for i in 0..num_tables {
        let at = 12 + i * 16;
        entries.push((
            be_u32(sfnt, at).unwrap(),
            be_u32(sfnt, at + 8).unwrap() as usize,
            be_u32(sfnt, at + 12).unwrap() as usize,
        ));
    }
    let mut block = Vec::new();
    for (_, offset, len) in &entries {
        block.extend_from_slice(&sfnt[*offset..*offset + *len]);
    }
    let mut compressed = Vec::new();
    brotli::CompressorReader::new(block.as_slice(), 4096, 5, 22)
        .read_to_end(&mut compressed)
        .unwrap();

    let mut out = Vec::new();
    out.extend_from_slice(b"wOF2");
    out.extend_from_slice(&sfnt[..4]);
    out.extend_from_slice(&[0; 4]); // length
    out.extend_from_slice(&(entries.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0; 2]); // reserved
    out.extend_from_slice(&(block.len() as u32).to_be_bytes()); // totalSfntSize
    out.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    out.extend_from_slice(&[0; 24]); // compressed size + version + meta/blocks
    for (tag, _, len) in &entries {
        let index = WOFF2_KNOWN_TAGS
            .iter()
            .position(|known| u32::from_be_bytes(*known) == *tag)
            .unwrap();
        out.push(index as u8); // flags: known tag, no transform
        out.push(*len as u8); // lengths here stay < 253 → one-byte base255
    }
    out.extend_from_slice(&compressed);
    let total = (out.len() as u32).to_be_bytes();
    out[8..12].copy_from_slice(&total);
    out
}

#[test]
fn sniff_format_detects_containers() {
    assert_eq!(sniff_format(&[0, 1, 0, 0, 0]).unwrap().0, "ttf");
    assert_eq!(sniff_format(b"true....").unwrap().0, "ttf");
    assert_eq!(sniff_format(b"OTTO....").unwrap().0, "otf");
    assert_eq!(sniff_format(b"ttcf....").unwrap().0, "ttc");
    assert_eq!(sniff_format(b"wOFF....").unwrap().0, "woff");
    assert_eq!(sniff_format(b"wOF2....").unwrap().0, "woff2");
    assert!(sniff_format(b"PK\x03\x04").is_none());
    assert!(sniff_format(&[0, 1]).is_none());
}

#[test]
fn parse_sfnt_reads_name_weight_italic() {
    let meta = parse_font_metadata(&face_bytes("Read Serif", 700, true)).unwrap();
    assert_eq!(meta.format, "ttf");
    assert_eq!(meta.name.as_deref(), Some("Read Serif"));
    assert_eq!(meta.weight, 700);
    assert!(meta.italic);
    assert_eq!(meta.weight_max, None);
}

#[test]
fn family_name_prefers_typographic_then_family() {
    let face = assemble_sfnt(
        0x0001_0000,
        &[
            (TAG_HEAD, head_table(false)),
            (TAG_HHEA, hhea_table()),
            (TAG_MAXP, maxp_table()),
            (
                TAG_NAME,
                name_table(&[
                    (3, 1, 0x0409, 1, &utf16be("Book Sans SemiBold")),
                    (3, 1, 0x0409, 16, &utf16be("Book Sans")),
                ]),
            ),
            (TAG_OS2, os2_table(400, false)),
        ],
    );
    let meta = parse_font_metadata(&face).unwrap();
    assert_eq!(meta.name.as_deref(), Some("Book Sans"));
}

#[test]
fn woff_roundtrips_verbatim_and_compressed_tables() {
    let sfnt = face_bytes("Reader", 400, false);
    let meta = parse_font_metadata(&woff_wrap(&sfnt, true)).unwrap();
    assert_eq!(meta.format, "woff");
    assert_eq!(meta.name.as_deref(), Some("Reader"), "compressed name");
    let meta = parse_font_metadata(&woff_wrap(&sfnt, false)).unwrap();
    assert_eq!(meta.name.as_deref(), Some("Reader"), "verbatim name");
}

#[test]
fn woff2_roundtrips_metadata() {
    let sfnt = face_bytes("Reader Two", 300, false);
    let meta = parse_font_metadata(&woff2_wrap(&sfnt)).unwrap();
    assert_eq!(meta.format, "woff2");
    assert_eq!(meta.name.as_deref(), Some("Reader Two"));
    assert_eq!(meta.weight, 300);
}

#[test]
fn ttc_parses_first_face() {
    let sfnt = face_bytes("Collection Face", 400, false);
    // In a TTC, table offsets are absolute file offsets, not face-relative:
    // shift the embedded face's directory by the 16-byte collection header.
    let mut face = sfnt.clone();
    let num_tables = be_u16(&face, 4).unwrap() as usize;
    for i in 0..num_tables {
        let at = 12 + i * 16 + 8; // the record's offset field
        let shifted = be_u32(&face, at).unwrap() + 16;
        face[at..at + 4].copy_from_slice(&shifted.to_be_bytes());
    }
    let mut ttc = Vec::new();
    ttc.extend_from_slice(b"ttcf");
    ttc.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    ttc.extend_from_slice(&1u32.to_be_bytes()); // one face
    ttc.extend_from_slice(&16u32.to_be_bytes()); // offset of the face
    ttc.extend_from_slice(&face);
    let meta = parse_font_metadata(&ttc).unwrap();
    assert_eq!(meta.format, "ttc");
    assert_eq!(meta.name.as_deref(), Some("Collection Face"));
}

#[test]
fn ttc_face_extraction_produces_a_standalone_font() {
    // What staging stores: WebViews cannot rasterize collections through
    // @font-face, so the import extracts face 0 into its own SFNT.
    let sfnt = face_bytes("Collection Face", 400, false);
    let mut face = sfnt.clone();
    let num_tables = be_u16(&face, 4).unwrap() as usize;
    for i in 0..num_tables {
        let at = 12 + i * 16 + 8;
        let shifted = be_u32(&face, at).unwrap() + 16;
        face[at..at + 4].copy_from_slice(&shifted.to_be_bytes());
    }
    let mut ttc = Vec::new();
    ttc.extend_from_slice(b"ttcf");
    ttc.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    ttc.extend_from_slice(&1u32.to_be_bytes());
    ttc.extend_from_slice(&16u32.to_be_bytes());
    ttc.extend_from_slice(&face);

    let extracted = extract_ttc_face(&ttc, 0).unwrap();
    assert_eq!(sniff_format(&extracted).unwrap().0, "ttf");
    let meta = parse_font_metadata(&extracted).unwrap();
    assert_eq!(meta.name.as_deref(), Some("Collection Face"));
    assert!(extract_ttc_face(&ttc, 1).is_err());
    assert!(extract_ttc_face(&extracted, 0).is_err()); // not a collection
}

#[test]
fn rejects_non_fonts_and_truncated_containers() {
    assert!(parse_font_metadata(b"not a font at all").is_err());
    assert!(parse_font_metadata(b"wOFF\x00\x00\x00\x01").is_err()); // 8-byte WOFF
    assert!(parse_font_metadata(b"wOF2\x00\x00\x00\x01").is_err()); // 8-byte WOFF2
                                                                    // Truncated WOFF directory: header promises two tables, data ends early.
    let mut woff = woff_wrap(&face_bytes("Cut", 400, false), false);
    woff.truncate(50);
    assert!(parse_font_metadata(&woff).is_err());
}
