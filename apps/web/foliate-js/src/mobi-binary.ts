import type { MaybePromise } from './book.js'
export type StructDefinition = Readonly<Record<string, readonly [number, number, 'string' | 'uint']>>
export type Struct<T extends StructDefinition> = { -readonly [K in keyof T]: T[K][2] extends 'string' ? string : number }
export type LoadRecord = (index: number) => Promise<ArrayBuffer>
export type Unzlib = (data: Uint8Array) => MaybePromise<Uint8Array>

export const PDB_HEADER = {
    name: [0, 32, 'string'],
    type: [60, 4, 'string'],
    creator: [64, 4, 'string'],
    numRecords: [76, 2, 'uint'],
} as const satisfies StructDefinition

export const PALMDOC_HEADER = {
    compression: [0, 2, 'uint'],
    numTextRecords: [8, 2, 'uint'],
    recordSize: [10, 2, 'uint'],
    encryption: [12, 2, 'uint'],
} as const satisfies StructDefinition

export const MOBI_HEADER = {
    magic: [16, 4, 'string'],
    length: [20, 4, 'uint'],
    type: [24, 4, 'uint'],
    encoding: [28, 4, 'uint'],
    uid: [32, 4, 'uint'],
    version: [36, 4, 'uint'],
    titleOffset: [84, 4, 'uint'],
    titleLength: [88, 4, 'uint'],
    localeRegion: [94, 1, 'uint'],
    localeLanguage: [95, 1, 'uint'],
    resourceStart: [108, 4, 'uint'],
    huffcdic: [112, 4, 'uint'],
    numHuffcdic: [116, 4, 'uint'],
    exthFlag: [128, 4, 'uint'],
    trailingFlags: [240, 4, 'uint'],
    indx: [244, 4, 'uint'],
} as const satisfies StructDefinition

export const KF8_HEADER = {
    resourceStart: [108, 4, 'uint'],
    fdst: [192, 4, 'uint'],
    numFdst: [196, 4, 'uint'],
    frag: [248, 4, 'uint'],
    skel: [252, 4, 'uint'],
    guide: [260, 4, 'uint'],
} as const satisfies StructDefinition

export const EXTH_HEADER = {
    magic: [0, 4, 'string'],
    length: [4, 4, 'uint'],
    count: [8, 4, 'uint'],
} as const satisfies StructDefinition

export const INDX_HEADER = {
    magic: [0, 4, 'string'],
    length: [4, 4, 'uint'],
    type: [8, 4, 'uint'],
    idxt: [20, 4, 'uint'],
    numRecords: [24, 4, 'uint'],
    encoding: [28, 4, 'uint'],
    language: [32, 4, 'uint'],
    total: [36, 4, 'uint'],
    ordt: [40, 4, 'uint'],
    ligt: [44, 4, 'uint'],
    numLigt: [48, 4, 'uint'],
    numCncx: [52, 4, 'uint'],
} as const satisfies StructDefinition

export const TAGX_HEADER = {
    magic: [0, 4, 'string'],
    length: [4, 4, 'uint'],
    numControlBytes: [8, 4, 'uint'],
} as const satisfies StructDefinition

export const HUFF_HEADER = {
    magic: [0, 4, 'string'],
    offset1: [8, 4, 'uint'],
    offset2: [12, 4, 'uint'],
} as const satisfies StructDefinition

export const CDIC_HEADER = {
    magic: [0, 4, 'string'],
    length: [4, 4, 'uint'],
    numEntries: [8, 4, 'uint'],
    codeLength: [12, 4, 'uint'],
} as const satisfies StructDefinition

export const FDST_HEADER = {
    magic: [0, 4, 'string'],
    numEntries: [8, 4, 'uint'],
} as const satisfies StructDefinition

export const FONT_HEADER = {
    flags: [8, 4, 'uint'],
    dataStart: [12, 4, 'uint'],
    keyLength: [16, 4, 'uint'],
    keyStart: [20, 4, 'uint'],
} as const satisfies StructDefinition

