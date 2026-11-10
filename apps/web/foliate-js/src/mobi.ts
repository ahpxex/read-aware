import type { BookFile, BookMetadata } from "./book.js";
import { BookParseError, UnsupportedEncryptionError } from "./errors.js";
import { unescapeHTML } from "./mobi-html.js";
import { MOBI6 } from "./mobi6.js";
import { KF8 } from "./kf8.js";
import {
  PDB_HEADER,
  PALMDOC_HEADER,
  MOBI_HEADER,
  KF8_HEADER,
  MOBI_LANG,
  getStruct,
  getUint,
  getString,
  getEXTH,
  getDecoder,
  decompressPalmDOC,
  huffcdic,
  countBitsSet,
  getVarLenFromEnd,
  getFont,
  getNCX,
} from "./mobi-binary.js";
import type { Struct, Unzlib, EXTH } from "./mobi-binary.js";

type Headers = {
  palmdoc: Struct<typeof PALMDOC_HEADER>;
  mobi: Struct<typeof MOBI_HEADER> & { title: ArrayBuffer; language?: string };
  exth: EXTH | null;
  kf8: Struct<typeof KF8_HEADER> | null;
};
/** How the headers say the text records are coded; what a `PalmRecords` source decompresses them by. */
export type TextCoding = {
  /** PalmDOC header `compression`: 1 stored, 2 PalmDOC, 17480 HUFF/CDIC. */
  compression: number;
  trailingFlags: number;
  /** First HUFF record (absolute index) and how many records the tables span. */
  huffcdic: number;
  numHuffcdic: number;
};

/**
 * READAWARE: a Palm database read outside the engine — the app's native book
 * file, which stays where it is stored. The engine still parses the headers,
 * the indexes and the markup; the source hands it records by index, text
 * records already decompressed, and names images and fonts by URL. Record
 * indexes are the file's own (absolute).
 */
export type PalmRecords = {
  readonly name?: string;
  readonly type: string;
  /** The byte length of every record, in file order. */
  readonly recordLengths: readonly number[];
  /** The four-character tag a record starts with (`INDX`, `RESC`…), or "" when it has none. */
  recordMagic(index: number): string;
  loadRecord(index: number): Promise<ArrayBuffer>;
  /** Records `first..last` are about to be read: they may be fetched together. */
  expectRecords(first: number, last: number): void;
  /** Text records `first..last`, each with its trailing entries removed and decompressed. */
  loadTextRecords(first: number, last: number, coding: TextCoding): Promise<Uint8Array[]>;
  /** A resource record as a page uses it: a font decoded, a media record without its header. */
  loadResource(index: number): Promise<ArrayBuffer>;
  /** A URL a page can load that resource from as it is, or null when the record does not exist. */
  resourceURL(index: number): string | null;
};

export const isMOBI = async (file: BookFile) => {
  const magic = getString(await file.slice(60, 68).arrayBuffer());
  return magic === "BOOKMOBI"; // || magic === 'TEXtREAd'
};

