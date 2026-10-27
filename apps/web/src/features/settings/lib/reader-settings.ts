import { hasCoarsePointer } from "../../../platform/environment";
import { localKV } from "../../../platform/local-store";
import { copyEventCause, type DomainActor } from "../../../platform/domain-actor";
import { isPluginRef } from "../../plugins/lib/plugin-theme";
import { getCuratedFont } from "./curated-font-catalog";
import { normalizeBookLanguage } from "../../reader/lib/book-language";

export const READER_PREFERENCES_KEY = "read-aware-reader-settings";
const STORAGE_KEY = READER_PREFERENCES_KEY;

/** The app's own page colors, always available. */
export type BuiltinReaderTheme = "light" | "warm" | "dark";
/**
 * Concrete, render-ready page color: a built-in, or a plugin theme ref
 * (`plugin:<pluginId>:<themeId>`). A ref's palette resolves through the
 * plugin theme registry at render time (`resolveReaderPalette`), falling back
 * to `warm` while the plugin is missing — the stored value survives so
 * re-enabling the plugin restores the look.
 */
export type ReaderTheme = BuiltinReaderTheme | `plugin:${string}`;
/** Stored page-color preference — `auto` follows the resolved app theme. */
export type ReaderThemePreference = ReaderTheme | "auto";
/**
 * The reader's body font. Four sources:
 * - `curated:<id>` — one of our curated reading fonts, fetched and cached on
 *   demand the first time it's used (see `curated-font-loader`).
 * - `system:<family>` — a specific family installed on the user's device.
 * - `plugin:<pluginId>:<fontId>` — a font bundled by an enabled plugin,
 *   served straight from its folder.
 * - `user:<sha256>` — a font file the user imported into the app (mobile's
 *   custom-font story; the registry + bytes sync, see domain/fonts.ts).
 */
export type ReaderFontFamily = `curated:${string}` | `system:${string}` | `plugin:${string}` | `user:${string}`;

export const CURATED_FONT_PREFIX = "curated:";
export const SYSTEM_FONT_PREFIX = "system:";
export const PLUGIN_FONT_PREFIX = "plugin:";
export const USER_FONT_PREFIX = "user:";

/** True when `font` is one of the curated reading fonts. */
export function isCuratedFont(font: ReaderFontFamily): font is `curated:${string}` {
  return font.startsWith(CURATED_FONT_PREFIX);
}

/** True when `font` names a user-picked installed family. */
export function isSystemFont(font: ReaderFontFamily): font is `system:${string}` {
  return font.startsWith(SYSTEM_FONT_PREFIX);
}

/** True when `font` names a plugin-bundled font. */
export function isPluginFont(font: ReaderFontFamily): font is `plugin:${string}` {
  return font.startsWith(PLUGIN_FONT_PREFIX);
}

/** The curated font id behind a `curated:` selection, or `null` otherwise. */
export function curatedFontId(font: ReaderFontFamily): string | null {
  return isCuratedFont(font) ? font.slice(CURATED_FONT_PREFIX.length) : null;
}

/** The bare family name behind a `system:` font, or `null` otherwise. */
export function systemFontFamily(font: ReaderFontFamily): string | null {
  return isSystemFont(font) ? font.slice(SYSTEM_FONT_PREFIX.length) : null;
}

/** True when `font` names an imported (user-supplied) font file. */
export function isUserFont(font: ReaderFontFamily): font is `user:${string}` {
  return font.startsWith(USER_FONT_PREFIX);
}

/** The content-hash id behind a `user:` font, or `null` otherwise. */
export function userFontId(font: ReaderFontFamily): string | null {
  return isUserFont(font) ? font.slice(USER_FONT_PREFIX.length) : null;
}

/** Tag a curated font id as a reader font selection. */
export function toCuratedFont(id: string): `curated:${string}` {
  return `${CURATED_FONT_PREFIX}${id}`;
}

/** Tag an installed family name as a reader font selection. */
export function toSystemFont(family: string): `system:${string}` {
  return `${SYSTEM_FONT_PREFIX}${family}`;
}

