/**
 * Imported user fonts: the registry atom, CSS naming, and the import/remove
 * orchestration the font pickers call.
 *
 * The registry is a synced projection (`user_fonts` via `userFont.*` events);
 * bytes live in synced `userfont:` blobs and are served to the reader's
 * @font-face over `rablob://localhost/font/<sha256>` — the same scheme covers
 * use, no font bytes cross the IPC bridge at render time.
 *
 * Reader appearance preferences stay device-local by design, so removing a
 * font sweeps the local prefs/overrides that referenced it back to the
 * default instead of leaving a dangling `user:<id>` in every stored slot.
 */
import { atom, getDefaultStore } from "jotai";
import type { UserFontFormat } from "@read-aware/core";
import {
  commitUserFontImported,
  commitUserFontRemoved,
  listUserFonts,
  observeFontInvalidation,
  releaseUserFontFiles,
  stageUserFontImport,
  type UserFontEntry,
} from "../../../domain/fonts";
import { customSchemeUrl } from "../../../platform/custom-scheme";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import {
  DEFAULT_READER_SETTINGS,
  isUserFont,
  toUserFont,
  userFontId,
  type ReaderFontFamily,
  type ReaderSettingsPreferences,
} from "./reader-settings";
import { saveContentTypography, getContentTypography } from "./content-typography";
import { readerPreferencesAtom, readerOverridesAtom, contentTypographyAtom } from "../../../state/ui";

const log = createLogger("user-fonts");

/** Picks handed to `font_import_stage`: a native path or content:// URI. */
export type UserFontPick = { path: string; name?: string };

// ── Registry atom + invalidation ────────────────────────────────────────────

export const userFontsAtom = atom<UserFontEntry[]>([]);

let initialized = false;

/**
 * Bind the atom to the projection for the app's lifetime: first populate,
 * then re-read whenever a `userFont.*` event lands (local or replayed) or a
 * font's bytes arrive (`user-fonts-changed` flips `bytesLocal`).
 */
export function initializeUserFonts(): void {
  if (initialized) return;
  initialized = true;
  const refresh = async () => {
    try {
      const fonts = await listUserFonts();
      getDefaultStore().set(userFontsAtom, fonts);
      // A remote removal leaves this device's stored `user:<id>` selection
      // dangling — sweep it only against an authoritative list (never the
      // pre-read placeholder, which would wipe every user: ref at boot).
      sweepDanglingUserFonts(fonts);
    } catch (error) {
      log.warn("User font list read failed", error);
    }
  };
  void refresh();
  observeFontInvalidation(() => {
    void refresh();
  });
}

/** Re-read the registry (used after imports, which broadcast their event anyway). */
export async function refreshUserFonts(): Promise<void> {
  const fonts = await listUserFonts();
  getDefaultStore().set(userFontsAtom, fonts);
  sweepDanglingUserFonts(fonts);
}

/** The registry row behind a `user:` selection, or undefined when gone. */
export function findUserFont(fontFamily: ReaderFontFamily, fonts: UserFontEntry[]): UserFontEntry | undefined {
  const id = userFontId(fontFamily);
  return id ? fonts.find((font) => font.id === id) : undefined;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

/** The @font-face family name — generated, never the font's own family name,
 *  so an imported "Inter" can never shadow the curated/system Inter. */
export function userFontCssFamily(fontId: string): string {
  return `ra-user-${fontId}`;
}

/** The blob URL a @font-face `src` points at (scheme-mapped per platform). */
export function userFontFaceUrl(fontId: string): string {
  return customSchemeUrl("rablob", `font/${fontId}`);
}

const FONT_FACE_FORMAT: Record<UserFontFormat, string | null> = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
  // Collections have no format() keyword; omit it and let the loader sniff.
  ttc: null,
};

/**
 * The @font-face rule behind one registry row. Variable fonts advertise their
 * weight axis as a range so the reader's weight presets map onto the axis
 * instead of synthesizing each grade. `font-display:swap` keeps text reading
 * in the fallback while bytes arrive.
 */
export function userFontFaceCss(font: UserFontEntry): string {
  const format = FONT_FACE_FORMAT[font.format];
  const weight = font.weightMax ? `${font.weight} ${font.weightMax}` : `${font.weight}`;
  return (
    `@font-face{font-family:"${userFontCssFamily(font.id)}";` +
    `font-style:${font.italic ? "italic" : "normal"};` +
    `font-weight:${weight};` +
    `font-display:swap;` +
    `src:url(${userFontFaceUrl(font.id)})${format ? ` format("${format}")` : ""};}`
  );
}

// ── Import / remove ─────────────────────────────────────────────────────────

/**
 * Stage + commit each picked file. Staging registers the blob and parses the
 * name table (the display name is NEVER the file name); the committed event
 * projects the registry row and manifests the blob for sync. A file that
 * fails validation throws before any event commits — earlier picks in the
 * batch that already committed stay imported.
 */
