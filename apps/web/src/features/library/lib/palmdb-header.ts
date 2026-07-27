import type { BookFormat } from "./library-types";

/**
 * Tell MOBI 6 apart from KF8 (AZW3) inside a PalmDB container.
 *
 * Both carry the same `BOOKMOBI` type code at offset 60, so the leading bytes
 * cannot separate them — the answer lives in record 0's MOBI header. This
 * mirrors `MOBI.open()` in the vendored engine (`public/foliate-js/mobi.js`)
 * so the shelf's format label matches the loader that will actually run:
 * version 8 or higher is KF8, and a MOBI 6 file carrying an EXTH boundary
 * record is a "combo" whose KF8 part the engine opens in preference.
 *
 * Only reached for files that arrive without a usable extension or MIME type
 * (Android SAF picks, renamed files); everything else is decided by name.
 */

/** MOBI headers plus their EXTH block; far beyond this is book text. */
const MAX_RECORD_BYTES = 128 * 1024;
const EXTH_BOUNDARY_TYPE = 121;
const NOT_SET = 0xffffffff;

const PDB_RECORD_LIST_OFFSET = 78;
const PDB_RECORD_ENTRY_BYTES = 8;

export async function readPalmDocFormat(
  file: File,
  head: Uint8Array,
): Promise<BookFormat> {
  try {
    const record = await readFirstRecord(file, head);
    return record && isKf8Record(record) ? "azw3" : "mobi";
  } catch {
    // A malformed or truncated header is still a book the MOBI loader may
    // recover; only the shelf's format label is at stake here.
    return "mobi";
  }
}

async function readFirstRecord(file: File, head: Uint8Array): Promise<DataView | null> {
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const numRecords = headView.getUint16(76);
  if (numRecords < 1) return null;

  const listEnd = PDB_RECORD_LIST_OFFSET + numRecords * PDB_RECORD_ENTRY_BYTES;
  const list = listEnd <= head.byteLength
    ? headView
    : new DataView(await file.slice(0, listEnd).arrayBuffer());
  if (list.byteLength < PDB_RECORD_LIST_OFFSET + PDB_RECORD_ENTRY_BYTES) return null;

  const start = list.getUint32(PDB_RECORD_LIST_OFFSET);
  const next = numRecords > 1
    ? list.getUint32(PDB_RECORD_LIST_OFFSET + PDB_RECORD_ENTRY_BYTES)
    : file.size;
  const end = Math.min(next > start ? next : file.size, start + MAX_RECORD_BYTES);
  if (!(end > start)) return null;

  return new DataView(await file.slice(start, end).arrayBuffer());
}

function isKf8Record(record: DataView): boolean {
  // PalmDOC header occupies the first 16 bytes; the MOBI header follows.
  if (record.byteLength < 132 || readAscii(record, 16, 4) !== "MOBI") return false;
  if (record.getUint32(36) >= 8) return true;

  const hasExth = (record.getUint32(128) & 0b100_0000) !== 0;
  if (!hasExth) return false;
  const boundary = readExthBoundary(record, record.getUint32(20) + 16);
  return boundary != null && boundary < NOT_SET;
}

/** The EXTH `boundary` record (type 121): where a combo file's KF8 part starts. */
function readExthBoundary(record: DataView, start: number): number | null {
  if (start + 12 > record.byteLength || readAscii(record, start, 4) !== "EXTH") return null;
  const count = record.getUint32(start + 8);
  let offset = start + 12;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > record.byteLength) return null;
    const type = record.getUint32(offset);
    const length = record.getUint32(offset + 4);
    if (length < 8) return null;
    if (type === EXTH_BOUNDARY_TYPE) {
      return offset + 12 <= record.byteLength ? record.getUint32(offset + 8) : null;
    }
    offset += length;
  }
  return null;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i++) value += String.fromCharCode(view.getUint8(offset + i));
  return value;
}