/** Tag an imported font's content-hash id as a reader font selection. */
export function toUserFont(fontId: string): `user:${string}` {
  return `${USER_FONT_PREFIX}${fontId}`;
}
export type ReaderFontSize =
  | "xx-small"
  | "x-small"
  | "small"
  | "medium"
  | "large"
  | "x-large"
  | "xx-large"
  | "xxx-large";
/** Body-text presets use the standard CSS weight names and values. */
export const READER_FONT_WEIGHTS = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  "extra-bold": 800,
  black: 900,
} as const;
export type ReaderFontWeight = keyof typeof READER_FONT_WEIGHTS;

/** Built-in fonts expose only real faces; installed/plugin fonts use CSS matching. */
export function readerFontWeightPresets(fontFamily?: ReaderFontFamily): ReaderFontWeight[] {
  const id = fontFamily && curatedFontId(fontFamily);
  const weights = id ? getCuratedFont(id)?.weights : undefined;
  return (Object.keys(READER_FONT_WEIGHTS) as ReaderFontWeight[]).filter(
    (preset) => !weights || weights.includes(READER_FONT_WEIGHTS[preset]),
  );
}

/**
 * Keep a stored preference across font switches, while controls and rendering
 * agree on the available face. All curated families supply 400 and 700: CSS
 * matches 500 downward to 400, and weights above 500 upward first.
 */
export function resolveReaderFontWeight(preferred: ReaderFontWeight, fontFamily?: ReaderFontFamily): ReaderFontWeight {
  const presets = readerFontWeightPresets(fontFamily);
  if (presets.includes(preferred)) return preferred;
  const weight = READER_FONT_WEIGHTS[preferred];
  if (weight <= 500) {
    return presets.findLast((preset) => READER_FONT_WEIGHTS[preset] <= weight) ?? presets[0]!;
  }
  return presets.find((preset) => READER_FONT_WEIGHTS[preset] >= weight) ?? presets.at(-1)!;
}
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";
export type ReaderParagraphSpacing = "tight" | "normal" | "loose";

/** The rem behind each font-size preset. Consumed by the reader stylesheet
 * (`reader-css.ts`) and by custom-typography seeding. */
export const READER_FONT_SIZE_REM = {
  "xx-small": "0.8125rem",
  "x-small": "0.875rem",
  small: "0.9375rem",
  medium: "1.0625rem",
  large: "1.1875rem",
  "x-large": "1.3125rem",
  "xx-large": "1.5rem",
  "xxx-large": "1.75rem",
} as const;

/** Unitless line-height behind each line-spacing preset. */
export const READER_LINE_HEIGHT = {
  compact: "1.55",
  comfortable: "1.85",
  relaxed: "2.15",
} as const;

/** The margin-bottom behind each paragraph-spacing preset. */
export const READER_PARAGRAPH_SPACING_REM = {
  tight: "0.6rem",
  normal: "1.25rem",
  loose: "1.9rem",
} as const;

/**
 * Page margin presets — each drives the text measure, the paginator gap, and
 * the body padding together (see `reader-css.ts`). The default is
 * device-appropriate: mobile-typical tight margins on touch screens, the
 * roomier editorial measure on desktop.
 */
export type ReaderPageMargins = "narrow" | "medium" | "wide";

/**
 * Whether the four typography settings are preset tiers (`preset`, today's
 * choices) or exact numbers (`custom`). Switching modes never discards
 * `customTypography`: a first switch seeds it from the live presets, later
 * switches keep the user's numbers.
 */
export type ReaderTypographyMode = "preset" | "custom";

/**
 * Preset first-line indent: `book` follows the publisher (the default —
 * forcing an indent flattens publisher hanging indents on notes), `none`
 * forces zero, `two` forces a 2em indent.
 */
export type ReaderTextIndent = "book" | "none" | "two";