export const MOBI_ENCODING: Readonly<Partial<Record<number, string>>> = {
    1252: 'windows-1252',
    65001: 'utf-8',
}

type EXTHStringField = 'publisher' | 'description' | 'isbn' | 'date' | 'rights' | 'asin'
    | 'fixedLayout' | 'originalResolution' | 'zeroGutter' | 'zeroMargin' | 'coverURI'
    | 'regionMagnification' | 'title' | 'pageProgressionDirection'
type EXTHNumberField = 'boundary' | 'numResources' | 'coverOffset' | 'thumbnailOffset'
type EXTHListField = 'creator' | 'subject' | 'contributor' | 'subjectCode' | 'source' | 'language'
export type EXTH = Partial<Record<EXTHStringField, string> & Record<EXTHNumberField, number>
    & Record<EXTHListField, string[]>>
type EXTHRecord = readonly [EXTHStringField] | readonly [EXTHNumberField, 'uint']
    | readonly [EXTHListField, 'string', true]
export const EXTH_RECORD_TYPE: Readonly<Partial<Record<number, EXTHRecord>>> = {
    100: ['creator', 'string', true],
    101: ['publisher'],
    103: ['description'],
    104: ['isbn'],
    105: ['subject', 'string', true],
    106: ['date'],
    108: ['contributor', 'string', true],
    109: ['rights'],
    110: ['subjectCode', 'string', true],
    112: ['source', 'string', true],
    113: ['asin'],
    121: ['boundary', 'uint'],
    122: ['fixedLayout'],
    125: ['numResources', 'uint'],
    126: ['originalResolution'],
    127: ['zeroGutter'],
    128: ['zeroMargin'],
    129: ['coverURI'],
    132: ['regionMagnification'],
    201: ['coverOffset', 'uint'],
    202: ['thumbnailOffset', 'uint'],
    503: ['title'],
    524: ['language', 'string', true],
    527: ['pageProgressionDirection'],
}

export const MOBI_LANG: Readonly<Partial<Record<number, (string | null)[]>>> = {
    1: ['ar', 'ar-SA', 'ar-IQ', 'ar-EG', 'ar-LY', 'ar-DZ', 'ar-MA', 'ar-TN', 'ar-OM',
        'ar-YE', 'ar-SY', 'ar-JO', 'ar-LB', 'ar-KW', 'ar-AE', 'ar-BH', 'ar-QA'],
    2: ['bg'], 3: ['ca'], 4: ['zh', 'zh-TW', 'zh-CN', 'zh-HK', 'zh-SG'], 5: ['cs'],
    6: ['da'], 7: ['de', 'de-DE', 'de-CH', 'de-AT', 'de-LU', 'de-LI'], 8: ['el'],
    9: ['en', 'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-IE', 'en-ZA',
        'en-JM', null, 'en-BZ', 'en-TT', 'en-ZW', 'en-PH'],
    10: ['es', 'es-ES', 'es-MX', null, 'es-GT', 'es-CR', 'es-PA', 'es-DO',
        'es-VE', 'es-CO', 'es-PE', 'es-AR', 'es-EC', 'es-CL', 'es-UY', 'es-PY',
        'es-BO', 'es-SV', 'es-HN', 'es-NI', 'es-PR'],
    11: ['fi'], 12: ['fr', 'fr-FR', 'fr-BE', 'fr-CA', 'fr-CH', 'fr-LU', 'fr-MC'],
    13: ['he'], 14: ['hu'], 15: ['is'], 16: ['it', 'it-IT', 'it-CH'],
    17: ['ja'], 18: ['ko'], 19: ['nl', 'nl-NL', 'nl-BE'], 20: ['no', 'nb', 'nn'],
    21: ['pl'], 22: ['pt', 'pt-BR', 'pt-PT'], 23: ['rm'], 24: ['ro'], 25: ['ru'],
    26: ['hr', null, 'sr'], 27: ['sk'], 28: ['sq'], 29: ['sv', 'sv-SE', 'sv-FI'],
    30: ['th'], 31: ['tr'], 32: ['ur'], 33: ['id'], 34: ['uk'], 35: ['be'],
    36: ['sl'], 37: ['et'], 38: ['lv'], 39: ['lt'], 41: ['fa'], 42: ['vi'],
    43: ['hy'], 44: ['az'], 45: ['eu'], 46: ['hsb'], 47: ['mk'], 48: ['st'],
    49: ['ts'], 50: ['tn'], 52: ['xh'], 53: ['zu'], 54: ['af'], 55: ['ka'],
    56: ['fo'], 57: ['hi'], 58: ['mt'], 59: ['se'], 62: ['ms'], 63: ['kk'],
    65: ['sw'], 67: ['uz', null, 'uz-UZ'], 68: ['tt'], 69: ['bn'], 70: ['pa'],
    71: ['gu'], 72: ['or'], 73: ['ta'], 74: ['te'], 75: ['kn'], 76: ['ml'],
    77: ['as'], 78: ['mr'], 79: ['sa'], 82: ['cy', 'cy-GB'], 83: ['gl', 'gl-ES'],
    87: ['kok'], 97: ['ne'], 98: ['fy'],
}

