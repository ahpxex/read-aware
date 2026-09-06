import { EXTH_HEADER, FDST_HEADER, INDX_HEADER, KF8_HEADER, MOBI_HEADER,
  PALMDOC_HEADER, PDB_HEADER, TAGX_HEADER, type StructDefinition } from "../../foliate-js/src/mobi-binary.js";

const encoder = new TextEncoder();
export const joinBytes = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};
export const writeStruct = (schema: StructDefinition, values: Record<string, number | string>, length: number) => {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  for (const [name, [offset, size, type]] of Object.entries(schema)) {
    const value = values[name] ?? (type === "string" ? "" : 0);
    if (type === "string") {
      if (typeof value !== "string") throw new Error(`Expected string: ${name}`);
      bytes.set(encoder.encode(value).slice(0, size), offset);
    } else {
      if (typeof value !== "number") throw new Error(`Expected number: ${name}`);
      if (size === 1) view.setUint8(offset, value);
      else if (size === 2) view.setUint16(offset, value);
      else if (size === 4) view.setUint32(offset, value);
      else throw new Error("Unsupported fixture integer width");
    }
  }
  return bytes;
};
export const variableInteger = (value: number): Uint8Array<ArrayBuffer> => {
  const bytes = [value & 127 | 128];
  while ((value >>>= 7) > 0) bytes.unshift(value & 127);
  return Uint8Array.from(bytes);
};
const uint32 = (value: number) => {
  const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes;
};
const image = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=="), char => char.charCodeAt(0));
const exth = () => {
  const records: Array<[number, Uint8Array]> = [[100, encoder.encode("Ada Writer")],
    [503, encoder.encode("MOBI &amp; KF8 Fixture")], [201, uint32(0)], [524, encoder.encode("en")]];
  const data = records.map(([type, value]) => joinBytes(uint32(type), uint32(value.length + 8), value));
  return joinBytes(writeStruct(EXTH_HEADER, { magic: "EXTH", length: 12 + data.reduce((sum, item) => sum + item.length, 0), count: data.length }, 12), ...data);
};
const header = (version: 6 | 8, resourceStart: number, compression: 1 | 2, encrypted: boolean, rawLength: number) => {
  const size = version === 8 ? 264 : 248, metadata = exth(), title = encoder.encode("Fallback title");
  const bytes = writeStruct(MOBI_HEADER, { magic: "MOBI", length: size - 16, type: 2,
    encoding: 65001, uid: 42, version, resourceStart, indx: 0xffffffff, exthFlag: 64,
    titleOffset: size + metadata.length, titleLength: title.length, localeLanguage: 9 }, size);
  bytes.set(writeStruct(PALMDOC_HEADER, { compression, numTextRecords: 1, recordSize: 4096, encryption: encrypted ? 2 : 0 }, 16));
  new DataView(bytes.buffer).setUint32(4, rawLength);
  if (version === 8) {
    const fields = writeStruct(KF8_HEADER, { resourceStart, fdst: 2, numFdst: 2, skel: 3, frag: 5, guide: 0xffffffff }, 264);
    for (const [offset, length] of Object.values(KF8_HEADER)) bytes.set(fields.slice(offset, offset + length), offset);
  }
  return joinBytes(bytes, metadata, title);
};
const pack = (records: Uint8Array[], name: string) => {
  const pdb = writeStruct(PDB_HEADER, { name, type: "BOOK", creator: "MOBI", numRecords: records.length }, 78 + 8 * records.length + 2);
  const view = new DataView(pdb.buffer);
  let offset = pdb.length;
  for (const [index, record] of records.entries()) { view.setUint32(78 + index * 8, offset); offset += record.length; }
  return new File([joinBytes(pdb, ...records)], name, { type: "application/x-mobipocket-ebook" });
};

export const makeMOBI6Fixture = ({ compression = 1, encrypted = false }: { compression?: 1 | 2; encrypted?: boolean } = {}) => {
  let html = '<html><head><guide><reference type="toc" title="Contents" filepos="1111111111"/></guide></head><body><p>中文 opening.</p><mbp:pagebreak/><h1>Contents</h1><p><a filepos="2222222222">Second Chapter</a></p><mbp:pagebreak/><h1>Hello MOBI</h1><p id="text">A real chapter.</p><img recindex="1"/></body></html>';
  const toc = encoder.encode(html.slice(0, html.indexOf("<h1>Contents"))).length;
  const chapter = encoder.encode(html.slice(0, html.indexOf("<h1>Hello MOBI"))).length;
  html = html.replaceAll("1111111111", String(toc).padStart(10, "0")).replaceAll("2222222222", String(chapter).padStart(10, "0"));
  const raw = encoder.encode(html);
  const compressed: Uint8Array[] = [];
  for (let index = 0; index < raw.length; index += 8) {
    const part = raw.slice(index, index + 8);
    compressed.push(Uint8Array.of(part.length), part);
  }
  return { file: pack([header(6, 2, compression, encrypted, raw.length), compression === 2 ? joinBytes(...compressed) : raw, image], "fixture.mobi"), raw, chapter };
};

const indexRecords = (name: string, tags: Array<[number, number[]]>, cncx?: string): Uint8Array[] => {
  const specs = tags.map(([tag, values], index) => Uint8Array.of(tag, values.length, 1 << index, 0));
  const tagx = joinBytes(writeStruct(TAGX_HEADER, { magic: "TAGX", length: 12 + specs.length * 4, numControlBytes: 1 }, 12), ...specs);
  const main = joinBytes(writeStruct(INDX_HEADER, { magic: "INDX", length: 56, numRecords: 1, numCncx: cncx == null ? 0 : 1, encoding: 65001 }, 56), tagx);
  const label = encoder.encode(name);
  const entry = joinBytes(Uint8Array.of(label.length), label, Uint8Array.of((1 << specs.length) - 1),
    ...tags.flatMap(([, values]) => values.map(variableInteger)));
  const idxt = joinBytes(encoder.encode("IDXT"), Uint8Array.of(0, 56));
  const data = joinBytes(writeStruct(INDX_HEADER, { magic: "INDX", length: 56, numRecords: 1, idxt: 56 + entry.length, encoding: 65001 }, 56), entry, idxt);
  if (cncx == null) return [main, data];
  const text = encoder.encode(cncx), strings = joinBytes(variableInteger(text.length), text);
  return [main, data, joinBytes(strings, new Uint8Array(4 - strings.length % 4))];
};

export const makeKF8Fixture = () => {
  const skeleton = encoder.encode('<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="kindle:flow:0001?mime=text/css"/></head><body></body></html>');
  const fragment = encoder.encode('<p id="chapter">Hello KF8 中文</p><img src="kindle:embed:0001?mime=image/png"/>');
  const css = encoder.encode('p { color: rgb(23, 45, 67); }');
  const raw = joinBytes(skeleton, fragment, css);
  const htmlEnd = skeleton.length + fragment.length;
  const insert = new TextDecoder().decode(skeleton).indexOf("</body>");
  const fdst = joinBytes(writeStruct(FDST_HEADER, { magic: "FDST", numEntries: 2 }, 12), uint32(0), uint32(htmlEnd), uint32(htmlEnd), uint32(raw.length));
  return { file: pack([header(8, 8, 1, false, raw.length), raw, fdst,
    ...indexRecords("skeleton", [[1, [1]], [6, [0, skeleton.length]]]),
    ...indexRecords(String(insert), [[2, [0]], [4, [0]], [6, [0, fragment.length]]], "chapter"), image], "fixture.azw3"), raw };
};
