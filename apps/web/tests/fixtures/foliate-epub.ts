import type { Archive } from "../../foliate-js/src/epub-resources.js";

export const makeEPUBFixture = (brokenSpine = false) => {
  const files = new Map<string, string | Blob>([
    ["META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OPS/package.opf", `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="uid" version="3.0">
      <metadata><dc:identifier id="uid">fixture-id</dc:identifier><dc:title>EPUB Engine Fixture</dc:title><dc:language>en</dc:language><dc:creator>Ada Writer</dc:creator></metadata>
      <manifest>
        <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
        <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="css" href="style.css" media-type="text/css"/>
        <item id="other-css" href="other.css" media-type="text/css"/>
        <item id="image" href="image.svg" media-type="image/svg+xml" properties="cover-image"/>
      </manifest><spine>${brokenSpine ? '<itemref idref="missing"/>' : ''}<itemref id="ref-one" idref="one"/><itemref idref="two"/></spine>
    </package>`],
    ["OPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><span>Part</span><ol><li><a href="one.xhtml#start">One</a></li><li><a href="two.xhtml#note">Two</a></li></ol></li></ol></nav></body></html>'],
    ["OPS/one.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>One</title><link rel="stylesheet" href="style.css"/></head><body><p id="start">Hello <em>EPUB</em> world.</p><img src="image.svg" alt="Fixture"/><a epub:type="noteref" href="two.xhtml#note">1</a></body></html>'],
    ["OPS/two.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Two</title><link rel="stylesheet" href="style.css"/></head><body><aside id="note" epub:type="footnote"><p>Footnote text.</p></aside></body></html>'],
    ["OPS/style.css", '@import "other.css"; body { color: rgb(12, 34, 56); } p { background-image: url("image.svg#icon"); }'],
    ["OPS/other.css", '@import "style.css"; em { font-style: italic; }'],
    ["OPS/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect id="icon" width="32" height="32" fill="#cc3344"/></svg>'],
  ]);
  const archive: Archive = {
    loadText: async path => {
      const value = files.get(path);
      return typeof value === "string" ? value : value?.text();
    },
    loadBlob: async path => {
      const value = files.get(path);
      return typeof value === "string" ? new Blob([value]) : value;
    },
    getSize: path => {
      const value = files.get(path);
      return typeof value === "string" ? new TextEncoder().encode(value).length : value?.size;
    },
  };
  return { files, archive };
};