/** Exact typography values, used while `typographyMode` is `custom`. */
export type ReaderCustomTypography = {
  fontSizePx: number;
  lineHeight: number;
  paragraphSpacingEm: number;
  /** Outer side margin, % of the reader width. */
  pageMarginPercent: number;
  /** null = follow the book's own indent. */
  textIndentEm: number | null;
};

export const READER_CUSTOM_TYPOGRAPHY_LIMITS = {
  fontSizePx: { min: 12, max: 40, step: 1 },
  lineHeight: { min: 1, max: 3, step: 0.05 },
  paragraphSpacingEm: { min: 0, max: 3, step: 0.1 },
  pageMarginPercent: { min: 0, max: 25, step: 1 },
  textIndentEm: { min: 0, max: 4, step: 0.5 },
} as const;

const roundToStep = (value: number, { min, max, step }: { min: number; max: number; step: number }): number => {
  const clamped = Math.min(max, Math.max(min, value));
  const decimals = String(step).split(".")[1]?.length ?? 0;
  return Number((Math.round(clamped / step) * step).toFixed(decimals));
};

/** Clamp + snap one custom-typography field to its limits — the single rule
 *  shared by storage normalization and the agent settings catalog. */
export function snapCustomTypographyValue(key: keyof typeof READER_CUSTOM_TYPOGRAPHY_LIMITS, value: number): number {
  return roundToStep(value, READER_CUSTOM_TYPOGRAPHY_LIMITS[key]);
}

/** Coerce a persisted custom-typography object: every field must exist and be
 *  finite (textIndentEm may be null); values are clamped and snapped to their
 *  step so no float noise persists. Anything else drops the whole object. */
export function normalizeCustomTypography(value: unknown): ReaderCustomTypography | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const num = (key: keyof typeof READER_CUSTOM_TYPOGRAPHY_LIMITS): number | undefined => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) ? snapCustomTypographyValue(key, raw) : undefined;
  };
  const fontSizePx = num("fontSizePx");
  const lineHeight = num("lineHeight");
  const paragraphSpacingEm = num("paragraphSpacingEm");
  const pageMarginPercent = num("pageMarginPercent");
  const textIndentEm = record.textIndentEm === null ? null : num("textIndentEm");
  if (
    fontSizePx === undefined ||
    lineHeight === undefined ||
    paragraphSpacingEm === undefined ||
    pageMarginPercent === undefined ||
    textIndentEm === undefined
  )
    return undefined;
  return { fontSizePx, lineHeight, paragraphSpacingEm, pageMarginPercent, textIndentEm };
}

/** Seed custom values from the live presets, so switching modes does not move
 *  the text: same size, same leading, same measure, same indent intent. */
export function customTypographyFromPresets(
  settings: Pick<ReaderSettings, "fontSize" | "lineSpacing" | "paragraphSpacing" | "pageMargins" | "textIndent">,
): ReaderCustomTypography {
  const fontSizePx = Math.round(parseFloat(READER_FONT_SIZE_REM[settings.fontSize]) * 16);
  return {
    fontSizePx,
    lineHeight: parseFloat(READER_LINE_HEIGHT[settings.lineSpacing]),
    paragraphSpacingEm:
      Math.round(((parseFloat(READER_PARAGRAPH_SPACING_REM[settings.paragraphSpacing]) * 16) / fontSizePx) * 10) / 10,
    // The preset tiers measured against a desktop-width reader.
    pageMarginPercent: { narrow: 2, medium: 8, wide: 14 }[settings.pageMargins],
    textIndentEm: { book: null, none: 0, two: 2 }[settings.textIndent],
  };
}
/**
 * How the book is laid out and navigated:
 * - `scroll` — continuous vertical scroll, lazily loading sections as you go.
 * - `paginated-single` — page turning, one column.
 * - `paginated-double` — page turning, two columns on a wide viewport.
 */
export type ReadingMode = "scroll" | "paginated-single" | "paginated-double";

const READING_MODES: readonly ReadingMode[] = ["scroll", "paginated-single", "paginated-double"];

