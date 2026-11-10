/**
 * A Palm database book (MOBI, AZW3), read by the native shell where the file
 * is stored (`palm_book.rs`).
 *
 * The reading engine used to receive the whole file and decompress its text
 * in JavaScript, a record at a time. Through this source it asks for the few
 * records it parses (the headers arrive with the opening, the indexes in one
 * request), for text records already decompressed, as many as it wants at
 * once, and names images and fonts by URL.
 */
import type { PalmRecords, TextCoding } from "../../foliate-js/src/mobi";
import { bookResourceBase, fetchBookResource, nativeBookResources, type BookResourcePort } from "./book-resource-url";
import { invoke } from "./ipc";

type OpenedRecords = { contentVersion: string; lengths: number[]; magics: string[]; head: string };

export type PalmRecordsPort = BookResourcePort & {
  open(bookId: string): Promise<OpenedRecords | null>;
};

const nativePort: PalmRecordsPort = {
  ...nativeBookResources,
  open: (bookId) => invoke<OpenedRecords | null>("book_records_open", { bookId }),
};

/** Records fetched ahead of being asked for, in one request: the indexes of a book, not its images. */
const EXPECTED_MAX_BYTES = 8 * 1024 * 1024;

/** The parts of a framed response: a `u32` count, that many `u32` lengths, then the bytes end to end. */
function frames(buffer: ArrayBuffer, expected: number): Uint8Array[] {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 4 ? view.getUint32(0, true) : -1;
  if (count !== expected || buffer.byteLength < 4 + count * 4)
    throw new RangeError("Book records response is malformed");
  const parts: Uint8Array[] = [];
  let offset = 4 + count * 4;
  for (let index = 0; index < count; index++) {
    const length = view.getUint32(4 + index * 4, true);
    if (offset + length > buffer.byteLength) throw new RangeError("Book records response is malformed");
    parts.push(new Uint8Array(buffer, offset, length));
    offset += length;
  }
  return parts;
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * Open the book's records, or null when its file is not on this device.
 * `name` and `type` are the stored file's, for the engine's metadata fallbacks.
 */
export async function openPalmRecords(
  bookId: string,
  name: string,
  type: string,
  port: PalmRecordsPort = nativePort,
): Promise<PalmRecords | null> {
  const opened = await port.open(bookId);
  if (!opened) return null;
  const { lengths, magics } = opened;
  const base = bookResourceBase("palm", bookId, opened.contentVersion);
  const inFile = (index: number) => Number.isSafeInteger(index) && index >= 0 && index < lengths.length;

  const framed = async (path: string, count: number) =>
    frames(await (await fetchBookResource(port, port.resourceUrl(base + path), "Book records")).arrayBuffer(), count);

  // Records already on their way. Each is handed over once: the engine keeps what it parsed, not the bytes.
  const coming = new Map<number, Promise<ArrayBuffer>>([[0, Promise.resolve(decodeBase64(opened.head))]]);
  const fetchRecords = (first: number, last: number) => {
    const parts = framed(`records/${first}-${last}`, last - first + 1);
    for (let index = first; index <= last; index++) {
      const record = parts.then((all) => {
        const part = all[index - first];
        return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
      });
      // A failure belongs to whoever reads the record; one nobody reads is not a failure to report.
      record.catch(() => {});
      coming.set(index, record);
    }
  };

  return {
    name,
    type,
    recordLengths: lengths,
    recordMagic: (index) => magics[index] ?? "",
    expectRecords(first, last) {
      let from = Math.max(first, 0);
      while (from <= last && coming.has(from)) from++;
      let to = from - 1;
      for (let bytes = 0; to < last && inFile(to + 1) && !coming.has(to + 1); to++) {
        bytes += lengths[to + 1];
        if (bytes > EXPECTED_MAX_BYTES) break;
      }
      if (to >= from) fetchRecords(from, to);
    },
    loadRecord(index) {
      if (!inFile(index)) return Promise.reject(new RangeError("Record index out of bounds"));
      if (!coming.has(index)) fetchRecords(index, index);
      const record = coming.get(index)!;
      coming.delete(index);
      return record;
    },
    async loadTextRecords(first, last, coding: TextCoding) {
      if (!inFile(first) || !inFile(last) || last < first) throw new RangeError("Record index out of bounds");
      const query = `c=${coding.compression}&t=${coding.trailingFlags}&h=${coding.huffcdic}&n=${coding.numHuffcdic}`;
      return framed(`text/${first}-${last}?${query}`, last - first + 1);
    },
    async loadResource(index) {
      if (!inFile(index)) throw new RangeError("Record index out of bounds");
      const url = port.resourceUrl(`${base}resource/${index}`);
      return (await fetchBookResource(port, url, "Book resource")).arrayBuffer();
    },
    resourceURL: (index) => (inFile(index) ? port.resourceUrl(`${base}resource/${index}`) : null),
  };
}