export const concatTypedArray = (a: Uint8Array, b: Uint8Array) => {
    const result = new Uint8Array(a.length + b.length)
    result.set(a)
    result.set(b, a.length)
    return result
}
export const concatTypedArray3 = (a: Uint8Array, b: Uint8Array, c: Uint8Array) => {
    const result = new Uint8Array(a.length + b.length + c.length)
    result.set(a)
    result.set(b, a.length)
    result.set(c, a.length + b.length)
    return result
}

export const decoder = new TextDecoder()
export const getString = (buffer: ArrayBuffer | ArrayBufferView) => decoder.decode(buffer)
export const getUint = (buffer: ArrayBuffer): number => {
    const l = buffer.byteLength
    if (l !== 1 && l !== 2 && l !== 4) throw new Error(`Invalid MOBI integer width: ${l}`)
    const func = l === 4 ? 'getUint32' : l === 2 ? 'getUint16' : 'getUint8'
    return new DataView(buffer)[func](0)
}
export const getStruct = <T extends StructDefinition>(def: T, buffer: ArrayBuffer): Struct<T> =>
    // Each field is decoded by its schema; the mapped type preserves that
    // per-key relationship across Object.fromEntries.
    Object.fromEntries(Object.entries(def)
    .map(([key, [start, len, type]]) => [key,
        (type === 'string' ? getString : getUint)(buffer.slice(start, start + len))])) as Struct<T>

export const getDecoder = (encoding: number) => new TextDecoder(MOBI_ENCODING[encoding])

export const getVarLen = (byteArray: Uint8Array, i = 0) => {
    let value = 0, length = 0
    for (const byte of byteArray.subarray(i, i + 4)) {
        value = (value << 7) | (byte & 0b111_1111) >>> 0
        length++
        if (byte & 0b1000_0000) return { value, length }
    }
    throw new Error('Truncated MOBI variable-length integer')
}

// variable-length quantity, but read from the end of data
export const getVarLenFromEnd = (byteArray: Uint8Array) => {
    let value = 0
    for (const byte of byteArray.subarray(-4)) {
        // `byte & 0b1000_0000` indicates the start of value
        if (byte & 0b1000_0000) value = 0
        value = (value << 7) | (byte & 0b111_1111)
    }
    return value
}

export const countBitsSet = (x: number) => {
    let count = 0
    for (; x > 0; x = x >> 1) if ((x & 1) === 1) count++
    return count
}

export const countUnsetEnd = (x: number) => {
    if (!x) return 0
    let count = 0
    while ((x & 1) === 0) x = x >> 1, count++
    return count
}

