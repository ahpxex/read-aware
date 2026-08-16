/**
 * Typography for the app's *content* surfaces — the chat transcript (in-book
 * panel and the global Context page alike), the notes panel, plugin markdown
 * views, and the composer you type into.
 *
 * The book already had full typographic control, injected into the foliate
 * iframe (`reader-css.ts`); everything outside it was frozen at Inter/14px.
 * This module is the equivalent seam for the app document: it resolves a
 * stored preference into three CSS custom properties that the content
 * surfaces read, and nothing else. App *chrome* — nav, buttons, field labels
 * — deliberately stays fixed, so growing the reading size never reflows the
 * furniture around it.
 *
 * `followReader` is the default because a reading app should have one
 * typographic voice: pick a face for the book and the conversation about the
 * book speaks in it too. Detaching keeps the reader untouched and lets the
 * chat run its own face and size.
 */
import { localKV } from "../../../platform/local-store";
import { publishRoamingPreference } from "../../../platform/roaming-preferences";
import { readerFontSizeRem, resolveReaderFontStack } from "./reader-css";
import type { PluginFontStackSource } from "./reader-css";
import {
  DEFAULT_READER_SETTINGS,
  type ReaderFontFamily,
  type ReaderLineSpacing,
  type ReaderSettingsPreferences,
} from "./reader-settings";

const STORAGE_KEY = "read-aware-content-typography";

/**
 * A conversational size ladder, not the book's. The reader's eight steps run
 * to 28px because a book page is the whole viewport; a reply sits inside
 * chrome, so the useful range is narrower and centered on today's 14px.
 */
export type ContentFontSize = "x-small" | "small" | "medium" | "large" | "x-large";

export const CONTENT_FONT_SIZES = [
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
] as const satisfies readonly ContentFontSize[];

const CONTENT_FONT_SIZE_REM: Record<ContentFontSize, number> = {
  "x-small": 0.75,
  small: 0.8125,
  medium: 0.875,
  large: 0.9375,
  "x-large": 1.0625,
};

const CONTENT_LINE_HEIGHT: Record<ReaderLineSpacing, string> = {
  compact: "1.45",
  comfortable: "1.65",
  relaxed: "1.9",
};

/**
 * How much smaller content runs than the book when following it. Anchored so
 * the reader's default (`medium`, 1.0625rem) lands exactly on the content
 * default (`medium`, 0.875rem) — following changes nothing until you move the
 * reading size, which is what "follow" should feel like on first run.
 */
const FOLLOW_RATIO =
  CONTENT_FONT_SIZE_REM.medium / readerFontSizeRem(DEFAULT_READER_SETTINGS.fontSize);

/** Clamp for the followed size, so an extreme book size stays usable in chrome. */
const FOLLOW_MIN_REM = CONTENT_FONT_SIZE_REM["x-small"];
const FOLLOW_MAX_REM = 1.375;

export type ContentTypographySettings = {
  /** Take the family and line spacing from the reading settings. */
  followReader: boolean;
  /** Used only while detached. */
  fontFamily: ReaderFontFamily | null;
  /** Used only while detached. */
  fontSize: ContentFontSize;
  /** Used only while detached. */
  lineSpacing: ReaderLineSpacing;
};

/**
 * `fontFamily: null` means the app's own sans (the `--font-sans` token) —
 * the face content surfaces have always used. It is a real choice, not an
 * absent one, so a detached user can go back to it.
 */
export const DEFAULT_CONTENT_TYPOGRAPHY: ContentTypographySettings = {
  followReader: true,
  fontFamily: null,
  fontSize: "medium",
  lineSpacing: "comfortable",
};

function normalizeFontSize(value: unknown): ContentFontSize {
  return CONTENT_FONT_SIZES.includes(value as ContentFontSize)
    ? (value as ContentFontSize)
    : DEFAULT_CONTENT_TYPOGRAPHY.fontSize;
}