class PDB {
  #file: BookFile | undefined;
  #records: PalmRecords | undefined;
  #offsets: Array<[number, number]> = [];
  #pdb: Struct<typeof PDB_HEADER> | undefined;
  get pdb() {
    if (!this.#pdb) throw new Error("Palm database is not open");
    return this.#pdb;
  }
  /** The source reading the database outside the engine, when there is one. */
  protected get records(): PalmRecords | undefined {
    return this.#records;
  }
  get numRecords(): number {
    return this.#records ? this.#records.recordLengths.length : this.pdb.numRecords;
  }
  async load(file: BookFile | PalmRecords): Promise<void> {
    if ("recordLengths" in file) {
      this.#records = file;
      return;
    }
    this.#file = file;
    const pdb = getStruct(PDB_HEADER, await file.slice(0, 78).arrayBuffer());
    this.#pdb = pdb;
    const buffer = await file.slice(78, 78 + pdb.numRecords * 8).arrayBuffer();
    // get start and end offsets for each record
    this.#offsets = Array.from({ length: pdb.numRecords }, (_, i) => getUint(buffer.slice(i * 8, i * 8 + 4))).map(
      (start, i, all) => {
        const end = all[i + 1] ?? file.size;
        if (start < 78 + pdb.numRecords * 8 || end < start || end > file.size)
          throw new BookParseError("Invalid Palm database record offsets");
        return [start, end];
      },
    );
  }
  loadRecord(index: number): Promise<ArrayBuffer> {
    if (this.#records) {
      if (!(index >= 0 && index < this.#records.recordLengths.length))
        throw new RangeError("Record index out of bounds");
      return this.#records.loadRecord(index);
    }
    const offsets = this.#offsets[index];
    if (!offsets || !this.#file) throw new RangeError("Record index out of bounds");
    return this.#file.slice(...offsets).arrayBuffer();
  }
  async loadMagic(index: number): Promise<string> {
    if (this.#records) {
      if (!(index >= 0 && index < this.#records.recordLengths.length))
        throw new RangeError("Record index out of bounds");
      return this.#records.recordMagic(index);
    }
    const offsets = this.#offsets[index];
    if (!offsets || !this.#file) throw new RangeError("Record index out of bounds");
    const [start, end] = offsets;
    if (end - start < 4) return "";
    return getString(await this.#file.slice(start, start + 4).arrayBuffer());
  }
}

export class MOBI extends PDB {
  readonly unzlib: Unzlib;
  #headers: Headers | undefined;
  #start = 0;
  #resourceStart = 0;
  #decoder = new TextDecoder();
  #encoder = new TextEncoder();
  #decompress: ((bytes: Uint8Array) => Uint8Array) | undefined;
  #removeTrailingEntries: ((bytes: Uint8Array) => Uint8Array) | undefined;
  #coding: TextCoding | undefined;
  constructor({ unzlib }: { unzlib: Unzlib }) {
    super();
    this.unzlib = unzlib;
  }
  get headers(): Headers {
    if (!this.#headers) throw new Error("MOBI is not open");
    return this.#headers;
  }
  get recordCount() {
    return this.numRecords - this.#start;
  }
  async open(file: BookFile | PalmRecords): Promise<MOBI6 | KF8> {
    await super.load(file);
    // TODO: if (this.pdb.type === 'TEXt')
    this.#headers = this.#getHeaders(await super.loadRecord(0));
    this.#resourceStart = this.headers.mobi.resourceStart;
    let isKF8 = this.headers.mobi.version >= 8;
    if (!isKF8) {
      const boundary = this.headers.exth?.boundary;
      if (boundary != null && boundary < 0xffffffff)
        try {
          // it's a "combo" MOBI/KF8 file; try to open the KF8 part
          const headers = this.#getHeaders(await super.loadRecord(boundary));
          if (!headers.kf8) throw new Error("Combo MOBI has no KF8 header at its boundary");
          this.#headers = headers;
          this.#start = boundary;
          isKF8 = true;
        } catch (e) {
          console.warn(e);
          console.warn("Failed to open KF8; falling back to MOBI");
        }
    }
    await this.#setup();
    return isKF8 ? new KF8(this).init() : new MOBI6(this).init();
  }
  #getHeaders(buf: ArrayBuffer): Headers {
    // Identify the header before trusting its fields: a combo file whose
    // KF8 boundary points at some other record would otherwise read that
    // record's bytes as an "encryption" flag and be reported as DRM.
    if (buf.byteLength < 20 || getString(buf.slice(16, 20)) !== "MOBI") throw new BookParseError("Missing MOBI header");
    const palmdoc = getStruct(PALMDOC_HEADER, buf);
    if (palmdoc.encryption) throw new UnsupportedEncryptionError("MOBI");
    const base = getStruct(MOBI_HEADER, buf);
    const lang = MOBI_LANG[base.localeLanguage];
    const mobi = {
      ...base,
      title: buf.slice(base.titleOffset, base.titleOffset + base.titleLength),
      language: lang?.[base.localeRegion >> 2] ?? lang?.[0] ?? undefined,
    };

    const exth = mobi.exthFlag & 0b100_0000 ? getEXTH(buf.slice(mobi.length + 16), mobi.encoding) : null;
    const kf8 = mobi.version >= 8 ? getStruct(KF8_HEADER, buf) : null;
    return { palmdoc, mobi, exth, kf8 };
  }
  async #setup() {
    const { palmdoc, mobi } = this.headers;
    this.#decoder = getDecoder(mobi.encoding);
    // `TextEncoder` only supports UTF-8
    // we are only encoding ASCII anyway, so I think it's fine
    this.#encoder = new TextEncoder();

    // READAWARE: a source that reads the file where it is stored decompresses
    // there; it is told how, and no decompressor is built here.
    if (this.records) {
      const { compression } = palmdoc;
      if (compression !== 1 && compression !== 2 && compression !== 17480)
        throw new BookParseError("Unknown MOBI compression type");
      const huff = compression === 17480;
      this.#coding = {
        compression,
        trailingFlags: mobi.trailingFlags,
        // Meaningful only for HUFF/CDIC text; elsewhere the header says "no record".
        huffcdic: huff ? this.#start + mobi.huffcdic : 0,
        numHuffcdic: huff ? mobi.numHuffcdic : 0,
      };
      return;
    }

    // set up decompressor
    const { compression } = palmdoc;
    this.#decompress =
      compression === 1
        ? (bytes) => bytes
        : compression === 2
          ? decompressPalmDOC
          : compression === 17480
            ? await huffcdic(mobi, this.loadRecord.bind(this))
            : undefined;
    if (!this.#decompress) throw new BookParseError("Unknown MOBI compression type");

    // set up function for removing trailing bytes
    const { trailingFlags } = mobi;
    const multibyte = trailingFlags & 1;
    const numTrailingEntries = countBitsSet(trailingFlags >>> 1);
    this.#removeTrailingEntries = (array) => {
      for (let i = 0; i < numTrailingEntries; i++) {
        const length = getVarLenFromEnd(array);
        if (!length || length > array.length) throw new BookParseError("Invalid MOBI trailing entry length");
        array = array.subarray(0, -length);
      }
      if (multibyte) {
        const length = (array[array.length - 1] & 0b11) + 1;
        array = array.subarray(0, -length);
      }
      return array;
    };
  }
  decode(...args: Parameters<TextDecoder["decode"]>) {
    return this.#decoder.decode(...args);
  }
  encode(...args: Parameters<TextEncoder["encode"]>) {
    return this.#encoder.encode(...args);
  }
  override loadRecord(index: number) {
    return super.loadRecord(this.#start + index);
  }
  override loadMagic(index: number) {
    return super.loadMagic(this.#start + index);
  }
  loadText(index: number): Promise<Uint8Array> {
    if (this.records) return this.loadTexts(index, index).then(([text]) => text);
    if (!this.#removeTrailingEntries || !this.#decompress) throw new Error("MOBI decompressor is not ready");
    return this.loadRecord(index + 1)
      .then((buf) => new Uint8Array(buf))
      .then(this.#removeTrailingEntries)
      .then(this.#decompress);
  }
  /** READAWARE: text records `first..last` in one request where the source reads them together. */
  async loadTexts(first: number, last: number): Promise<Uint8Array[]> {
    if (last < first) return [];
    if (this.records) {
      if (!this.#coding) throw new Error("MOBI decompressor is not ready");
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0)
        throw new RangeError("Record index out of bounds");
      return this.records.loadTextRecords(this.#start + first + 1, this.#start + last + 1, this.#coding);
    }
    const texts: Uint8Array[] = [];
    for (let index = first; index <= last; index++) texts.push(await this.loadText(index));
    return texts;
  }
  /** READAWARE: records `first..last` (as `loadRecord` counts them) are about to be read. */
  expectRecords(first: number, last: number) {
    if (last >= first) this.records?.expectRecords(this.#start + first, this.#start + last);
  }
  /** READAWARE: a URL the resource can be loaded from as it is, when the source serves the file. */
  resourceURL(index: number): string | null {
    if (!Number.isSafeInteger(index) || index < 0) return null;
    return this.records?.resourceURL(this.#resourceStart + index) ?? null;
  }
  async loadResource(index: number) {
    // Decoded where the file is read: a font arrives deobfuscated and inflated.
    if (this.records) return this.records.loadResource(this.#resourceStart + index);
    const buf = await super.loadRecord(this.#resourceStart + index);
    const magic = getString(buf.slice(0, 4));
    if (magic === "FONT") return getFont(buf, this.unzlib);
    if (magic === "VIDE" || magic === "AUDI") return buf.slice(12);
    return buf;
  }
  getNCX() {
    const index = this.headers.mobi.indx;
    if (index < 0xffffffff) return getNCX(index, this.loadRecord.bind(this));
  }
  getMetadata(): BookMetadata {
    const { mobi, exth } = this.headers;
    return {
      identifier: mobi.uid.toString(),
      title: unescapeHTML(exth?.title || this.decode(mobi.title)),
      author: exth?.creator?.map(unescapeHTML),
      publisher: unescapeHTML(exth?.publisher),
      language: exth?.language ?? mobi.language,
      published: exth?.date,
      description: unescapeHTML(exth?.description),
      subject: exth?.subject?.map(unescapeHTML),
      rights: unescapeHTML(exth?.rights),
      contributor: exth?.contributor,
    };
  }
  async getCover() {
    const { exth } = this.headers;
    const offset =
      exth?.coverOffset != null && exth.coverOffset < 0xffffffff
        ? exth.coverOffset
        : exth?.thumbnailOffset != null && exth.thumbnailOffset < 0xffffffff
          ? exth.thumbnailOffset
          : null;
    if (offset != null) {
      const buf = await this.loadResource(offset);
      return new Blob([buf]);
    }
  }
}
