import { expect, test } from "bun:test";
import { EPUB } from "../foliate-js/src/epub.js";
import { getMetadata } from "../foliate-js/src/epub-metadata.js";
import { makeEPUBFixture } from "./fixtures/foliate-epub.js";
import { withDom } from "./helpers/foliate-dom.js";

const packageDocument = (metadata: string) => new DOMParser().parseFromString(`
  <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"
    xml:lang="en" unique-identifier="uid"><metadata>${metadata}</metadata></package>
`, "application/xml");

test.each(["Object.groupBy", "Map.groupBy", "both"] as const)(
  "EPUB metadata and chapters load without %s",
  missing => withDom(async () => {
    const targets = missing === "both" ? [Object, Map]
      : missing === "Object.groupBy" ? [Object] : [Map];
    const descriptors = targets.map(target => [target, Object.getOwnPropertyDescriptor(target, "groupBy")] as const);
    try {
      for (const target of targets) Object.defineProperty(target, "groupBy", { value: undefined, configurable: true });

      const { metadata, rendition } = getMetadata(packageDocument(`
        <dc:identifier id="uid">compatibility-id</dc:identifier>
        <dc:title id="subtitle">Subtitle</dc:title>
        <dc:title id="title">Main Title</dc:title>
        <meta refines="#title" property="title-type">main</meta>
        <meta refines="#subtitle" property="title-type">subtitle</meta>
        <dc:creator>Ada Writer</dc:creator><dc:creator>Second Writer</dc:creator>
        <dc:contributor id="translator">Translator</dc:contributor>
        <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
        <meta property="belongs-to-collection" id="series">First Series</meta>
        <meta property="belongs-to-collection" id="collection">Collection</meta>
        <meta property="belongs-to-collection" id="second-series">Second Series</meta>
        <meta refines="#series" property="collection-type">series</meta>
        <meta refines="#series" property="group-position">2.2.1</meta>
        <meta refines="#second-series" property="collection-type">series</meta>
        <meta refines="#collection" property="group-position">4</meta>
        <meta property="dcterms:modified">2026-09-07T00:00:00Z</meta>
        <meta property="rendition:layout">reflowable</meta>
        <meta name="calibre:series" content="Legacy Series"/>
      `));
      expect(metadata.identifier).toBe("compatibility-id");
      expect(metadata.title).toBe("Main Title");
      expect(metadata.subtitle).toBe("Subtitle");
      expect(metadata.author).toEqual(["Ada Writer", "Second Writer"]);
      expect(metadata.translator).toEqual({ name: "Translator", role: "trl" });
      expect(metadata.belongsTo).toEqual({
        series: [{ name: "First Series", position: "2.2.1" }, { name: "Second Series", position: undefined }],
        collection: { name: "Collection", position: "4" },
      });
      expect(metadata.modified).toBe("2026-09-07T00:00:00Z");
      expect(rendition.layout).toBe("reflowable");

      const legacy = getMetadata(packageDocument(`
        <meta name="calibre:series" content="Legacy Series"/>
        <meta name="calibre:series_index" content="1.5"/>
      `));
      expect(legacy.metadata.belongsTo?.series).toEqual({ name: "Legacy Series", position: 1.5 });
      const empty = getMetadata(packageDocument(""));
      expect(empty.metadata.title).toBeUndefined();
      expect(empty.metadata.belongsTo).toBeUndefined();

      const book = new EPUB(makeEPUBFixture().archive);
      try {
        await book.init();
        expect(book.metadata.title).toBe("EPUB Engine Fixture");
        expect(book.metadata.author).toBe("Ada Writer");
        expect(book.sections).toHaveLength(2);
        expect(book.toc?.[0].subitems?.[0].href).toBe("OPS/one.xhtml#start");
        const chapter = await book.sections[0].createDocument!();
        expect(chapter.body.textContent).toContain("Hello EPUB world.");
        expect((await book.getCover())?.type).toBe("image/svg+xml");
      } finally {
        book.destroy();
      }
    } finally {
      for (const [target, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(target, "groupBy", descriptor);
        else Reflect.deleteProperty(target, "groupBy");
      }
    }
  }),
);
