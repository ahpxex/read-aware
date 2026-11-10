import { expect, test } from "bun:test";
import { EPUB } from "../foliate-js/src/epub.js";
import { makeBook } from "../foliate-js/src/book-loader.js";
import { Encryption } from "../foliate-js/src/epub-resources.js";
import * as CFI from "../foliate-js/src/epubcfi.js";
import type { ResourceTransformDetail } from "../foliate-js/src/book.js";
import { parseSMIL } from "../foliate-js/src/media-overlay.js";
import { makeEPUBFixture } from "./fixtures/foliate-epub.js";
import { withDom } from "./helpers/foliate-dom.js";

test("EPUB package, compact reading order, TOC and original CFI spine paths agree", () =>
  withDom(async () => {
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
        const anchor = restored.anchor(doc);
        if (!anchor || typeof anchor === "number" || !("cloneContents" in anchor))
          throw new Error("CFI did not restore a Range");
        expect(anchor.toString()).toBe("EPUB");
      }
      expect(book.resolveHref("OPS/missing.xhtml")).toBeNull();
      expect((await book.getCover())?.type).toBe("image/svg+xml");
    } finally {
      book.destroy();
    }
  }));

test("EPUB cover is an image: an id, a path in the EPUB 2 meta, or the image on the guide's cover page", () =>
  withDom(async () => {
    const packageWith = (declaration: { meta?: string; guide?: boolean }) => {
      const fixture = makeEPUBFixture();
      const opf = fixture.files.get("OPS/package.opf") as string;
      fixture.files.set(
        "OPS/package.opf",
        opf
          .replace(' properties="cover-image"', "")
          .replace(
            '<item id="one"',
            '<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="one"',
          )
          .replace(
            "<metadata>",
            `<metadata>${declaration.meta ? `<meta name="cover" content="${declaration.meta}"/>` : ""}`,
          )
          .replace(
            "</spine>",
            `</spine>${declaration.guide ? '<guide><reference type="cover" title="Cover" href="text/cover.xhtml"/></guide>' : ""}`,
          ),
      );
      fixture.files.set(
        "OPS/text/cover.xhtml",
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><div><img src="../image.svg"/></div></body></html>',
      );
      return fixture.archive;
    };
    for (const declaration of [
      { meta: "image" },
      { meta: "image.svg" },
      { guide: true },
      { meta: "image.svg", guide: true },
    ]) {
      const book = await new EPUB(packageWith(declaration)).init();
      try {
        const cover = await book.getCover();
        expect(cover?.type).toBe("image/svg+xml");
        expect(await cover?.text()).toContain('id="icon"');
      } finally {
        book.destroy();
      }
    }
    // A cover page that shows no image is no cover: the caller falls back to the book's images.
    const blank = packageWith({ guide: true });
    const book = await new EPUB({
      ...blank,
      loadText: async (path) =>
        path === "OPS/text/cover.xhtml"
          ? '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Cover</p></body></html>'
          : blank.loadText(path),
    }).init();
    try {
      expect(await book.getCover()).toBeNull();
    } finally {
      book.destroy();
    }
  }));

test("EPUB resources preserve images, fragment identifiers and cyclic stylesheets without leaking concurrent URLs", () =>
  withDom(async () => {
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
    } finally {
      book.destroy();
    }
  }));

