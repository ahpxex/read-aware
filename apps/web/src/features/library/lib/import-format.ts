import type { TFunction } from "i18next";
import { AppError, BOOK_IMPORT_FORMATS } from "@read-aware/core";
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
  if (source.kind === "native-resource") return { name: source.name, size: source.size, type: source.type };
  return source.kind === "native-path"
    ? { name: source.name, size: source.size, type: "" }
    : { name: source.file.name, size: source.file.size, type: source.file.type };
}

/** Format from the file name / MIME type alone; null when neither says. */
export function formatFromName(name: string, type = ""): BookFormat | null {
  const lower = name.toLowerCase();
  return BOOK_IMPORT_FORMATS.find(entry =>
    entry.extensions.some(extension => lower.endsWith("." + extension)) || entry.mimeTypes.includes(type))?.format ?? null;
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
  if (source.kind === "native-resource") {
    const head = await invoke<ArrayBuffer>("resource_read", { id: source.resourceId, offset: 0, length: SNIFF_HEAD_BYTES });
    return sniffBookFormat(new File([head], name));
  }
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
  throw new AppError("book/unsupported-format", t("errors.unsupportedFormat", { name: info.name }));
}
