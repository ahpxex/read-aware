import { expect, test } from "bun:test";
import { MOBI } from "../foliate-js/src/mobi.js";
import { MOBI6 } from "../foliate-js/src/mobi6.js";
import { KF8 } from "../foliate-js/src/kf8.js";
import { makeBook } from "../foliate-js/src/book-loader.js";
import { openPalmRecords } from "../src/platform/palm-records";
import { unzlibSync } from "./helpers/fflate";
import { makeKF8Fixture, makeMOBI6Fixture } from "./fixtures/foliate-mobi.js";
import { withDom } from "./helpers/foliate-dom.js";
import { palmShell } from "./helpers/palm-shell";

const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);

const legacyFixtures: Parameters<typeof makeMOBI6Fixture>[0][] = [
  { compression: 1 },
  { compression: 2 },
  { compression: 2, trailingEntry: [0x81] },
];

test.each(legacyFixtures)(
  "MOBI6 read from the shell is the same book as the file, in one text request: %o",
  (options) =>
    withDom(async () => {
      const { file, chapter } = makeMOBI6Fixture(options);
      const shell = await palmShell(file);
      const source = (await openPalmRecords("book-1", "fixture.mobi", file.type, shell.port))!;
      const book = await makeBook(source);
      const fromFile = await new MOBI({ unzlib: unzlibSync }).open(file);
      try {
        if (!(book instanceof MOBI6)) throw new Error("Expected MOBI6 parser");
        expect(book.metadata).toEqual(fromFile.metadata);
        expect(book.toc).toEqual(fromFile.toc);
        expect(book.sections).toHaveLength(fromFile.sections.length);
        for (const [index, section] of book.sections.entries())
          expect(serialize(await section.createDocument!())).toBe(
            serialize(await fromFile.sections[index].createDocument!()),
          );
        const target = await book.resolveHref(`filepos:${String(chapter).padStart(10, "0")}`);
        expect(target?.index).toBe(2);
        // The headers came with the opening; the whole text was one request.
        expect(shell.requests).toEqual(["text/1-1"]);

        const page = await book.sections[2].load();
        if (typeof page !== "string") throw new Error("Expected document URL");
        const loaded = new DOMParser().parseFromString(await (await fetch(page)).text(), "text/html");
        // The image is named where the shell serves it; nothing was copied for the page.
        expect(loaded.querySelector("img")!.getAttribute("src")).toBe("rablob://localhost/palm/book-1/rev/resource/2");
        expect(shell.requests).toEqual(["text/1-1"]);
        // The cover and the image tools read the bytes from the same place.
        expect((await book.getCover())?.size).toBe(shell.records[2].length);
        const image = await book.sections[2].loadImage!(loaded.querySelector("img")!);
        expect(image?.size).toBe(shell.records[2].length);
        expect(shell.requests).toEqual(["text/1-1", "resource/2", "resource/2"]);
      } finally {
        await book.destroy?.();
        fromFile.destroy();
      }
    }),
);

