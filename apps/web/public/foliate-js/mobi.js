import { UnsupportedEncryptionError } from './errors.js';
import { unescapeHTML } from './mobi-html.js';
import { MOBI6 } from './mobi6.js';
import { KF8 } from './kf8.js';
import { PDB_HEADER, PALMDOC_HEADER, MOBI_HEADER, KF8_HEADER, MOBI_LANG, getStruct, getUint, getString, getEXTH, getDecoder, decompressPalmDOC, huffcdic, countBitsSet, getVarLenFromEnd, getFont, getNCX } from './mobi-binary.js';
export const isMOBI = async (file) => {
    const magic = getString(await file.slice(60, 68).arrayBuffer());
    return magic === 'BOOKMOBI'; // || magic === 'TEXtREAd'
};
class PDB {
    #file;
    #offsets = [];
    #pdb;
    get pdb() {
        if (!this.#pdb)
            throw new Error('Palm database is not open');
        return this.#pdb;
    }
    async load(file) {
        this.#file = file;
        const pdb = getStruct(PDB_HEADER, await file.slice(0, 78).arrayBuffer());
        this.#pdb = pdb;
        const buffer = await file.slice(78, 78 + pdb.numRecords * 8).arrayBuffer();
        // get start and end offsets for each record
        this.#offsets = Array.from({ length: pdb.numRecords }, (_, i) => getUint(buffer.slice(i * 8, i * 8 + 4)))
            .map((start, i, all) => {
            const end = all[i + 1] ?? file.size;
            if (start < 78 + pdb.numRecords * 8 || end < start || end > file.size)
                throw new Error('Invalid Palm database record offsets');
            return [start, end];
        });
    }
    loadRecord(index) {
        const offsets = this.#offsets[index];
        if (!offsets || !this.#file)
            throw new RangeError('Record index out of bounds');
        return this.#file.slice(...offsets).arrayBuffer();
    }
    async loadMagic(index) {
        const offsets = this.#offsets[index];
        if (!offsets || !this.#file)
            throw new RangeError('Record index out of bounds');
        const [start, end] = offsets;
        if (end - start < 4)
            return '';
        return getString(await this.#file.slice(start, start + 4).arrayBuffer());
    }
}
export class MOBI extends PDB {
    unzlib;
    #headers;
    #start = 0;
    #resourceStart = 0;
    #decoder = new TextDecoder();
    #encoder = new TextEncoder();
    #decompress;
    #removeTrailingEntries;
    constructor({ unzlib }) {
        super();
        this.unzlib = unzlib;
    }
    get headers() {
        if (!this.#headers)
            throw new Error('MOBI is not open');
        return this.#headers;
    }
    get recordCount() { return this.pdb.numRecords - this.#start; }
    async open(file) {
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
                    if (!headers.kf8)
                        throw new Error('Combo MOBI has no KF8 header at its boundary');
                    this.#headers = headers;
                    this.#start = boundary;
                    isKF8 = true;
                }
                catch (e) {
                    console.warn(e);
                    console.warn('Failed to open KF8; falling back to MOBI');
                }
        }
        await this.#setup();
        return isKF8 ? new KF8(this).init() : new MOBI6(this).init();
    }
    #getHeaders(buf) {
        const palmdoc = getStruct(PALMDOC_HEADER, buf);
        if (palmdoc.encryption)
            throw new UnsupportedEncryptionError('MOBI');
        const base = getStruct(MOBI_HEADER, buf);
        const lang = MOBI_LANG[base.localeLanguage];
        const mobi = { ...base, title: buf.slice(base.titleOffset, base.titleOffset + base.titleLength),
            language: lang?.[base.localeRegion >> 2] ?? lang?.[0] ?? undefined };
        if (mobi.magic !== 'MOBI')
            throw new Error('Missing MOBI header');
        const exth = mobi.exthFlag & 0b100_0000
            ? getEXTH(buf.slice(mobi.length + 16), mobi.encoding) : null;
        const kf8 = mobi.version >= 8 ? getStruct(KF8_HEADER, buf) : null;
        return { palmdoc, mobi, exth, kf8 };
    }
    async #setup() {
        const { palmdoc, mobi } = this.headers;
        this.#decoder = getDecoder(mobi.encoding);
        // `TextEncoder` only supports UTF-8
        // we are only encoding ASCII anyway, so I think it's fine
        this.#encoder = new TextEncoder();
        // set up decompressor
        const { compression } = palmdoc;
        this.#decompress = compression === 1 ? bytes => bytes
            : compression === 2 ? decompressPalmDOC
                : compression === 17480 ? await huffcdic(mobi, this.loadRecord.bind(this))
                    : undefined;
        if (!this.#decompress)
            throw new Error('Unknown compression type');
        // set up function for removing trailing bytes
        const { trailingFlags } = mobi;
        const multibyte = trailingFlags & 1;
        const numTrailingEntries = countBitsSet(trailingFlags >>> 1);
        this.#removeTrailingEntries = array => {
            for (let i = 0; i < numTrailingEntries; i++) {
                const length = getVarLenFromEnd(array);
                if (!length || length > array.length)
                    throw new Error('Invalid MOBI trailing entry length');
                array = array.subarray(0, -length);
            }
            if (multibyte) {
                const length = (array[array.length - 1] & 0b11) + 1;
                array = array.subarray(0, -length);
            }
            return array;
        };
    }
    decode(...args) {
        return this.#decoder.decode(...args);
    }
    encode(...args) {
        return this.#encoder.encode(...args);
    }
    loadRecord(index) {
        return super.loadRecord(this.#start + index);
    }
    loadMagic(index) {
        return super.loadMagic(this.#start + index);
    }
    loadText(index) {
        if (!this.#removeTrailingEntries || !this.#decompress)
            throw new Error('MOBI decompressor is not ready');
        return this.loadRecord(index + 1)
            .then(buf => new Uint8Array(buf))
            .then(this.#removeTrailingEntries)
            .then(this.#decompress);
    }
    async loadResource(index) {
        const buf = await super.loadRecord(this.#resourceStart + index);
        const magic = getString(buf.slice(0, 4));
        if (magic === 'FONT')
            return getFont(buf, this.unzlib);
        if (magic === 'VIDE' || magic === 'AUDI')
            return buf.slice(12);
        return buf;
    }
    getNCX() {
        const index = this.headers.mobi.indx;
        if (index < 0xffffffff)
            return getNCX(index, this.loadRecord.bind(this));
    }
    getMetadata() {
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
        const offset = exth?.coverOffset != null && exth.coverOffset < 0xffffffff ? exth.coverOffset
            : exth?.thumbnailOffset != null && exth.thumbnailOffset < 0xffffffff ? exth.thumbnailOffset : null;
        if (offset != null) {
            const buf = await this.loadResource(offset);
            return new Blob([buf]);
        }
    }
}