export async function importUserFonts(picks: UserFontPick[]): Promise<StagedImportSummary> {
  const summary: StagedImportSummary = { imported: [], alreadyPresent: 0 };
  for (const pick of picks) {
    const staged = await stageUserFontImport(pick.path, pick.name);
    if (staged.alreadyPresent) {
      summary.alreadyPresent += 1;
      continue;
    }
    await commitUserFontImported("user", staged);
    summary.imported.push(staged);
  }
  return summary;
}

export type StagedImportSummary = { imported: { fontId: string; name: string }[]; alreadyPresent: number };

/**
 * Remove an imported font: commit the event (the projection row drops and its
 * AFTER DELETE trigger queues the blob's release), release this device's copy,
 * and sweep local prefs that selected it back to the default font.
 */
export async function removeUserFont(font: UserFontEntry): Promise<void> {
  if (!isTauri()) return;
  await commitUserFontRemoved("user", font.id, font.blobKey);
  // Best-effort byte release: the durable intent retries at boot if this fails.
  try {
    await releaseUserFontFiles([font.id]);
  } catch (error) {
    log.warn(`Font blob release deferred for ${font.id}`, error);
  }
  sweepUserFontReferences(font.id);
}

/** Every stored `user:` ref whose id the registry no longer knows → default. */
function sweepDanglingUserFonts(fonts: UserFontEntry[]): void {
  const store = getDefaultStore();
  const known = new Set(fonts.map((font) => font.id));
  const dangling = (value: ReaderFontFamily | null): boolean =>
    value !== null && isUserFont(value) && !known.has(userFontId(value) ?? "");

  const sweepPrefs = (value: ReaderSettingsPreferences): ReaderSettingsPreferences | null => {
    const fontFamily = dangling(value.fontFamily) ? DEFAULT_READER_SETTINGS.fontFamily : value.fontFamily;
    const languageFonts = value.languageFonts
      ? Object.fromEntries(
          Object.entries(value.languageFonts).map(([lang, font]) => [
            lang,
            dangling(font.fontFamily) ? { ...font, fontFamily: DEFAULT_READER_SETTINGS.fontFamily } : font,
          ]),
        )
      : value.languageFonts;
    if (fontFamily === value.fontFamily && languageFonts === value.languageFonts) return null;
    return { ...value, fontFamily, languageFonts };
  };

  const prefs = store.get(readerPreferencesAtom);
  const sweptPrefs = sweepPrefs(prefs);
  if (sweptPrefs) store.set(readerPreferencesAtom, sweptPrefs);

  const overrides = store.get(readerOverridesAtom);
  let changed = false;
  const nextOverrides = Object.fromEntries(
    Object.entries(overrides).map(([bookId, override]) => {
      const swept = sweepPrefs(override.settings);
      if (!swept) return [bookId, override];
      changed = true;
      return [bookId, { ...override, settings: swept }];
    }),
  );
  if (changed) store.set(readerOverridesAtom, nextOverrides);

  const typography = getContentTypography();
  if (dangling(typography.fontFamily)) {
    saveContentTypography({ ...typography, fontFamily: null });
    store.set(contentTypographyAtom, getContentTypography());
  }
}

/** Sweep local prefs/overrides that reference `user:<fontId>` → default font. */
function sweepUserFontReferences(fontId: string): void {
  const ref = toUserFont(fontId);
  const store = getDefaultStore();
  const sweepPrefs = (value: ReaderSettingsPreferences): ReaderSettingsPreferences => {
    const fontFamily = value.fontFamily === ref ? DEFAULT_READER_SETTINGS.fontFamily : value.fontFamily;
    const languageFonts = value.languageFonts
      ? Object.fromEntries(
          Object.entries(value.languageFonts).map(([lang, font]) => [
            lang,
            font.fontFamily === ref ? { ...font, fontFamily: DEFAULT_READER_SETTINGS.fontFamily } : font,
          ]),
        )
      : value.languageFonts;
    return { ...value, fontFamily, languageFonts };
  };
  const prefs = store.get(readerPreferencesAtom);
  const nextPrefs = sweepPrefs(prefs);
  if (nextPrefs !== prefs) store.set(readerPreferencesAtom, nextPrefs);

  const overrides = store.get(readerOverridesAtom);
  let changed = false;
  const nextOverrides = Object.fromEntries(
    Object.entries(overrides).map(([bookId, override]) => {
      const swept = sweepPrefs(override.settings);
      if (swept === override.settings) return [bookId, override];
      changed = true;
      return [bookId, { ...override, settings: swept }];
    }),
  );
  if (changed) store.set(readerOverridesAtom, nextOverrides);

  // Content typography (chat/notes surfaces) has its own default — the app
  // sans — not the reader's.
  const typography = getContentTypography();
  if (typography.fontFamily === ref) {
    saveContentTypography({ ...typography, fontFamily: null });
    store.set(contentTypographyAtom, getContentTypography());
  }
}
