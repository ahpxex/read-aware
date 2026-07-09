import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { isAndroid, isMobileOS, isTauri } from "../../../platform/environment";

type AndroidBookPickBridge = {
  startBookPick?: (generation: number) => void;
  takeBookPickResult?: () => string | null;
};

declare global {
  interface Window {
    ReadAwareAndroid?: AndroidBookPickBridge;
  }
}

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

/** Poll cadence + ceiling for the Android pick flow. */
const PICK_POLL_INTERVAL_MS = 300;
const PICK_POLL_TIMEOUT_MS = 10 * 60 * 1000;

let pickGenerationCounter = 0;

function getAndroidBookPickBridge(): AndroidBookPickBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ReadAwareAndroid;
  return bridge?.startBookPick && bridge.takeBookPickResult ? bridge : null;
}

async function startBookPickAndroid(generation: number): Promise<void> {
  const bridge = getAndroidBookPickBridge();
  if (bridge) {
    bridge.startBookPick?.(generation);
    return;
  }
  await invoke("book_pick_start", { generation });
}

async function pollBookPickAndroid(): Promise<string | null> {
  const bridge = getAndroidBookPickBridge();
  if (bridge) return bridge.takeBookPickResult?.() ?? null;
  return await invoke<string | null>("book_pick_poll");
}

/**
 * Android book picking WITHOUT tauri-plugin-dialog. MainActivity parks the
 * result natively and this loop polls it. Prefer the direct Android JS bridge:
 * it avoids the Rust→JNI hop for opening the picker, while preserving the Tauri
 * invoke fallback for older shells.
 * Resolves to the picked `content://` URIs, or `null` on cancel.
 */
async function pickBookUrisAndroid(): Promise<string[] | null> {
  const generation = ++pickGenerationCounter;
  await startBookPickAndroid(generation);
  const deadline = performance.now() + PICK_POLL_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PICK_POLL_INTERVAL_MS));
    const parked = await pollBookPickAndroid();
    if (parked == null) continue;
    const [parkedGeneration, ...uris] = parked.split("\n").filter(Boolean);
    // A stale result from an earlier, written-off attempt: keep waiting.
    if (Number(parkedGeneration) !== generation) continue;
    const nativeError = uris.find((uri) => uri.startsWith("__ERROR__:"));
    if (nativeError) throw new Error(nativeError.slice("__ERROR__:".length));
    return uris.length > 0 ? uris : null;
  }
  return null;
}

/**
 * Open the native OS file dialog with a real "Books" format filter and return
 * the chosen files reconstructed as web `File` objects so the rest of the
 * import pipeline stays platform-agnostic. Android routes around the dialog
 * plugin entirely (see pickBookUrisAndroid).
 */
export async function pickBookFilesNative(t: TFunction<"shelf">): Promise<File[]> {
  let paths: string[];
  if (isAndroid()) {
    const uris = await pickBookUrisAndroid();
    if (uris == null) return [];
    paths = uris;
  } else {
    const selection = await open({
      multiple: true,
      title: t("importDialog.title"),
      filters: [{ name: t("importDialog.filterName"), extensions: [...BOOK_FILE_EXTENSIONS] }],
    });
    if (selection == null) return [];
    paths = Array.isArray(selection) ? selection : [selection];
  }

  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readPickedBookBytes(path);
      return new File([bytes as BlobPart], fileNameFromPath(path));
    }),
  );
}