test("EPUB resources an archive serves by URL are referred to there; what the engine rewrites or decodes stays a Blob", () =>
  withDom(async () => {
    const fixture = makeEPUBFixture();
    const opf = fixture.files.get("OPS/package.opf") as string;
    fixture.files.set(
      "OPS/package.opf",
      opf.replace(
        "</manifest>",
        `<item id="photo" href="img/photo 1.png" media-type="image/png"/>
        <item id="font" href="fonts/body.otf" media-type="font/otf"/>
        <item id="locked" href="fonts/locked.otf" media-type="font/otf"/>
        <item id="clip" href="clip.mp3" media-type="audio/mpeg"/></manifest>`,
      ),
    );
    fixture.files.set(
      "META-INF/encryption.xml",
      '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OPS/fonts/locked.otf"/></enc:CipherData></enc:EncryptedData></encryption>',
    );
    fixture.files.set(
      "OPS/one.xhtml",
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body><p>Hello</p><img id="photo" src="img/photo%201.png#frag"/><img id="vector" src="image.svg"/><audio src="clip.mp3"/></body></html>',
    );
    fixture.files.set(
      "OPS/style.css",
      '@font-face { font-family: Body; src: url("fonts/body.otf"); } @font-face { font-family: Locked; src: url(fonts/locked.otf); } p { width: 50vw; }',
    );
    for (const name of ["OPS/img/photo 1.png", "OPS/fonts/body.otf", "OPS/fonts/locked.otf", "OPS/clip.mp3"])
      fixture.files.set(name, new Blob([new Uint8Array(1100).fill(16)]));
    const blobs: string[] = [];
    const served = (href: string) => `rablob://localhost/book/id/rev/${encodeURIComponent(href)}`;
    const book = await new EPUB({
      ...fixture.archive,
      loadBlob: (href) => {
        blobs.push(href);
        return fixture.archive.loadBlob(href);
      },
      resourceURL: (href) => (fixture.files.has(href) ? served(href) : null),
      sha1: async () => new Uint8Array([1, 2]),
    }).init();
    // The paginator's stylesheet rewriting still sees every stylesheet.
    book.transformTarget!.addEventListener("data", (event) => {
      const detail = (event as CustomEvent<ResourceTransformDetail>).detail;
      if (detail.type !== "text/css") return;
      detail.data = Promise.resolve(detail.data).then((data) =>
        typeof data === "string" ? data.replace("50vw", "400px") : data,
      );
    });
    try {
      const section = book.sections[0];
      const src = await section.load();
      if (typeof src !== "string") throw new Error("Unexpected EPUB page source");
      const doc = new DOMParser().parseFromString(await (await fetch(src)).text(), "application/xhtml+xml");
      // An image is named where it is served, fragment kept; nothing was unpacked for it.
      expect(doc.querySelector("#photo")!.getAttribute("src")).toBe(`${served("OPS/img/photo 1.png")}#frag`);
      // An SVG is a document the engine rewrites, and audio keeps a seekable Blob.
      expect(doc.querySelector("#vector")!.getAttribute("src")).toStartWith("blob:");
      expect(doc.querySelector("audio")!.getAttribute("src")).toStartWith("blob:");
      const css = await (await fetch(doc.querySelector("link")!.getAttribute("href")!)).text();
      expect(css).toContain(`url("${served("OPS/fonts/body.otf")}")`);
      expect(css).toContain("400px");
      // An obfuscated font is decoded here, so the stylesheet names the decoded copy.
      const locked = css.match(/Locked; src: url\("([^"]+)"\)/)?.[1] ?? "";
      expect(locked).toStartWith("blob:");
      expect(new Uint8Array(await (await fetch(locked)).arrayBuffer())[0]).toBe(17);
      expect(blobs.sort()).toEqual(["OPS/clip.mp3", "OPS/fonts/locked.otf"]);
      // Unloading releases what was unpacked and leaves the served resources alone.
      section.unload!();
      await expect(fetch(src)).rejects.toThrow();
      await expect(fetch(locked)).rejects.toThrow();
      expect(await section.load()).not.toBe(src);
    } finally {
      book.destroy();
    }
  }));

test("an archive opened outside the engine is read as the container its name or type says", () =>
  withDom(async () => {
    const { archive } = makeEPUBFixture();
    const opened = {
      ...archive,
      entries: [{ filename: "page2.png" }, { filename: "page10.png" }],
      loadBlob: async (name: string) => (await archive.loadBlob(name)) ?? null,
      getSize: (name: string) => archive.getSize(name) ?? 0,
    };
    const epub = await makeBook({ ...opened, name: "book.epub", type: "application/epub+zip" });
    expect(epub.metadata?.title).toBe("EPUB Engine Fixture");
    await epub.destroy?.();
    for (const comic of [
      { name: "comic.cbz", type: "" },
      { name: "stored-name", type: "application/vnd.comicbook+zip" },
    ]) {
      const book = await makeBook({ ...opened, ...comic });
      expect(book.rendition?.layout).toBe("pre-paginated");
      expect(book.sections.map((section) => section.id)).toEqual(["page2.png", "page10.png"]);
      await book.destroy?.();
    }
  }));

