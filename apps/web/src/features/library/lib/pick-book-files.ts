import { invoke } from "../../../platform/ipc";
import { open } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { isAndroid, isTauri } from "../../../platform/environment";
import type { BookImportSource } from "./library-types";

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
  "cbz",
  "cbr",
  "txt",
  "html",
  "htm",
  "pdf",
] as const;

/** `accept` attribute for the hidden file input used outside the desktop app. */
export const BOOK_FILE_ACCEPT = [
  ...BOOK_FILE_EXTENSIONS.map((ext) => `.${ext}`),
  "application/epub+zip",
  "application/pdf",
  "application/x-fictionbook+xml",
  "application/vnd.comicbook+zip",
  "application/vnd.comicbook-rar",
  "text/plain",
  "text/html",
].join(",");

/**
 * Whether the native OS file dialog is available. The Tauri webview ignores the
 * HTML `accept` filter, so on desktop we drive the native dialog instead.
 */
export function canUseNativeFilePicker(): boolean {
  return isTauri();
}

export function fileNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
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

type AndroidBookPick = {
  uri: string;
  /** Display name from the content provider; null when it would not say. */
  name: string | null;
  /** Byte size from the content provider; null when unknown. */
  size: number | null;
};

/** One parked line: "<uri>\t<name>\t<size>", or a bare URI from older shells. */
function parseParkedPick(line: string): AndroidBookPick {
  const [uri, name, size] = line.split("\t");
  const parsedSize = size == null ? Number.NaN : Number(size);
  return {
    uri: uri || line,
    name: name || null,
    size: Number.isFinite(parsedSize) && parsedSize >= 0 ? parsedSize : null,
  };
}

/**
 * Android book picking WITHOUT tauri-plugin-dialog. MainActivity parks the
 * result natively — content URIs plus provider-resolved display names and
 * sizes — and this loop polls it. Prefer the direct Android JS bridge: it
 * avoids the Rust→JNI hop for opening the picker, while preserving the Tauri
 * invoke fallback for older shells. Resolves to `null` on cancel.
 */
async function pickBooksAndroid(): Promise<AndroidBookPick[] | null> {
  const generation = ++pickGenerationCounter;
  await startBookPickAndroid(generation);
  const deadline = performance.now() + PICK_POLL_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PICK_POLL_INTERVAL_MS));
    const parked = await pollBookPickAndroid();
    if (parked == null) continue;
    const [parkedGeneration, ...lines] = parked.split("\n").filter(Boolean);
    // A stale result from an earlier, written-off attempt: keep waiting.
    if (Number(parkedGeneration) !== generation) continue;
    const nativeError = lines.find((line) => line.startsWith("__ERROR__:"));
    if (nativeError) throw new Error(nativeError.slice("__ERROR__:".length));
    return lines.length > 0 ? lines.map(parseParkedPick) : null;
  }
  return null;
}

/**
 * Open the native OS file dialog with a real "Books" format filter. Every
 * platform returns lightweight path descriptors — Rust copies and extracts
 * from the path directly (`native_path::materialize` resolves Android
 * `content://` URIs), so book bytes never cross the IPC bridge at import.
 * Android routes around the dialog plugin entirely (see pickBooksAndroid).
 */
export async function pickBookFilesNative(t: TFunction<"shelf">): Promise<BookImportSource[]> {
  if (isAndroid()) {
    const picks = await pickBooksAndroid();
    if (picks == null) return [];
    return Promise.all(picks.map(async (pick) => ({
      kind: "native-path" as const,
      path: pick.uri,
      name: pick.name || fileNameFromPath(pick.uri),
      size: pick.size ?? (await invoke<number>("book_file_size", { path: pick.uri })),
    })));
  }

  const selection = await open({
    multiple: true,
    title: t("importDialog.title"),
    filters: [{ name: t("importDialog.filterName"), extensions: [...BOOK_FILE_EXTENSIONS] }],
  });
  if (selection == null) return [];
  const paths = Array.isArray(selection) ? selection : [selection];
  return Promise.all(paths.map(async (path) => ({
    kind: "native-path" as const,
    path,
    name: fileNameFromPath(path),
    size: await invoke<number>("book_file_size", { path }),
  })));
}
