import { invoke } from "../../../platform/ipc";
import { open } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { isAndroid, isTauri } from "../../../platform/environment";
import type { UserFontPick } from "./user-fonts";

// The shared MainActivity bridge's font methods are declared on
// `Window.ReadAwareAndroid` in features/library/lib/pick-book-files.ts.
type AndroidFontPickBridge = {
  startFontPick?: (generation: number) => void;
  takeFontPickResult?: () => string | null;
};

/**
 * Extensions offered to the native dialog's filter. Selection is NOT
 * validation — `font_import_stage` sniffs magic bytes and parses the SFNT,
 * because providers and extension habits both lie (`.ttc` collections, OTF
 * saved as `.ttf`, fonts with no extension at all).
 */
export const FONT_FILE_EXTENSIONS = ["ttf", "otf", "ttc", "woff", "woff2"] as const;

/** Font import needs the native shell: staging materializes + registers the blob. */
export function canImportFonts(): boolean {
  return isTauri();
}

/** Poll cadence + ceiling for the Android pick flow (book picker's numbers). */
const PICK_POLL_INTERVAL_MS = 300;
const PICK_POLL_TIMEOUT_MS = 10 * 60 * 1000;

let pickGenerationCounter = 0;

function getAndroidFontPickBridge(): AndroidFontPickBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ReadAwareAndroid;
  return bridge?.startFontPick && bridge.takeFontPickResult ? bridge : null;
}

async function startFontPickAndroid(generation: number): Promise<void> {
  const bridge = getAndroidFontPickBridge();
  if (bridge) {
    bridge.startFontPick?.(generation);
    return;
  }
  await invoke("font_pick_start", { generation });
}

async function pollFontPickAndroid(): Promise<string | null> {
  const bridge = getAndroidFontPickBridge();
  if (bridge) return bridge.takeFontPickResult?.() ?? null;
  return await invoke<string | null>("font_pick_poll");
}

/**
 * Android font picking WITHOUT tauri-plugin-dialog — the book picker's parked
 * result pattern: MainActivity holds the picked content URIs natively and
 * this loop polls them, so a paused webview or an in-flight IPC request can
 * never lose the result. Resolves to `null` on cancel.
 */
async function pickFontsAndroid(): Promise<UserFontPick[] | null> {
  const generation = ++pickGenerationCounter;
  await startFontPickAndroid(generation);
  const deadline = performance.now() + PICK_POLL_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PICK_POLL_INTERVAL_MS));
    const parked = await pollFontPickAndroid();
    if (parked == null) continue;
    const [parkedGeneration, ...lines] = parked.split("\n").filter(Boolean);
    // A stale result from an earlier, written-off attempt: keep waiting.
    if (Number(parkedGeneration) !== generation) continue;
    const nativeError = lines.find((line) => line.startsWith("__ERROR__:"));
    if (nativeError) throw new Error(nativeError.slice("__ERROR__:".length));
    return lines.length > 0
      ? lines.map((line) => {
          const [uri, name] = line.split("\t");
          return { path: uri || line, name: name || undefined };
        })
      : null;
  }
  return null;
}

/**
 * Open the font picker: the parked Activity result on Android, the native
 * dialog elsewhere. Returns lightweight `{path, name}` descriptors —
 * `font_import_stage` copies/hashes the file natively, so font bytes never
 * cross the IPC bridge at import either.
 */
export async function pickFontFiles(t: TFunction<"settings">): Promise<UserFontPick[]> {
  if (isAndroid()) {
    return (await pickFontsAndroid()) ?? [];
  }
  const selection = await open({
    multiple: true,
    title: t("font.importTitle"),
    filters: [{ name: t("font.importFilter"), extensions: [...FONT_FILE_EXTENSIONS] }],
  });
  if (selection == null) return [];
  const paths = Array.isArray(selection) ? selection : [selection];
  return paths.map((path) => ({
    path,
    name: path.split(/[\\/]/).pop() || path,
  }));
}
