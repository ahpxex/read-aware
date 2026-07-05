import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { isMobileOS, isTauri } from "../../../platform/environment";

/**
 * Extensions accepted by the importer. Single source of truth shared by the
 * native dialog filter and the web `<input accept>` fallback. Mirrors the
 * extensions recognized by `detectBookFormat` in `library-db`.
 */
export const BOOK_FILE_EXTENSIONS = [
  "epub",
  "mobi",
  "prc",
  "azw3",
  "azw",
  "kf8",
  "fb2",
  "fbz",
  "pdf",
] as const;

/** `accept` attribute for the hidden file input used outside the desktop app. */
export const BOOK_FILE_ACCEPT = [
  ...BOOK_FILE_EXTENSIONS.map((ext) => `.${ext}`),
  "application/epub+zip",
  "application/pdf",
  "application/x-fictionbook+xml",
].join(",");

/**
 * Whether the native OS file dialog is available. The Tauri webview ignores the
 * HTML `accept` filter, so on desktop we drive the native dialog instead.
 */
export function canUseNativeFilePicker(): boolean {
  return isTauri();
}

function fileNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

/** Per-request transfer size for the mobile chunked book read. */
const BOOK_READ_CHUNK_BYTES = 256 * 1024;

/**
 * Read a picked book's bytes over the Tauri bridge.
 *
 * Desktop gets the whole file as one raw binary response. Mobile pulls it in
 * small chunks instead: Android injects IPC responses via
 * `evaluateJavascript`, where a multi-megabyte payload takes minutes (or
 * never lands), and Channel messages don't arrive at all — so the Rust side
 * stages the file and the webview requests one bounded slice at a time.
 */
async function readPickedBookBytes(path: string): Promise<Uint8Array> {
  if (!isMobileOS()) {
    // `read_book_file` returns an ipc::Response, so this resolves to an
    // ArrayBuffer — large books transfer as binary, not a JSON number array.
    const bytes = await invoke<ArrayBuffer>("read_book_file", { path });
    return new Uint8Array(bytes);
  }

  const total = await invoke<number>("book_read_open", { path });
  try {
    const merged = new Uint8Array(total);
    for (let offset = 0; offset < total; offset += BOOK_READ_CHUNK_BYTES) {
      const chunk = await invoke<ArrayBuffer>("book_read_chunk", {
        path,
        offset,
        length: BOOK_READ_CHUNK_BYTES,
      });
      merged.set(new Uint8Array(chunk), offset);
    }
    return merged;
  } finally {
    void invoke("book_read_close", { path }).catch(() => {});
  }
}

/**
 * Open the native OS file dialog (desktop only) with a real "Books" format
 * filter and return the chosen files reconstructed as web `File` objects so the
 * rest of the import pipeline stays platform-agnostic.
 */
export async function pickBookFilesNative(t: TFunction<"shelf">): Promise<File[]> {
  const selection = await open({
    multiple: true,
    title: t("importDialog.title"),
    filters: [{ name: t("importDialog.filterName"), extensions: [...BOOK_FILE_EXTENSIONS] }],
  });

  if (selection == null) return [];
  const paths = Array.isArray(selection) ? selection : [selection];

  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readPickedBookBytes(path);
      return new File([bytes as BlobPart], fileNameFromPath(path));
    }),
  );
}
