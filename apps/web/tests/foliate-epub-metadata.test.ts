import { expect, test } from "bun:test";
import { getMetadata } from "../foliate-js/src/epub-metadata.js";
import { parseClock, resolveURL } from "../foliate-js/src/epub-dom.js";
import { parseNav, parseNCX } from "../foliate-js/src/epub-navigation.js";
import { withDom } from "./helpers/foliate-dom.js";

const packageDocument = (metadata: string) => new DOMParser().parseFromString(`
  <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:opf="http://www.idpf.org/2007/opf" xml:lang="en" unique-identifier="uid">
    <metadata>${metadata}</metadata>
  </package>`, "application/xml");

test("EPUB metadata preserves localized authors, refinement roles and hierarchical series", () => withDom(() => {
  const { metadata } = getMetadata(packageDocument(`
    <dc:identifier id="uid">book-id</dc:identifier>
    <dc:title id="title">Main Title</dc:title><dc:title id="sub">Subtitle</dc:title>
    <meta refines="#sub" property="title-type">subtitle</meta>
    <dc:creator id="author">Ada Writer</dc:creator>
    <meta refines="#author" property="alternate-script" xml:lang="zh">中文作者</meta>
    <dc:contributor id="translator">Translator</dc:contributor>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <meta property="belongs-to-collection" id="series">Modern Series</meta>
    <meta refines="#series" property="collection-type">series</meta>
    <meta refines="#series" property="group-position">2.2.1</meta>
    <meta name="calibre:series" content="Legacy Series"/>
    <meta name="calibre:series_index" content="7"/>
  `));
  expect(metadata.title).toBe("Main Title");
  expect(metadata.subtitle).toBe("Subtitle");
  expect(metadata.author).toEqual({ name: { en: "Ada Writer", zh: "中文作者" } });
  expect(metadata.translator).toEqual({ name: "Translator", role: "trl" });
  expect(metadata.belongsTo?.series).toEqual({ name: "Modern Series", position: "2.2.1" });
}));

test("EPUB identifiers honor ONIX refinements and EPUB 2 schemes", () => withDom(() => {
  const { metadata } = getMetadata(packageDocument(`
    <dc:identifier id="uid">book-id</dc:identifier>
    <dc:identifier id="isbn">9780000000000</dc:identifier>
    <meta refines="#isbn" property="identifier-type" scheme="onix:codelist5">15</meta>
    <dc:identifier opf:scheme="doi">10.1000/test</dc:identifier>
    <dc:identifier opf:scheme="local">custom-id</dc:identifier>
  `));
  expect(metadata.altIdentifier).toEqual(["book-id", "urn:isbn:9780000000000",
    "urn:doi:10.1000/test", { scheme: "local", value: "custom-id" }]);
}));

test("EPUB legacy metadata, missing optional DC fields and extension prefixes remain supported", () => withDom(() => {
  const doc = packageDocument(`<meta name="calibre:series" content="Legacy"/>
    <meta name="calibre:series_index" content="1.5"/>
    <meta property="layout:layout">pre-paginated</meta>
    <meta property="media:duration">01:02:03.5</meta>`);
  doc.documentElement.setAttribute("prefix", "layout: http://www.idpf.org/vocab/rendition/# other: https://example.org/");
  const result = getMetadata(doc);
  expect(result.metadata.title).toBeUndefined();
  expect(result.metadata.belongsTo?.series).toEqual({ name: "Legacy", position: 1.5 });
  expect(result.rendition.layout).toBe("pre-paginated");
  expect(result.media.duration).toBe(3723.5);
}));

test("EPUB nav grouping labels and nested landmark types are preserved", () => withDom(() => {
  const doc = new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
    <nav epub:type="toc"><ol><li><span>Part One</span><ol><li><a href="chapter.xhtml#start">Chapter</a></li></ol></li></ol></nav>
    <nav epub:type="landmarks"><ol><li><span>Content</span><ol><li><a epub:type="bodymatter" href="chapter.xhtml">Start</a></li></ol></li></ol></nav>
  </body></html>`, "application/xhtml+xml");
  const nav = parseNav(doc, href => resolveURL(href, "OPS/nav.xhtml"));
  expect(nav.toc?.[0].href).toBeNull();
  expect(nav.toc?.[0].subitems?.[0].href).toBe("OPS/chapter.xhtml#start");
  expect(nav.landmarks?.[0].subitems?.[0].type).toEqual(["bodymatter"]);
  const ncx = new DOMParser().parseFromString('<ncx><navMap><navPoint><navLabel><text>Group</text></navLabel><navPoint><navLabel><text>Child</text></navLabel><content src="chapter.xhtml"/></navPoint></navPoint></navMap></ncx>', "application/xml");
  expect(parseNCX(ncx).toc?.[0].subitems?.[0].href).toBe("chapter.xhtml");
}));

test("EPUB clocks and URLs have concrete, stable result types", () => {
  expect(["2h", "2min", "2ms", "2s", "02:03", "01:02:03"].map(parseClock)).toEqual([7200, 120, .002, 2, 123, 3723]);
  expect(parseClock("invalid")).toBeUndefined();
  expect(resolveURL("chapter.xhtml", "https://example.org/book/nav.xhtml")).toBe("https://example.org/book/chapter.xhtml");
  expect(resolveURL("../images/test%20image.svg", "OPS/text/chapter.xhtml")).toBe("OPS/images/test image.svg");
});
