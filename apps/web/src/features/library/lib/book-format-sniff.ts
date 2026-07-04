import type { BookFormat } from "./library-types";

/**
 * Detect a book's format from its leading bytes (magic numbers).
 *
 * Fallback for files whose name carries no extension and whose MIME type is
 * empty — most notably Android SAF picks, where the dialog returns an opaque
 * `content://` URI. Purely content-based, so it also rescues renamed files on
 * any platform. Returns `null` when the bytes match no supported format.
 */
export async function sniffBookFormat(file: File): Promise<BookFormat | null> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (head.length < 8) return null;

  const ascii = new TextDecoder("latin1").decode(head);

  // PDF — the spec allows junk before the header, within the first 1024 bytes.
  if (ascii.slice(0, 1024).includes("%PDF-")) return "pdf";

  // ZIP container: EPUB (OCF requires an uncompressed first entry named
  // "mimetype" containing "application/epub+zip") or a zipped FictionBook.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const firstEntryNameLength = head[26]! | (head[27]! << 8);
    const firstEntryName = ascii.slice(30, 30 + firstEntryNameLength);
    if (firstEntryName === "mimetype" && ascii.slice(38, 88).includes("application/epub+zip")) {
      return "epub";
    }
    if (firstEntryName.toLowerCase().endsWith(".fb2")) return "fb2";
    return null;
  }

  // PalmDB: the type/creator code sits at offset 60. "BOOKMOBI" covers MOBI
  // and the KF8/AZW family (one loader reads both); "TEXtREAd" is PalmDOC,
  // which the MOBI loader also accepts.
  const palmType = ascii.slice(60, 68);
  if (palmType === "BOOKMOBI" || palmType === "TEXtREAd") return "mobi";

  // Bare FictionBook XML (optionally after a BOM / XML declaration).
  if (ascii.includes("<FictionBook")) return "fb2";

  return null;
}
