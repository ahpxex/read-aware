import { expect, test } from "bun:test";
import { makeFB2 } from "../foliate-js/src/fb2.js";
import { fb2Fixture } from "./fixtures/foliate-books.js";
import { withDom } from "./helpers/foliate-dom.js";

test("FB2 metadata, inline styles, binary images, tables and poetry survive conversion", () => withDom(async () => {
  const book = await makeFB2(new Blob([fb2Fixture]));
  try {
    expect(book.metadata.title).toBe("Test Book");
    expect(book.metadata.author).toEqual([{ name: "Ada Writer", sortAs: "Writer, Ada" }]);
    expect(book.metadata.description).toContain("<em");
    expect(book.metadata.published).toBe("2024-01-02");
    expect(book.sections).toHaveLength(3);
    expect(book.sections[2].linear).toBe("no");
    const doc = book.sections[0].createDocument();
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("em")?.textContent).toBe("world");
    expect(doc.querySelector("img")?.getAttribute("alt")).toBe("Cover image");
    expect(doc.querySelector("img")?.getAttribute("title")).toBe("Image title");
    expect(doc.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(doc.querySelectorAll(".stanza br")).toHaveLength(2);
    expect(doc.querySelector("a")?.getAttributeNS("http://www.idpf.org/2007/ops", "type")).toBe("noteref");
    expect((await book.getCover())?.type).toBe("image/png");
  } finally { book.destroy(); }
}));

test("FB2 TOC, internal notes, source loading and URL cleanup stay coherent", () => withDom(async () => {
  const book = await makeFB2(new Blob([fb2Fixture]));
  const url = book.sections[0].load();
  try {
    expect(book.toc.map(item => item.label)).toEqual(["Chapter One", "Chapter Two", "Note One"]);
    const sub = book.toc[0].subitems?.[0];
    expect(sub?.label).toBe("Subchapter");
    expect(sub?.href).toBe("0#0");
    const [index, fragment] = book.splitTOCHref(sub!.href);
    expect(book.getTOCFragment(book.sections[index].createDocument(), fragment)?.textContent).toBe("Subchapter");
    const note = book.resolveHref("#note-one");
    expect(note?.index).toBe(2);
    expect(note?.anchor(book.sections[2].createDocument())?.textContent).toContain("Footnote text.");
    expect(book.resolveHref("#missing")).toBeUndefined();
    expect(book.resolveHref("99")).toBeUndefined();
    expect(await (await fetch(url)).text()).toContain("Chapter One");
  } finally { book.destroy(); }
  await expect(fetch(url)).rejects.toThrow();
}));

test("FB2 rejects malformed or bodyless files and handles legacy XML encoding", () => withDom(async () => {
  await expect(makeFB2(new Blob(["<broken>"]))).rejects.toThrow("Invalid FictionBook");
  await expect(makeFB2(new Blob(["<FictionBook/>"]))).rejects.toThrow("no body");
  const source = '<?xml version="1.0" encoding="windows-1252"?><FictionBook><description><title-info><book-title>Café</book-title></title-info></description><body><section><p>Café</p></section></body></FictionBook>';
  const book = await makeFB2(new Blob([Uint8Array.from(source, char => char.charCodeAt(0))]));
  try {
    expect(book.metadata.title).toBe("Café");
    expect(book.sections[0].createDocument().querySelector("p")?.textContent).toBe("Café");
  } finally { book.destroy(); }
}));
