import { expect, test } from "bun:test";
import { EPUB } from "../foliate-js/src/epub.js";
import { Encryption } from "../foliate-js/src/epub-resources.js";
import * as CFI from "../foliate-js/src/epubcfi.js";
import type { ResourceTransformDetail } from "../foliate-js/src/book.js";
import { parseSMIL } from "../foliate-js/src/media-overlay.js";
import { makeEPUBFixture } from "./fixtures/foliate-epub.js";
import { withDom } from "./helpers/foliate-dom.js";

test("EPUB package, compact reading order, TOC and original CFI spine paths agree", () => withDom(async () => {
  const book = await new EPUB(makeEPUBFixture(true).archive).init();
  try {
    expect(book.metadata.title).toBe("EPUB Engine Fixture");
    expect(book.metadata.author).toBe("Ada Writer");
    expect(book.sections).toHaveLength(2);
    expect(book.resolveHref("OPS/two.xhtml#note")?.index).toBe(1);
    expect(book.toc?.[0].subitems?.[0].href).toBe("OPS/one.xhtml#start");
    const section = book.sections[0];
    const doc = await section.createDocument!();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector("em")!);
    const cfi = CFI.joinIndir(section.cfi!, CFI.fromRange(range));
    for (const value of [cfi, cfi.replace("[ref-one]", "[one]")]) {
      const restored = book.resolveCFI(value);
      expect(restored.index).toBe(0);
      if (typeof restored.anchor !== "function") throw new Error("CFI has no document anchor");
      expect(restored.anchor(doc)?.toString()).toBe("EPUB");
    }
    expect(book.resolveHref("OPS/missing.xhtml")).toBeNull();
    expect((await book.getCover())?.type).toBe("image/svg+xml");
  } finally { book.destroy(); }
}));

test("EPUB resources preserve images, fragment identifiers and cyclic stylesheets without leaking concurrent URLs", () => withDom(async () => {
  const book = await new EPUB(makeEPUBFixture().archive).init();
  try {
    const section = book.sections[0];
    const [a, b] = await Promise.all([section.load(), section.load()]);
    expect(a).toBe(b);
    if (typeof a !== "string") throw new Error("Unexpected EPUB page source");
    const doc = new DOMParser().parseFromString(await (await fetch(a)).text(), "application/xhtml+xml");
    const image = doc.querySelector("img")!.getAttribute("src")!;
    expect(await (await fetch(image)).text()).toContain('fill="#cc3344"');
    const cssURL = doc.querySelector("link")!.getAttribute("href")!;
    const css = await (await fetch(cssURL)).text();
    expect(css).toContain("#icon");
    expect(css).not.toContain('url("image.svg');
    expect(doc.querySelector("a")!.getAttribute("href")).toBe("two.xhtml#note");
    section.unload!();
    expect((await fetch(a)).ok).toBe(true);
    section.unload!();
    await expect(fetch(a)).rejects.toThrow();
    await expect(fetch(cssURL)).rejects.toThrow();
    await expect(fetch(image)).rejects.toThrow();
  } finally { book.destroy(); }
}));

test("EPUB data transforms accept asynchronous replacements and close invalidates pending loads", () => withDom(async () => {
  const fixture = makeEPUBFixture();
  const book = await new EPUB(fixture.archive).init();
  let finish: () => void = () => {};
  const ready = new Promise<void>(resolve => { finish = resolve; });
  book.transformTarget!.addEventListener("data", event => {
    const detail = (event as CustomEvent<ResourceTransformDetail>).detail;
    if (detail.name !== "OPS/one.xhtml") return;
    detail.data = Promise.resolve(detail.data).then(async data => { await ready; return data; });
  });
  const pending = book.sections[0].load();
  book.destroy();
  finish();
  await expect(Promise.resolve(pending)).rejects.toThrow("closed");
}));

test("EPUB SVG processing instructions all resolve their stylesheet resources", () => withDom(async () => {
  const fixture = makeEPUBFixture();
  fixture.files.set("OPS/image.svg", '<?xml-stylesheet href="style.css"?><?xml-stylesheet href="other.css"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>');
  const book = await new EPUB(fixture.archive).init();
  try {
    const src = await book.sections[0].load();
    if (typeof src !== "string") throw new Error("Unexpected page source");
    const doc = new DOMParser().parseFromString(await (await fetch(src)).text(), "application/xhtml+xml");
    const svg = await (await fetch(doc.querySelector("img")!.getAttribute("src")!)).text();
    expect(svg).not.toContain('href="style.css"');
    expect(svg).not.toContain('href="other.css"');
    expect(svg.match(/xml-stylesheet/g)).toHaveLength(2);
  } finally { book.destroy(); }
}));

test("EPUB missing optional resources degrade, but missing chapter documents fail", () => withDom(async () => {
  const fixture = makeEPUBFixture();
  fixture.files.delete("OPS/image.svg");
  const book = await new EPUB(fixture.archive).init();
  try {
    const src = await book.sections[0].load();
    if (typeof src !== "string") throw new Error("Unexpected page source");
    expect(await (await fetch(src)).text()).toContain("Hello");
    fixture.files.delete("OPS/two.xhtml");
    await expect(Promise.resolve(book.sections[1].load())).rejects.toThrow("section was not loaded");
  } finally { book.destroy(); }
}));

test("EPUB font deobfuscation respects prefix lengths and rejects unsupported encryption", () => withDom(async () => {
  const fixture = makeEPUBFixture();
  const opf = new DOMParser().parseFromString(await fixture.archive.loadText("OPS/package.opf") ?? "", "application/xml");
  const descriptor = (algorithm: string) => new DOMParser().parseFromString(`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="OPS/font%20name.ttf"/></enc:CipherData></enc:EncryptedData></encryption>`, "application/xml");
  const encryption = new Encryption(async value => { expect(value).toBe("fixture-id"); return new Uint8Array([1, 2]); });
  await encryption.init(descriptor("http://www.idpf.org/2008/embedding"), opf);
  const bytes = new Uint8Array(1100).fill(16);
  const result = new Uint8Array(await (await encryption.decode("OPS/font name.ttf", new Blob([bytes]))).arrayBuffer());
  expect(Array.from(result.slice(0, 4))).toEqual([17, 18, 17, 18]);
  expect(result[1039]).toBe(18);
  expect(result[1040]).toBe(16);
  await expect(encryption.init(descriptor("urn:unsupported-drm"), opf)).rejects.toThrow("Unsupported EPUB encryption");
}));

test("EPUB SMIL preserves clip boundaries and audio grouping", () => withDom(() => {
  const doc = new DOMParser().parseFromString(`<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq>
    <par><text src="one.xhtml#a"/><audio src="voice.mp3" clipBegin="1s" clipEnd="2s"/></par>
    <par><text src="one.xhtml#b"/><audio src="voice.mp3" clipBegin="2s" clipEnd="3s"/></par>
    <par><text src="two.xhtml#a"/><audio src="other.mp3"/></par>
  </seq></body></smil>`, "application/xml");
  expect(parseSMIL(doc, "OPS/audio.smil")).toEqual([
    { src: "OPS/voice.mp3", items: [{ text: "OPS/one.xhtml#a", begin: 1, end: 2 }, { text: "OPS/one.xhtml#b", begin: 2, end: 3 }] },
    { src: "OPS/other.mp3", items: [{ text: "OPS/two.xhtml#a", begin: 0, end: undefined }] },
  ]);
}));
