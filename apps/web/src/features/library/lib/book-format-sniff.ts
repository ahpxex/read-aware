import type { BookFormat } from "./library-types";
import { readPalmDocFormat } from "./palmdb-header";

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".jxl",
  ".avif",
];

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
  // "mimetype" containing "application/epub+zip"), a zipped FictionBook, or a
  // comic archive. Only the FIRST local file header is reachable here — the
  // second one sits past the first entry's data — so a comic archive whose
  // first entry is a directory stays undetectable by content and needs its
  // `.cbz` extension. Every other case is decided from this one header.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const firstEntryNameLength = head[26]! | (head[27]! << 8);
    const firstEntryName = ascii.slice(30, 30 + firstEntryNameLength);
    const lowerName = firstEntryName.toLowerCase();
    if (firstEntryName === "mimetype" && ascii.slice(38, 88).includes("application/epub+zip")) {
      return "epub";
    }
    if (lowerName.endsWith(".fb2")) return "fb2";
    if (IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return "cbz";
    return null;
  }

  // RAR: comic archives are the only RAR files this app reads.
  if (ascii.startsWith("Rar!")) return "cbr";

  // PalmDB: the type/creator code sits at offset 60. "BOOKMOBI" covers both
  // MOBI 6 and the KF8 (AZW3) family, so the record-0 headers decide which one
  // this actually is. "TEXtREAd" is PalmDOC, which the MOBI loader accepts.
  const palmType = ascii.slice(60, 68);
  if (palmType === "BOOKMOBI") return readPalmDocFormat(file, head);
  if (palmType === "TEXtREAd") return "mobi";

  // Bare FictionBook XML (optionally after a BOM / XML declaration).
  if (ascii.includes("<FictionBook")) return "fb2";

  // Plain text and single-file HTML carry no magic number. HTML is recognized
  // by its markup; text is whatever decodes cleanly as UTF-8 prose.
  return sniffTextualFormat(head, ascii);
}

/** HTML/XHTML markup within the head window, ignoring leading whitespace/BOM. */
function looksLikeHtml(ascii: string): boolean {
  const start = ascii.slice(0, 1024).toLowerCase();
  return (
    start.includes("<!doctype html") ||
    start.includes("<html") ||
    (start.includes("<head") && start.includes("<body"))
  );
}

function sniffTextualFormat(head: Uint8Array, ascii: string): BookFormat | null {
  if (looksLikeHtml(ascii)) return "html";

  // Valid UTF-8 with no control bytes other than the usual whitespace reads as
  // plain text. A truncated multi-byte sequence at the window edge would fail
  // the strict decode, so the last few bytes are dropped before decoding.
  const trimmed = head.subarray(0, Math.max(0, head.length - 4));
  if (trimmed.length < 4) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(trimmed);
    if (!text.trim()) return null;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return null;
    }
    return "txt";
  } catch {
    return null;
  }
}