export const decompressPalmDOC = (array: Uint8Array) => {
    const output: number[] = []
    for (let i = 0; i < array.length; i++) {
        const byte = array[i]
        if (byte === 0) output.push(0) // uncompressed literal, just copy it
        else if (byte <= 8) { // copy next 1-8 bytes
            if (i + byte >= array.length) throw new Error('Truncated PalmDOC literal')
            for (const x of array.subarray(i + 1, (i += byte) + 1))
                output.push(x)
        }
        else if (byte <= 0b0111_1111) output.push(byte) // uncompressed literal
        else if (byte <= 0b1011_1111) {
            // 1st and 2nd bits are 10, meaning this is a length-distance pair
            // read next byte and combine it with current byte
            if (i + 1 >= array.length) throw new Error('Truncated PalmDOC back-reference')
            const bytes = (byte << 8) | array[i++ + 1]
            // the 3rd to 13th bits encode distance
            const distance = (bytes & 0b0011_1111_1111_1111) >>> 3
            if (!distance || distance > output.length) throw new Error('Invalid PalmDOC back-reference')
            // the last 3 bits, plus 3, is the length to copy
            const length = (bytes & 0b111) + 3
            for (let j = 0; j < length; j++)
                output.push(output[output.length - distance])
        }
        // compressed from space plus char
        else output.push(32, byte ^ 0b1000_0000)
    }
    return Uint8Array.from(output)
}

export const read32Bits = (byteArray: Uint8Array, from: number) => {
    const startByte = from >> 3
    const end = from + 32
    const endByte = end >> 3
    let bits = 0n
    for (let i = startByte; i <= endByte; i++)
        bits = bits << 8n | BigInt(byteArray[i] ?? 0)
    return (bits >> (8n - BigInt(end & 7))) & 0xffffffffn
}

export const huffcdic = async (mobi: Pick<Struct<typeof MOBI_HEADER>, 'huffcdic' | 'numHuffcdic'>, loadRecord: LoadRecord) => {
    const huffRecord = await loadRecord(mobi.huffcdic)
    const { magic, offset1, offset2 } = getStruct(HUFF_HEADER, huffRecord)
    if (magic !== 'HUFF') throw new Error('Invalid HUFF record')

    // table1 is indexed by byte value
    const table1 = Array.from({ length: 256 }, (_, i) => offset1 + i * 4)
        .map(offset => getUint(huffRecord.slice(offset, offset + 4)))
        .map((x): [number, number, number] => [x & 0b1000_0000, x & 0b1_1111, x >>> 8])

    // table2 is indexed by code length
    const table2 = Array.from({ length: 32 }, (_, i) => offset2 + i * 8)
        .map((offset): [number, number] => [
            getUint(huffRecord.slice(offset, offset + 4)),
            getUint(huffRecord.slice(offset + 4, offset + 8))])

    const dictionary: Array<{ value: Uint8Array; decompressed: boolean }> = []
    const active = new Set<number>()
    for (let i = 1; i < mobi.numHuffcdic; i++) {
        const record = await loadRecord(mobi.huffcdic + i)
        const cdic = getStruct(CDIC_HEADER, record)
        if (cdic.magic !== 'CDIC') throw new Error('Invalid CDIC record')
        // `numEntries` is the total number of dictionary data across CDIC records
        // so `n` here is the number of entries in *this* record
        const n = Math.min(1 << cdic.codeLength, cdic.numEntries - dictionary.length)
        const buffer = record.slice(cdic.length)
        for (let i = 0; i < n; i++) {
            const offset = getUint(buffer.slice(i * 2, i * 2 + 2))
            const x = getUint(buffer.slice(offset, offset + 2))
            const length = x & 0x7fff
            const decompressed = !!(x & 0x8000)
            const value = new Uint8Array(
                buffer.slice(offset + 2, offset + 2 + length))
            dictionary.push({ value, decompressed })
        }
    }

    const decompress = (byteArray: Uint8Array): Uint8Array<ArrayBuffer> => {
        let output = new Uint8Array()
        const bitLength = byteArray.byteLength * 8
        for (let i = 0; i < bitLength;) {
            const bits = Number(read32Bits(byteArray, i))
            let [found, codeLength, value] = table1[bits >>> 24]
            if (!codeLength) throw new Error('Invalid HUFF code length')
            if (!found) {
                while (codeLength <= 32 && bits >>> (32 - codeLength) < table2[codeLength - 1][0])
                    codeLength += 1
                if (codeLength > 32) throw new Error('HUFF code exceeds 32 bits')
                value = table2[codeLength - 1][1]
            }
            if ((i += codeLength) > bitLength) break

            const code = value - (bits >>> (32 - codeLength))
            const entry = dictionary[code]
            if (!entry || active.has(code)) throw new Error('Invalid recursive CDIC reference')
            let result = entry.value
            if (!entry.decompressed) {
                // the result is itself compressed
                active.add(code)
                try { result = decompress(result) }
                finally { active.delete(code) }
                // cache the result for next time
                dictionary[code] = { value: result, decompressed: true }
            }
            output = concatTypedArray(output, result)
        }
        return output
    }
    return decompress
}