/** Coerce a persisted reading-mode value; junk becomes null for the caller's default. */
export function normalizeReadingMode(value: unknown): ReadingMode | null {
  return READING_MODES.includes(value as ReadingMode) ? (value as ReadingMode) : null;
}

/**
 * Body-text alignment.
 *
 * `book` — the default — declares nothing and lets the publisher's stylesheet
 * decide. That is deliberate: for CJK, justified text is the correct setting
 * (no inter-word spaces to stretch, so no rivers), while English justified
 * without hyphenation reads worse than ragged-right. The publisher usually
 * knows which of those their book is. The other two force the choice, for
 * readers who have a preference and want it to hold everywhere.
 */
export type ReaderTextAlign = "book" | "start" | "justify";

/**
 * How a fixed-layout page (PDF, comic) answers the page color.
 *
 * `theme` paints the page in the reader's palette — a light palette tints the
 * paper at render time and leaves every ink and photograph untouched, while a
 * dark palette has to remap the page's whole tonal range between the palette's
 * text and background colors, which renders it in grayscale. `original` leaves
 * the page exactly as its publisher drew it, on its own white paper.
 */
export type FixedLayoutColor = "theme" | "original";

/**
 * Effective, render-ready reader settings. `theme` is always concrete here —
 * the `auto` preference has already been resolved against the app theme.
 */
export type ReaderSettings = {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: ReaderFontSize;
  fontWeight: ReaderFontWeight;
  lineSpacing: ReaderLineSpacing;
  paragraphSpacing: ReaderParagraphSpacing;
  pageMargins: ReaderPageMargins;
  textAlign: ReaderTextAlign;
  textIndent: ReaderTextIndent;
  typographyMode: ReaderTypographyMode;
  /** Exact values for `custom` mode; absent until that mode is first used. */
  customTypography?: ReaderCustomTypography;
  readingMode: ReadingMode;
  /**
   * Fixed-layout books (PDF, comics) carry their own mode axis: their pages
   * are typeset sheets, and continuous scroll is how every PDF reader on
   * earth presents those — while reflowable books keep the device-split
   * paginated default. One shared mode forced PDFs into whatever the reader
   * chose for novels.
   */
  fixedLayoutReadingMode: ReadingMode;
  fixedLayoutColor: FixedLayoutColor;
};

export type ReaderFontPreferences = Pick<ReaderSettings, "fontFamily" | "fontWeight">;

/** Global preferences also remember font choices by the book's primary language. */
export type ReaderSettingsPreferences = Omit<ReaderSettings, "theme"> & {
  theme: ReaderThemePreference;
  languageFonts?: Record<string, ReaderFontPreferences>;
};

/** Book overrides receive a flat snapshot, never another copy of the language table. */
export function readerPreferencesForLanguage(
  prefs: ReaderSettingsPreferences,
  language?: string,
): ReaderSettingsPreferences {
  const { languageFonts, ...base } = prefs;
  const font = languageFonts?.[normalizeBookLanguage(language) ?? "und"];
  return copyEventCause(prefs, { ...base, ...font });
}

/** In-book global font edits affect this language; every other control stays shared. */
export function updateReaderLanguagePreferences(
  global: ReaderSettingsPreferences,
  language: string | undefined,
  next: ReaderSettingsPreferences,
): ReaderSettingsPreferences {
  const current = readerPreferencesForLanguage(global, language);
  const { languageFonts: _ignored, ...base } = next;
  const changed = next.fontFamily !== current.fontFamily || next.fontWeight !== current.fontWeight;
  return {
    ...global,
    ...base,
    fontFamily: global.fontFamily,
    fontWeight: global.fontWeight,
    ...(changed
      ? {
          languageFonts: {
            ...global.languageFonts,
            [normalizeBookLanguage(language) ?? "und"]: { fontFamily: next.fontFamily, fontWeight: next.fontWeight },
          },
        }
      : {}),
  };
}

