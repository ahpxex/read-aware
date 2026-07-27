import { describe, expect, test } from "bun:test";
import { sniffBookFormat } from "./book-format-sniff";

/**
 * These exercise the extension-less path: what an Android SAF pick or a
 * renamed file goes through. Fixtures are built byte-by-byte rather than
 * checked in, so the structural claims (PalmDB record layout, EXTH records,
 * ZIP local headers) stay readable next to the code that reads them.
 */

const MOBI_HEADER_LENGTH = 232;

type ExthRecord = { type: number; value: number };

function palmDoc({
  mobiVersion,
  exth = [],
}: {
  mobiVersion: number;
  exth?: ExthRecord[];
}): Uint8Array {
  const record = buildRecordZero(mobiVersion, exth);
  const numRecords = 2;
  const listBytes = 8 * numRecords;
  const recordStart = 78 + listBytes;
  const file = new Uint8Array(recordStart + record.length + 16);
  const view = new DataView(file.buffer);

  writeAscii(file, 0, "Sample Title");
  writeAscii(file, 60, "BOOK");
  writeAscii(file, 64, "MOBI");
  view.setUint16(76, numRecords);
  view.setUint32(78, recordStart);
  view.setUint32(78 + 8, recordStart + record.length);
  file.set(record, recordStart);
  return file;
}

function buildRecordZero(mobiVersion: number, exth: ExthRecord[]): Uint8Array {
  const exthBytes = exth.length ? buildExth(exth) : new Uint8Array(0);
  const record = new Uint8Array(16 + MOBI_HEADER_LENGTH + exthBytes.length);
  const view = new DataView(record.buffer);
  writeAscii(record, 16, "MOBI");
  view.setUint32(20, MOBI_HEADER_LENGTH);
  view.setUint32(36, mobiVersion);
  view.setUint32(128, exth.length ? 0b100_0000 : 0);
  record.set(exthBytes, 16 + MOBI_HEADER_LENGTH);
  return record;
}

function buildExth(records: ExthRecord[]): Uint8Array {
  const bytes = new Uint8Array(12 + records.length * 12);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "EXTH");
  view.setUint32(4, bytes.length);
  view.setUint32(8, records.length);
  records.forEach((record, index) => {
    const offset = 12 + index * 12;
    view.setUint32(offset, record.type);
    view.setUint32(offset + 4, 12);
    view.setUint32(offset + 8, record.value);
  });
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) target[offset + i] = value.charCodeAt(i);
}

/** A ZIP with one uncompressed entry — enough for the first local header. */
function zipWithFirstEntry(name: string, content: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const bytes = new Uint8Array(30 + nameBytes.length + content.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x504b0304, false);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  bytes.set(nameBytes, 30);
  bytes.set(content, 30 + nameBytes.length);
  return bytes;
}

const file = (bytes: Uint8Array) => new File([bytes as BlobPart], "opaque-saf-pick");

describe("format sniffing without an extension", () => {
  test("MOBI 6 stays MOBI", async () => {
    expect(await sniffBookFormat(file(palmDoc({ mobiVersion: 6 })))).toBe("mobi");
  });

  test("MOBI header version 8 is AZW3/KF8", async () => {
    expect(await sniffBookFormat(file(palmDoc({ mobiVersion: 8 })))).toBe("azw3");
  });

  test("a combo file with a KF8 boundary reads as AZW3, like the engine opens it", async () => {
    const bytes = palmDoc({ mobiVersion: 6, exth: [{ type: 121, value: 42 }] });
    expect(await sniffBookFormat(file(bytes))).toBe("azw3");
  });

  test("an unset boundary leaves a MOBI 6 file alone", async () => {
    const bytes = palmDoc({ mobiVersion: 6, exth: [{ type: 121, value: 0xffffffff }] });
    expect(await sniffBookFormat(file(bytes))).toBe("mobi");
  });

  test("EXTH without a boundary record leaves a MOBI 6 file alone", async () => {
    const bytes = palmDoc({ mobiVersion: 6, exth: [{ type: 201, value: 3 }] });
    expect(await sniffBookFormat(file(bytes))).toBe("mobi");
  });

  test("a comic archive is recognized from its first image entry", async () => {
    const bytes = zipWithFirstEntry("page01.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    expect(await sniffBookFormat(file(bytes))).toBe("cbz");
  });

  test("an EPUB's OCF mimetype entry still wins over the comic check", async () => {
    const bytes = zipWithFirstEntry("mimetype", new TextEncoder().encode("application/epub+zip"));
    expect(await sniffBookFormat(file(bytes))).toBe("epub");
  });

  test("plain UTF-8 prose reads as text, markup as HTML", async () => {
    const text = new TextEncoder().encode("第一章 开端\n正文正文正文。\n");
    expect(await sniffBookFormat(file(text))).toBe("txt");
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body><p>hi</p></body></html>");
    expect(await sniffBookFormat(file(html))).toBe("html");
  });

  test("binary junk is still rejected", async () => {
    const bytes = new Uint8Array(64);
    bytes.fill(0x01);
    expect(await sniffBookFormat(file(bytes))).toBeNull();
  });
});