export type IndexEntry = { name: string; tagMap: Partial<Record<number, number[]>> }
export const getIndexData = async (indxIndex: number, loadRecord: LoadRecord) => {
    const indxRecord = await loadRecord(indxIndex)
    const indx = getStruct(INDX_HEADER, indxRecord)
    if (indx.magic !== 'INDX') throw new Error('Invalid INDX record')
    const decoder = getDecoder(indx.encoding)

    const tagxBuffer = indxRecord.slice(indx.length)
    const tagx = getStruct(TAGX_HEADER, tagxBuffer)
    if (tagx.magic !== 'TAGX') throw new Error('Invalid TAGX section')
    const numTags = (tagx.length - 12) / 4
    const tagTable = Array.from({ length: numTags }, (_, i) =>
        new Uint8Array(tagxBuffer.slice(12 + i * 4, 12 + i * 4 + 4)))

    const cncx: Partial<Record<number, string>> = {}
    let cncxRecordOffset = 0
    for (let i = 0; i < indx.numCncx; i++) {
        const record = await loadRecord(indxIndex + indx.numRecords + i + 1)
        const array = new Uint8Array(record)
        for (let pos = 0; pos < array.byteLength;) {
            // CNCX records may end in zero alignment padding, not a string.
            if (array[pos] === 0 && array.subarray(pos).every(byte => byte === 0)) break
            const index = pos
            const { value, length } = getVarLen(array, pos)
            pos += length
            const result = record.slice(pos, pos + value)
            pos += value
            cncx[cncxRecordOffset + index] = decoder.decode(result)
        }
        cncxRecordOffset += 0x10000
    }

    const table: IndexEntry[] = []
    for (let i = 0; i < indx.numRecords; i++) {
        const record = await loadRecord(indxIndex + 1 + i)
        const array = new Uint8Array(record)
        const indx = getStruct(INDX_HEADER, record)
        if (indx.magic !== 'INDX') throw new Error('Invalid INDX record')
        for (let j = 0; j < indx.numRecords; j++) {
            const offsetOffset = indx.idxt + 4 + 2 * j
            const offset = getUint(record.slice(offsetOffset, offsetOffset + 2))

            const length = getUint(record.slice(offset, offset + 1))
            const name = getString(record.slice(offset + 1, offset + 1 + length))

            const tags: Array<[number, number, null, number] | [number, null, number, number]> = []
            const startPos = offset + 1 + length
            let controlByteIndex = 0
            let pos = startPos + tagx.numControlBytes
            for (const [tag, numValues, mask, end] of tagTable) {
                if (end & 1) {
                    controlByteIndex++
                    continue
                }
                const offset = startPos + controlByteIndex
                const value = getUint(record.slice(offset, offset + 1)) & mask
                if (value === mask) {
                    if (countBitsSet(mask) > 1) {
                        const { value, length } = getVarLen(array, pos)
                        tags.push([tag, null, value, numValues])
                        pos += length
                    } else tags.push([tag, 1, null, numValues])
                } else tags.push([tag, value >> countUnsetEnd(mask), null, numValues])
            }

            const tagMap: IndexEntry['tagMap'] = {}
            for (const [tag, valueCount, valueBytes, numValues] of tags) {
                const values = []
                if (valueCount != null) {
                    for (let i = 0; i < valueCount * numValues; i++) {
                        const { value, length } = getVarLen(array, pos)
                        values.push(value)
                        pos += length
                    }
                } else {
                    let count = 0
                    while (count < valueBytes) {
                        const { value, length } = getVarLen(array, pos)
                        values.push(value)
                        pos += length
                        count += length
                    }
                }
                tagMap[tag] = values
            }
            table.push({ name, tagMap })
        }
    }
    return { table, cncx }
}

