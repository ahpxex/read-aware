/**
 * One entry point for turning a stored book file into a foliate book.
 *
 * Most formats are the vendored engine's job. Plain text and single-file HTML
 * are not: the engine has no loader for them, so the app assembles an
 * equivalent book object (see `text-book.ts`). Both the reader and the
 * background text extractor go through here so the two never disagree about
 * how a file is read.
 */
import type { FoliateBook } from "./foliate-engine";
import { makeFoliateBook } from "./foliate-engine";
import type { BookFileSource } from "./reader-types";
import { buildHtmlFoliateBook, buildPlainTextFoliateBook } from "./text-book";

const TEXT_EXTENSIONS = [".txt", ".text"];
const HTML_EXTENSIONS = [".html", ".htm", ".xhtml"];

export async function parseBookFile(file: BookFileSource): Promise<FoliateBook> {
  const name = (file.name ?? "").toLowerCase();
  const type = file.type;

  if (HTML_EXTENSIONS.some((ext) => name.endsWith(ext)) || type === "text/html") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return buildHtmlFoliateBook(bytes, file.name ?? "");
  }
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext)) || type === "text/plain") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return buildPlainTextFoliateBook(bytes, file.name ?? "");
  }
  if (name.endsWith(".cbr") || (await isRarArchive(file))) {
    // The RAR decoder is a ~1 MB WASM asset; load it only for a comic that
    // actually needs it.
    const { buildComicArchiveBook } = await import("./comic-archive");
    const source = file instanceof File ? file : new File([await file.arrayBuffer()], file.name ?? "comic.cbr", { type: file.type });
    return buildComicArchiveBook(source);
  }
  return makeFoliateBook(file);
}

/** `Rar!\x1a\x07` — RAR 4 and RAR 5 share the first six bytes. */
async function isRarArchive(file: BookFileSource): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  return (
    head.length === 6 &&
    head[0] === 0x52 &&
    head[1] === 0x61 &&
    head[2] === 0x72 &&
    head[3] === 0x21 &&
    head[4] === 0x1a &&
    head[5] === 0x07
  );
}