function normalizeLineSpacing(value: unknown): ReaderLineSpacing {
  return value === "compact" || value === "comfortable" || value === "relaxed"
    ? value
    : DEFAULT_CONTENT_TYPOGRAPHY.lineSpacing;
}

function normalizeFontFamily(value: unknown): ReaderFontFamily | null {
  return typeof value === "string" &&
    (value.startsWith("curated:") ||
      value.startsWith("system:") ||
      value.startsWith("plugin:"))
    ? (value as ReaderFontFamily)
    : null;
}

export function getContentTypography(): ContentTypographySettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONTENT_TYPOGRAPHY;
    const parsed = JSON.parse(raw) as Partial<ContentTypographySettings>;
    return {
      followReader: parsed.followReader ?? DEFAULT_CONTENT_TYPOGRAPHY.followReader,
      fontFamily: normalizeFontFamily(parsed.fontFamily),
      fontSize: normalizeFontSize(parsed.fontSize),
      lineSpacing: normalizeLineSpacing(parsed.lineSpacing),
    };
  } catch {
    return DEFAULT_CONTENT_TYPOGRAPHY;
  }
}

export function saveContentTypography(settings: ContentTypographySettings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings));
  // Content typography roams with the reader settings it can follow.
  publishRoamingPreference(STORAGE_KEY, settings);
}

/** The font selection actually in force, so callers know which face to load. */
export function activeContentFont(
  settings: ContentTypographySettings,
  reader: ReaderSettingsPreferences,
): ReaderFontFamily | null {
  return settings.followReader ? reader.fontFamily : settings.fontFamily;
}

/** The three values the content surfaces render with. */
export type ResolvedContentTypography = {
  /** A CSS `font-family` stack, or null to keep the app's own sans. */
  fontFamily: string | null;
  fontSize: string;
  lineHeight: string;
};

export function resolveContentTypography(
  settings: ContentTypographySettings,
  reader: ReaderSettingsPreferences,
  pluginFont?: PluginFontStackSource | null,
): ResolvedContentTypography {
  const font = activeContentFont(settings, reader);
  const fontFamily = font ? resolveReaderFontStack(font, pluginFont) : null;

  if (!settings.followReader) {
    return {
      fontFamily,
      fontSize: `${CONTENT_FONT_SIZE_REM[settings.fontSize]}rem`,
      lineHeight: CONTENT_LINE_HEIGHT[settings.lineSpacing],
    };
  }

  const followed = readerFontSizeRem(reader.fontSize) * FOLLOW_RATIO;
  const clamped = Math.min(FOLLOW_MAX_REM, Math.max(FOLLOW_MIN_REM, followed));
  return {
    fontFamily,
    // Trimmed to 4 decimals: the ratio is irrational-ish and the raw value
    // would write a 17-digit custom property on every settings change.
    fontSize: `${Number(clamped.toFixed(4))}rem`,
    lineHeight: CONTENT_LINE_HEIGHT[reader.lineSpacing],
  };
}

/** The custom properties the content surfaces read. Mirrors `index.css`. */
export const CONTENT_TYPOGRAPHY_VARS = {
  fontFamily: "--ra-content-font-family",
  fontSize: "--ra-content-font-size",
  lineHeight: "--ra-content-line-height",
} as const;

/**
 * Write the resolved values onto an element (the document root in the app).
 * A null family removes the property rather than writing a fallback, so the
 * `:root` default in `index.css` — the app's own sans — takes over.
 */
export function applyContentTypography(
  root: HTMLElement,
  resolved: ResolvedContentTypography,
): void {
  if (resolved.fontFamily) {
    root.style.setProperty(CONTENT_TYPOGRAPHY_VARS.fontFamily, resolved.fontFamily);
  } else {
    root.style.removeProperty(CONTENT_TYPOGRAPHY_VARS.fontFamily);
  }
  root.style.setProperty(CONTENT_TYPOGRAPHY_VARS.fontSize, resolved.fontSize);
  root.style.setProperty(CONTENT_TYPOGRAPHY_VARS.lineHeight, resolved.lineHeight);
}