function normalizeLanguageFonts(value: unknown): Record<string, ReaderFontPreferences> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, font]) => {
    const language = key === "und" ? key : normalizeBookLanguage(key);
    if (!language || !font || typeof font !== "object" || Array.isArray(font)) return [];
    return [
      [
        language,
        { fontFamily: normalizeFontFamily(font.fontFamily), fontWeight: normalizeFontWeight(font.fontWeight) },
      ] as const,
    ];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "warm",
  fontFamily: "curated:inter",
  fontSize: "medium",
  fontWeight: "regular",
  lineSpacing: "comfortable",
  paragraphSpacing: "normal",
  textAlign: "book",
  textIndent: "book",
  typographyMode: "preset",
  // Touch screens read with mobile-typical tight margins by default; desktop
  // keeps the roomier editorial measure. Evaluated once — it's a device trait.
  pageMargins: hasCoarsePointer() ? "narrow" : "wide",
  // Same device split: phones page one column at a time, desktop opens as a
  // two-page spread (the renderer already folds a spread to one column while
  // the viewport is portrait, so narrow desktop windows stay readable).
  readingMode: hasCoarsePointer() ? "paginated-single" : "paginated-double",
  fixedLayoutReadingMode: "scroll",
  // Most fixed-layout reading is text on paper, where following the palette is
  // the whole point of choosing one; readers of photography and art books can
  // turn it off per book.
  fixedLayoutColor: "theme",
};

export const DEFAULT_READER_PREFERENCES: ReaderSettingsPreferences = {
  ...DEFAULT_READER_SETTINGS,
  theme: "warm",
};

/** Coerce a persisted font value to a valid selection, migrating legacy presets. */
export function normalizeFontFamily(value: unknown): ReaderFontFamily {
  if (typeof value === "string") {
    // Legacy presets predate the curated/system split.
    if (value === "sans") return "curated:inter";
    if (value === "serif") return "curated:literata";
    if (value.startsWith(CURATED_FONT_PREFIX) && value.length > CURATED_FONT_PREFIX.length) {
      return value as `curated:${string}`;
    }
    if (value.startsWith(SYSTEM_FONT_PREFIX) && value.length > SYSTEM_FONT_PREFIX.length) {
      return value as `system:${string}`;
    }
    // Imported fonts key by content hash; anything else under the prefix is junk.
    if (value.startsWith(USER_FONT_PREFIX) && /^[0-9a-f]{64}$/.test(value.slice(USER_FONT_PREFIX.length))) {
      return value as `user:${string}`;
    }
    if (isPluginRef(value)) return value;
  }
  return DEFAULT_READER_SETTINGS.fontFamily;
}

/** Coerce a persisted page-color preference to a valid value. */
export function normalizeReaderTheme(value: unknown): ReaderThemePreference {
  if (value === "auto" || value === "light" || value === "warm" || value === "dark") {
    return value;
  }
  if (isPluginRef(value)) return value;
  return DEFAULT_READER_PREFERENCES.theme;
}

const FONT_SIZES: ReaderFontSize[] = [
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
];
// A brief interim build stored sizes as px strings; map them back to a tier.
const LEGACY_PX_FONT_SIZE: Record<string, ReaderFontSize> = {
  "13": "xx-small",
  "14": "x-small",
  "15": "small",
  "16": "small",
  "17": "medium",
  "18": "medium",
  "19": "large",
  "20": "large",
  "21": "x-large",
  "24": "xx-large",
  "28": "xxx-large",
};

/** Coerce a persisted font size to a valid tier. */
export function normalizeFontSize(value: unknown): ReaderFontSize {
  if (typeof value === "string") {
    if ((FONT_SIZES as string[]).includes(value)) return value as ReaderFontSize;
    if (value in LEGACY_PX_FONT_SIZE) return LEGACY_PX_FONT_SIZE[value];
  }
  return DEFAULT_READER_SETTINGS.fontSize;
}