test("EPUB data transforms accept asynchronous replacements and close invalidates pending loads", () =>
  withDom(async () => {
    const fixture = makeEPUBFixture();
    const book = await new EPUB(fixture.archive).init();
    let finish: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    book.transformTarget!.addEventListener("data", (event) => {
      const detail = (event as CustomEvent<ResourceTransformDetail>).detail;
      if (detail.name !== "OPS/one.xhtml") return;
      detail.data = Promise.resolve(detail.data).then(async (data) => {
        await ready;
        return data;
      });
    });
    const pending = book.sections[0].load();
    book.destroy();
    finish();
    await expect(Promise.resolve(pending)).rejects.toThrow("closed");
  }));

test("EPUB SVG processing instructions all resolve their stylesheet resources", () =>
  withDom(async () => {
    const fixture = makeEPUBFixture();
    fixture.files.set(
      "OPS/image.svg",
      '<?xml-stylesheet href="style.css"?><?xml-stylesheet href="other.css"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>',
    );
    const book = await new EPUB(fixture.archive).init();
    try {
      const src = await book.sections[0].load();
      if (typeof src !== "string") throw new Error("Unexpected page source");
      const doc = new DOMParser().parseFromString(await (await fetch(src)).text(), "application/xhtml+xml");
      const svg = await (await fetch(doc.querySelector("img")!.getAttribute("src")!)).text();
      expect(svg).not.toContain('href="style.css"');
      expect(svg).not.toContain('href="other.css"');
      expect(svg.match(/xml-stylesheet/g)).toHaveLength(2);
    } finally {
      book.destroy();
    }
  }));

test("EPUB missing optional resources degrade, but missing chapter documents fail", () =>
  withDom(async () => {
    const fixture = makeEPUBFixture();
    fixture.files.delete("OPS/image.svg");
    const book = await new EPUB(fixture.archive).init();
    try {
      const src = await book.sections[0].load();
      if (typeof src !== "string") throw new Error("Unexpected page source");
      expect(await (await fetch(src)).text()).toContain("Hello");
      fixture.files.delete("OPS/two.xhtml");
      await expect(Promise.resolve(book.sections[1].load())).rejects.toThrow("section was not loaded");
    } finally {
      book.destroy();
    }
  }));

test("EPUB font deobfuscation respects prefix lengths and rejects unsupported encryption", () =>
  withDom(async () => {
    const fixture = makeEPUBFixture();
    const opf = new DOMParser().parseFromString(
      (await fixture.archive.loadText("OPS/package.opf")) ?? "",
      "application/xml",
    );
    const descriptor = (algorithm: string) =>
      new DOMParser().parseFromString(
        `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="OPS/font%20name.ttf"/></enc:CipherData></enc:EncryptedData></encryption>`,
        "application/xml",
      );
    const encryption = new Encryption(async (value) => {
      expect(value).toBe("fixture-id");
      return new Uint8Array([1, 2]);
    });
    await encryption.init(descriptor("http://www.idpf.org/2008/embedding"), opf);
    const bytes = new Uint8Array(1100).fill(16);
    const result = new Uint8Array(
      await (await encryption.decode("OPS/font name.ttf", new Blob([bytes]))).arrayBuffer(),
    );
    expect(Array.from(result.slice(0, 4))).toEqual([17, 18, 17, 18]);
    expect(result[1039]).toBe(18);
    expect(result[1040]).toBe(16);
    await expect(encryption.init(descriptor("urn:unsupported-drm"), opf)).rejects.toThrow(
      "Unsupported EPUB encryption",
    );
  }));

test("EPUB SMIL preserves clip boundaries and audio grouping", () =>
  withDom(() => {
    const doc = new DOMParser().parseFromString(
      `<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq>
    <par><text src="one.xhtml#a"/><audio src="voice.mp3" clipBegin="1s" clipEnd="2s"/></par>
    <par><text src="one.xhtml#b"/><audio src="voice.mp3" clipBegin="2s" clipEnd="3s"/></par>
    <par><text src="two.xhtml#a"/><audio src="other.mp3"/></par>
  </seq></body></smil>`,
      "application/xml",
    );
    expect(parseSMIL(doc, "OPS/audio.smil")).toEqual([
      {
        src: "OPS/voice.mp3",
        items: [
          { text: "OPS/one.xhtml#a", begin: 1, end: 2 },
          { text: "OPS/one.xhtml#b", begin: 2, end: 3 },
        ],
      },
      { src: "OPS/other.mp3", items: [{ text: "OPS/two.xhtml#a", begin: 0, end: undefined }] },
    ]);
  }));
