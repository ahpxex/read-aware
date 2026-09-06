import { expect, test } from "bun:test";
import { isMOBI, MOBI } from "../foliate-js/src/mobi.js";
import { MOBI6 } from "../foliate-js/src/mobi6.js";
import { KF8 } from "../foliate-js/src/kf8.js";
import { CDIC_HEADER, HUFF_HEADER, decompressPalmDOC, getVarLen, huffcdic } from "../foliate-js/src/mobi-binary.js";
import { unzlibSync } from "../public/foliate-js/vendor/fflate.js";
import { makeKF8Fixture, makeMOBI6Fixture, joinBytes, writeStruct } from "./fixtures/foliate-mobi.js";
import { withDom } from "./helpers/foliate-dom.js";

test.each([1, 2] as const)("MOBI6 compression %i preserves byte-offset TOC anchors and images", compression => withDom(async () => {
  const { file, chapter } = makeMOBI6Fixture({ compression });
  expect(await isMOBI(file)).toBe(true);
  const book = await new MOBI({ unzlib: unzlibSync }).open(file);
  try {
    expect(book).toBeInstanceOf(MOBI6);
    expect(book.metadata.title).toBe("MOBI & KF8 Fixture");
    expect(book.metadata.author).toEqual(["Ada Writer"]);
    expect(book.sections).toHaveLength(3);
    expect(book.toc?.[0].label).toBe("Second Chapter");
    const target = await book.resolveHref(`filepos:${String(chapter).padStart(10, "0")}`);
    expect(target?.index).toBe(2);
    const doc = await book.sections[2].createDocument!();
    expect(doc.querySelector("h1")?.textContent).toBe("Hello MOBI");
    expect(target?.anchor(doc)?.id).toBe(`filepos${String(chapter).padStart(10, "0")}`);
    const [a, b] = await Promise.all([book.sections[2].load(), book.sections[2].load()]);
    expect(a).toBe(b);
    if (typeof a !== "string") throw new Error("Expected document URL");
    const loaded = new DOMParser().parseFromString(await (await fetch(a)).text(), "text/html");
    const image = loaded.querySelector("img")!.src;
    expect((await fetch(image)).ok).toBe(true);
    book.destroy();
    await expect(fetch(image)).rejects.toThrow();
    await expect(fetch(a)).rejects.toThrow();
  } finally { book.destroy(); }
}));

test("KF8 builds skeletons and flows with typed indexes, padding and concurrent text reads", () => withDom(async () => {
  const { file, raw } = makeKF8Fixture();
  const book = await new MOBI({ unzlib: unzlibSync }).open(file);
  if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
  try {
    expect(book.sections).toHaveLength(1);
    const [head, tail] = await Promise.all([book.loadRaw(0, 20), book.loadRaw(20, raw.length)]);
    expect(joinBytes(head, tail)).toEqual(raw);
    const doc = await book.sections[0].createDocument!();
    expect(doc.querySelector("#chapter")?.textContent).toBe("Hello KF8 中文");
    const [a, b] = await Promise.all([book.sections[0].load(), book.sections[0].load()]);
    expect(a).toBe(b);
    if (typeof a !== "string") throw new Error("Expected document URL");
    const loaded = new DOMParser().parseFromString(await (await fetch(a)).text(), "application/xhtml+xml");
    const css = loaded.querySelector("link")!.getAttribute("href")!;
    expect(await (await fetch(css)).text()).toContain("rgb(23, 45, 67)");
    expect(book.getSectionHref(0)).toBe("kindle:pos:fid:0000:off:0000000000");
    book.destroy();
    await expect(fetch(a)).rejects.toThrow();
    await expect(fetch(css)).rejects.toThrow();
  } finally { book.destroy(); }
}));

test("MOBI rejects encryption with an actionable code and rejects malformed compression", () => withDom(async () => {
  const mobi = new MOBI({ unzlib: unzlibSync });
  await expect(mobi.open(makeMOBI6Fixture({ encrypted: true }).file)).rejects.toMatchObject({ code: "book/unsupported-encryption" });
  expect(decompressPalmDOC(Uint8Array.of(65, 66, 0xc3, 0))).toEqual(Uint8Array.of(65, 66, 32, 67, 0));
  expect(() => decompressPalmDOC(Uint8Array.of(8, 1))).toThrow("Truncated");
  expect(() => decompressPalmDOC(Uint8Array.of(0x80, 0))).toThrow("Invalid PalmDOC");
  expect(() => getVarLen(Uint8Array.of(1, 2))).toThrow("Truncated");
}));

test.each([true, false])("HUFF/CDIC decodes %s first-level lookup and catches recursive dictionary cycles", direct => {
  const huff = writeStruct(HUFF_HEADER, { magic: "HUFF", offset1: 24, offset2: 1048 }, 1304);
  const view = new DataView(huff.buffer);
  for (let index = 0; index < 256; index++) view.setUint32(24 + index * 4, direct ? 0x81 : 1);
  const makeDictionary = (compressed: boolean) => joinBytes(
    writeStruct(CDIC_HEADER, { magic: "CDIC", length: 16, numEntries: 1, codeLength: 1 }, 16),
    Uint8Array.of(0, 2, compressed ? 0 : 128, 1, compressed ? 0 : 65));
  return (async () => {
    const decode = await huffcdic({ huffcdic: 0, numHuffcdic: 2 }, async index => index ? makeDictionary(false).buffer : huff.buffer);
    expect(new TextDecoder().decode(decode(Uint8Array.of(0)))).toBe("AAAAAAAA");
    const cyclic = await huffcdic({ huffcdic: 0, numHuffcdic: 2 }, async index => index ? makeDictionary(true).buffer : huff.buffer);
    expect(() => cyclic(Uint8Array.of(0))).toThrow("recursive");
  })();
});