test("KF8 read from the shell fetches its indexes together, text by range, and names its image by URL", () =>
  withDom(async () => {
    const { file, raw } = makeKF8Fixture({ recordSize: 16 });
    const shell = await palmShell(file);
    const source = (await openPalmRecords("book-1", "fixture.azw3", file.type, shell.port))!;
    const book = await makeBook(source);
    const fromFile = await new MOBI({ unzlib: unzlibSync }).open(file);
    try {
      if (!(book instanceof KF8)) throw new Error("Expected KF8 parser");
      const textRecords = Math.ceil(raw.length / 16);
      const image = shell.records.length - 1;
      // Everything between the text and the resources — flow table, skeleton and fragment indexes — in one request.
      expect(shell.requests).toEqual([`records/${textRecords + 1}-${image - 1}`]);
      expect(book.metadata).toEqual(fromFile.metadata);
      expect(book.sections).toHaveLength(1);

      shell.requests.length = 0;
      expect(await book.loadRaw(50, 60)).toEqual(raw.slice(50, 60));
      // The last record proves the records are uniform; then only the record holding the range.
      expect(shell.requests).toEqual([`text/${textRecords}-${textRecords}`, "text/4-4"]);
      shell.requests.length = 0;
      expect(await book.loadRaw(0, raw.length)).toEqual(raw);
      // The runs on either side of what is already held: two requests, not one per record.
      expect(shell.requests).toEqual(["text/1-3", `text/5-${textRecords - 1}`]);

      expect(serialize(await book.sections[0].createDocument!())).toBe(
        serialize(await fromFile.sections[0].createDocument!()),
      );
      shell.requests.length = 0;
      const page = await book.sections[0].load();
      if (typeof page !== "string") throw new Error("Expected document URL");
      const loaded = new DOMParser().parseFromString(await (await fetch(page)).text(), "application/xhtml+xml");
      expect(loaded.querySelector("img")!.getAttribute("src")).toBe(
        `rablob://localhost/palm/book-1/rev/resource/${image}`,
      );
      // The stylesheet is a flow the engine rewrites: still a Blob, read from text already held.
      const css = loaded.querySelector("link")!.getAttribute("href")!;
      expect(css).toStartWith("blob:");
      expect(await (await fetch(css)).text()).toContain("rgb(23, 45, 67)");
      expect(shell.requests).toEqual([]);
      await book.destroy();
      await expect(fetch(page)).rejects.toThrow();
    } finally {
      await book.destroy?.();
      fromFile.destroy();
    }
  }));

test("KF8 with irregular text records still reads them in order from the shell", () =>
  withDom(async () => {
    const { file, raw } = makeKF8Fixture({ recordSize: 16, shortRecord: 3 });
    const shell = await palmShell(file);
    const book = await makeBook((await openPalmRecords("book-1", "fixture.azw3", file.type, shell.port))!);
    const fromFile = await new MOBI({ unzlib: unzlibSync }).open(file);
    try {
      if (!(book instanceof KF8) || !(fromFile instanceof KF8)) throw new Error("Expected KF8 parser");
      expect(await book.loadRaw(0, 40)).toEqual(await fromFile.loadRaw(0, 40));
      expect(raw.length).toBeGreaterThan(40);
    } finally {
      await book.destroy?.();
      fromFile.destroy();
    }
  }));

test("what the shell cannot read is a damaged book, and what it no longer has is unavailable content", () =>
  withDom(async () => {
    // 0x80: a trailing entry claiming zero bytes — the shell refuses the text as unreadable.
    const damaged = await palmShell(makeMOBI6Fixture({ compression: 2, trailingEntry: [0x80] }).file);
    await expect(makeBook((await openPalmRecords("book-1", "fixture.mobi", "", damaged.port))!)).rejects.toMatchObject({
      code: "book/parse-failed",
    });

    const shell = await palmShell(makeMOBI6Fixture().file);
    const source = (await openPalmRecords("book-1", "fixture.mobi", "", shell.port))!;
    expect(source.recordLengths).toHaveLength(3);
    expect(source.resourceURL(3)).toBeNull();
    expect(source.resourceURL(-1)).toBeNull();
    await expect(source.loadRecord(3)).rejects.toThrow("out of bounds");
    // A record is handed over once; asked for again, it is read again.
    expect(new Uint8Array(await source.loadRecord(0))).toEqual(shell.records[0]);
    expect(shell.requests).toEqual([]);
    expect(new Uint8Array(await source.loadRecord(0))).toEqual(shell.records[0]);
    expect(shell.requests).toEqual(["records/0-0"]);
    const gone = { ...shell.port, fetch: async () => new Response(null, { status: 404 }) };
    const stale = (await openPalmRecords("book-1", "fixture.mobi", "", gone))!;
    await expect(stale.loadResource(2)).rejects.toMatchObject({ code: "library/content-unavailable" });
    expect(await openPalmRecords("book-1", "fixture.mobi", "", { ...shell.port, open: async () => null })).toBeNull();
  }));
