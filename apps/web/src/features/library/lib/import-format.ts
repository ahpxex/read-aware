import type { TFunction } from "i18next";
import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { sniffBookFormat } from "./book-format-sniff";
import type { BookFormat, BookImportSource } from "./library-types";

const log = createLogger("library");

/** Name / size / MIME of a source without touching its bytes. */
export function sourceFileInfo(source: BookImportSource): {
  name: string;
  size: number;
  type: string;
} {
  return source.kind === "native-path"
    ? { name: source.name, size: source.size, type: "" }
    : { name: source.file.name, size: source.file.size, type: source.file.type };
}

/** Format from the file name / MIME type alone; null when neither says. */
export function formatFromName(name: string, type = ""): BookFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".epub") || type === "application/epub+zip") return "epub";
  if (lower.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (lower.endsWith(".mobi") || lower.endsWith(".prc")) return "mobi";
  if (lower.endsWith(".azw3") || lower.endsWith(".azw") || lower.endsWith(".kf8")) return "azw3";
  if (
    lower.endsWith(".fb2") ||
    lower.endsWith(".fb2.zip") ||
    lower.endsWith(".fbz") ||
    type === "application/x-fictionbook+xml"
  ) {
    return "fb2";
  }
  if (lower.endsWith(".cbz") || type === "application/vnd.comicbook+zip") return "cbz";
  if (lower.endsWith(".cbr") || type === "application/vnd.comicbook-rar") return "cbr";
  if (lower.endsWith(".txt") || lower.endsWith(".text") || type === "text/plain") return "txt";
  if (
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".xhtml") ||
    type === "text/html"
  ) {
    return "html";
  }
  return null;
}

/**
 * Head window for import-time format sniffing. Every magic number sits in the
 * first 4 KB; the MOBI/AZW3 discriminator (record 0) almost always within
 * 64 KB — and a record beyond the window falls back to "mobi".
 */
const SNIFF_HEAD_BYTES = 64 * 1024;

async function sniffSource(source: BookImportSource, name: string): Promise<BookFormat | null> {
  if (source.kind === "file") return sniffBookFormat(source.file);
  if (!isTauri()) return null;
  try {
    const head = await invoke<ArrayBuffer>("read_book_head", {
      path: source.path,
      length: SNIFF_HEAD_BYTES,
    });
    // A head-window File is all the sniffer ever reads from.
    return await sniffBookFormat(new File([head], name));
  } catch (error) {
    log.warn(`Unable to sniff the format of ${name}`, error);
    return null;
  }
}

/**
 * Decide a source's format: by name/MIME first (free), else by magic bytes
 * (some Android providers return extension-less display names; renamed files
 * exist everywhere). Throws the localized "unsupported" error when neither
 * recognizes it.
 */
export async function detectBookFormat(
  source: BookImportSource,
  t: TFunction<"shelf">,
): Promise<BookFormat> {
  const info = sourceFileInfo(source);
  const named = formatFromName(info.name, info.type);
  if (named) return named;
  const sniffed = await sniffSource(source, info.name);
  if (sniffed) return sniffed;
  throw new Error(t("errors.unsupportedFormat", { name: info.name }));
}