/** Coerce a persisted page-margin preset to a valid value. */
export function normalizePageMargins(value: unknown): ReaderPageMargins {
  if (value === "narrow" || value === "medium" || value === "wide") return value;
  return DEFAULT_READER_SETTINGS.pageMargins;
}

/** Coerce a persisted alignment preset to a valid value. */
export function normalizeTextAlign(value: unknown): ReaderTextAlign {
  if (value === "book" || value === "start" || value === "justify") return value;
  return DEFAULT_READER_SETTINGS.textAlign;
}

/** Coerce a persisted first-line-indent preset to a valid value. */
export function normalizeTextIndent(value: unknown): ReaderTextIndent {
  if (value === "book" || value === "none" || value === "two") return value;
  return DEFAULT_READER_SETTINGS.textIndent;
}

/** Coerce a persisted typography mode to a valid value. */
export function normalizeTypographyMode(value: unknown): ReaderTypographyMode {
  if (value === "preset" || value === "custom") return value;
  return DEFAULT_READER_SETTINGS.typographyMode;
}

/** Coerce a persisted font-weight preset to a valid value. */
export function normalizeFontWeight(value: unknown): ReaderFontWeight {
  if (typeof value === "string" && Object.hasOwn(READER_FONT_WEIGHTS, value)) {
    return value as ReaderFontWeight;
  }
  return DEFAULT_READER_SETTINGS.fontWeight;
}

export function getReaderPreferences(): ReaderSettingsPreferences {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ReaderSettingsPreferences>;
    const languageFonts = normalizeLanguageFonts(parsed.languageFonts);
    const customTypography = normalizeCustomTypography(parsed.customTypography);
    return {
      ...(languageFonts ? { languageFonts } : {}),
      theme: normalizeReaderTheme(parsed.theme),
      fontFamily: normalizeFontFamily(parsed.fontFamily),
      fontSize: normalizeFontSize(parsed.fontSize),
      fontWeight: normalizeFontWeight(parsed.fontWeight),
      lineSpacing: parsed.lineSpacing ?? DEFAULT_READER_PREFERENCES.lineSpacing,
      paragraphSpacing: parsed.paragraphSpacing ?? DEFAULT_READER_PREFERENCES.paragraphSpacing,
      pageMargins: normalizePageMargins(parsed.pageMargins),
      textAlign: normalizeTextAlign(parsed.textAlign),
      textIndent: normalizeTextIndent(parsed.textIndent),
      typographyMode: normalizeTypographyMode(parsed.typographyMode),
      // Optional until custom mode is first used; junk drops the object, not
      // the surrounding preferences.
      ...(customTypography ? { customTypography } : {}),
      readingMode: normalizeReadingMode(parsed.readingMode) ?? DEFAULT_READER_PREFERENCES.readingMode,
      // Absent in every store written before the split — which is exactly the
      // migration: existing installs' PDFs adopt continuous scroll, and only
      // an explicit later choice writes anything else.
      fixedLayoutReadingMode:
        normalizeReadingMode(parsed.fixedLayoutReadingMode) ?? DEFAULT_READER_PREFERENCES.fixedLayoutReadingMode,
      fixedLayoutColor:
        parsed.fixedLayoutColor === "original" ? "original" : DEFAULT_READER_PREFERENCES.fixedLayoutColor,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(prefs: ReaderSettingsPreferences, origin: DomainActor = "user"): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(prefs), "local", origin);
}

/** Resolve a (possibly `auto`) page color against the resolved app theme. */
export function resolveReaderTheme(theme: ReaderThemePreference, appTheme: "light" | "dark"): ReaderTheme {
  if (theme !== "auto") return theme;
  return appTheme === "dark" ? "dark" : "warm";
}

/** Project stored preferences into render-ready settings for the engine. */
export function toEffectiveReaderSettings(
  prefs: ReaderSettingsPreferences,
  appTheme: "light" | "dark",
): ReaderSettings {
  const { languageFonts: _ignored, ...settings } = prefs;
  return copyEventCause(prefs, { ...settings, theme: resolveReaderTheme(prefs.theme, appTheme) });
}