export type NCXItem = {
    index: number; offset?: number; size?: number; label: string; headingLevel?: number
    pos?: number[]; parent?: number; firstChild?: number; lastChild?: number; children?: NCXItem[]
}
export const getNCX = async (indxIndex: number, loadRecord: LoadRecord): Promise<NCXItem[]> => {
    const { table, cncx } = await getIndexData(indxIndex, loadRecord)
    const items: NCXItem[] = table.map(({ tagMap }, index) => ({
        index,
        offset: tagMap[1]?.[0],
        size: tagMap[2]?.[0],
        label: cncx[tagMap[3]?.[0] ?? -1] ?? '',
        headingLevel: tagMap[4]?.[0],
        pos: tagMap[6],
        parent: tagMap[21]?.[0],
        firstChild: tagMap[22]?.[0],
        lastChild: tagMap[23]?.[0],
    }))
    const getChildren = (item: NCXItem, parents: number[] = []): NCXItem => {
        if (parents.includes(item.index)) throw new Error('Cyclic MOBI navigation index')
        if (item.firstChild == null) return item
        item.children = items.filter(x => x.parent === item.index).map(child => getChildren(child, [...parents, item.index]))
        return item
    }
    return items.filter(item => item.headingLevel === 0).map(item => getChildren(item))
}

export const getEXTH = (buf: ArrayBuffer, encoding: number): EXTH => {
    const { magic, count } = getStruct(EXTH_HEADER, buf)
    if (magic !== 'EXTH') throw new Error('Invalid EXTH header')
    const decoder = getDecoder(encoding)
    const results: EXTH = {}
    let offset = 12
    for (let i = 0; i < count; i++) {
        const type = getUint(buf.slice(offset, offset + 4))
        const length = getUint(buf.slice(offset + 4, offset + 8))
        if (length < 8 || offset + length > buf.byteLength) throw new Error('Truncated EXTH record')
        const spec = EXTH_RECORD_TYPE[type]
        if (spec) {
            const data = buf.slice(offset + 8, offset + length)
            if (spec.length === 3) (results[spec[0]] ??= []).push(decoder.decode(data))
            else if (spec.length === 2) results[spec[0]] = getUint(data)
            else results[spec[0]] = decoder.decode(data)
        }
        offset += length
    }
    return results
}

export const getFont = async (buf: ArrayBuffer, unzlib: Unzlib): Promise<Uint8Array<ArrayBuffer>> => {
    const { flags, dataStart, keyLength, keyStart } = getStruct(FONT_HEADER, buf)
    const array = new Uint8Array(buf.slice(dataStart))
    // deobfuscate font
    if (flags & 0b10) {
        const bytes = keyLength === 16 ? 1024 : 1040
        const key = new Uint8Array(buf.slice(keyStart, keyStart + keyLength))
        if (!key.length) throw new Error('MOBI font obfuscation key is empty')
        const length = Math.min(bytes, array.length)
        for (let i = 0; i < length; i++) array[i] = array[i] ^ key[i % key.length]
    }
    // decompress font
    if (flags & 1) try {
        return new Uint8Array(await unzlib(array))
    } catch (e) {
        console.warn(e)
        console.warn('Failed to decompress font')
    }
    return array
}
