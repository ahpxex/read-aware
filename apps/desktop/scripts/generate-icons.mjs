// Generates placeholder ReadAware app icons (solid stone-950 squares) so the
// Tauri shell builds out of the box. Replace these by running:
//   bun run --filter @read-aware/desktop tauri icon path/to/logo.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, "../src-tauri/icons");

// Brand color: stone-950 (#1c1917)
const COLOR = [28, 25, 23, 255];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, [r, g, b, a] = COLOR) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const base = y * stride; // filter byte 0 already zeroed
    for (let x = 0; x < size; x++) {
      const o = base + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const dir = [];
  const blobs = [];
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

function makeIcns(entries) {
  const parts = [];
  for (const { type, data } of entries) {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    parts.push(head, data);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

mkdirSync(iconsDir, { recursive: true });

const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);
const png512 = makePng(512);

writeFileSync(resolve(iconsDir, "32x32.png"), png32);
writeFileSync(resolve(iconsDir, "128x128.png"), png128);
writeFileSync(resolve(iconsDir, "128x128@2x.png"), png256);
writeFileSync(resolve(iconsDir, "icon.png"), png512);
writeFileSync(
  resolve(iconsDir, "icon.ico"),
  makeIco([
    { size: 32, data: png32 },
    { size: 128, data: png128 },
    { size: 256, data: png256 },
  ]),
);
writeFileSync(
  resolve(iconsDir, "icon.icns"),
  makeIcns([
    { type: "ic11", data: png32 },
    { type: "ic07", data: png128 },
    { type: "ic08", data: png256 },
    { type: "ic09", data: png512 },
  ]),
);

console.log(`Wrote placeholder icons to ${iconsDir}`);
