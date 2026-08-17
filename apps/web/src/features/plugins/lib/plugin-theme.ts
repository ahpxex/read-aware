/**
 * Theme contributions (`ui:themes`) — validation grammar, ref naming, and the
 * host-side CSS generators.
 *
 * Plugins declare themes/fonts as pure data in their manifest; every string
 * that can reach a stylesheet passes through this module's strict grammars
 * first. That is the security boundary: plugin code runs in a Worker and can
 * never touch the DOM, but a color value interpolated into host CSS crosses
 * back — so colors are matched against closed syntaxes (never sanitized), and
 * paths/ranges against tight character classes. See `sanitizeFamily` in
 * reader-css.ts for the precedent this follows.
 */
import type {
  PluginAppThemeTokens,
  PluginFontContribution,
  PluginFontFile,
  PluginText,
  PluginThemeContribution,
} from "./plugin-types";

// ─── Grammars ────────────────────────────────────────────────────────────────

/**
 * Accepted color syntaxes: hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or
 * rgb()/rgba()/hsl()/hsla() whose body holds only digits, dots, commas,
 * percent, spaces, slashes, and minus — no letters, so `url(`, `var(`, and
 * `expression(` are unrepresentable rather than filtered.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/-]+\)$/;

export function isPluginThemeColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    (HEX_COLOR.test(value) || FUNC_COLOR.test(value))
  );
}

/** Contribution-local ids (theme ids, font ids) share the plugin-id shape. */
const CONTRIBUTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Folder-relative asset path: forward-slash segments of `[A-Za-z0-9._-]`,
 * never starting with a dot — the same positive grammar the Rust installer
 * enforces (`valid_payload_path` in plugins.rs).
 */
const ASSET_PATH_SEGMENT = /^(?!\.)[A-Za-z0-9._-]+$/;
const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"] as const;

function isFontFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  if (!FONT_EXTENSIONS.some((ext) => value.toLowerCase().endsWith(ext))) return false;
  return value.split("/").every((part) => ASSET_PATH_SEGMENT.test(part));
}

/** `unicode-range` values: U+ hex points, ranges, and `?` wildcards only. */
const UNICODE_RANGE = /^[uU]\+[0-9a-fA-F?]{1,6}(?:-[0-9a-fA-F]{1,6})?(?:\s*,\s*[uU]\+[0-9a-fA-F?]{1,6}(?:-[0-9a-fA-F]{1,6})?)*$/;

/** Strip characters that could break out of a `font-family` declaration. */
function sanitizeFamilyName(family: string): string {
  return family.replace(/["\\;{}<>]/g, "").trim();
}

// ─── Refs ────────────────────────────────────────────────────────────────────

/**
 * Stored form of a plugin theme/font selection: `plugin:<pluginId>:<partId>`.
 * The shape (two colons, plugin-id grammar on both sides) is what settings
 * normalizers accept; whether the ref currently RESOLVES is a registry
 * question answered at render time, so a theme survives its plugin being
 * temporarily disabled.
 */
const PLUGIN_REF = /^plugin:[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$/;

/** Build the stored ref for a plugin theme or font. */
export function toPluginRef(pluginId: string, partId: string): `plugin:${string}` {
  return `plugin:${pluginId}:${partId}`;
}

export function isPluginRef(value: unknown): value is `plugin:${string}` {
  return typeof value === "string" && PLUGIN_REF.test(value);
}

/** Split a `plugin:<pluginId>:<partId>` ref; null when the shape is wrong. */
export function parsePluginRef(
  value: string,
): { pluginId: string; partId: string } | null {
  if (!PLUGIN_REF.test(value)) return null;
  const [, pluginId, partId] = value.split(":");
  return { pluginId, partId };
}

/** Find a registered theme/font contribution by its stored ref. */
export function findRegisteredByRef<T extends { pluginId: string; id: string }>(
  ref: string,
  items: readonly T[],
): T | null {
  const parsed = parsePluginRef(ref);
  if (!parsed) return null;
  return (
    items.find(
      (item) => item.pluginId === parsed.pluginId && item.id === parsed.partId,
    ) ?? null
  );
}

// ─── App token vocabulary ────────────────────────────────────────────────────

/**
 * Manifest token name → CSS custom property. The keys are the public
 * vocabulary (documented on `PluginAppThemeTokens`); the values are the app's
 * own semantic tokens from index.css. Extending this map is how the
 * vocabulary grows.
 */
export const APP_THEME_TOKEN_VARS: Record<keyof PluginAppThemeTokens, string> = {
  paper: "--color-paper",
  border: "--color-border",
  fg: "--color-fg",
  fgMuted: "--color-fg-muted",
  fgSubtle: "--color-fg-subtle",
  inverseFg: "--color-inverse-fg",
  surface: "--color-surface",
  fill: "--color-fill",
  fillStrong: "--color-fill-strong",
  borderStrong: "--color-border-strong",
  mainSurface: "--ra-main-surface-color",
  scrollbar: "--ra-scrollbar-color",
};

const APP_THEME_TOKEN_NAMES = Object.keys(APP_THEME_TOKEN_VARS) as (keyof PluginAppThemeTokens)[];

// ─── Manifest validation ─────────────────────────────────────────────────────

const MAX_THEMES = 12;
const MAX_FONTS = 8;
const MAX_FONT_FILES = 512;

const FONT_SIZES = new Set([
  "xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large",
]);
const FONT_WEIGHTS = new Set(["light", "regular", "medium", "bold"]);
const LINE_SPACINGS = new Set(["compact", "comfortable", "relaxed"]);
const PARAGRAPH_SPACINGS = new Set(["tight", "normal", "loose"]);
const READER_PALETTE_KEYS = ["bg", "text", "selection", "rule", "faint", "muted"] as const;

function isPluginTextValue(value: unknown): value is PluginText {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.default !== "string" || record.default.trim() === "") return false;
  if (record.translations == null) return true;
  if (typeof record.translations !== "object" || Array.isArray(record.translations)) {
    return false;
  }
  return Object.values(record.translations).every((entry) => typeof entry === "string");
}

/**
 * Validate `manifest.fonts`. Throws a plain `Error` with a readable message;
 * the manifest gate wraps it into a `PluginManifestError`.
 */
export function validateFontContributions(raw: unknown): PluginFontContribution[] {
  if (!Array.isArray(raw)) throw new Error("manifest.fonts must be an array");
  if (raw.length > MAX_FONTS) {
    throw new Error(`manifest.fonts allows at most ${MAX_FONTS} fonts`);
  }
  const seen = new Set<string>();
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("manifest.fonts entries must be objects");
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !CONTRIBUTION_ID.test(id)) {
      throw new Error("font ids must be lowercase letters, digits, and hyphens");
    }
    if (seen.has(id)) throw new Error(`duplicate font id "${id}"`);
    seen.add(id);
    const family =
      typeof record.family === "string" ? sanitizeFamilyName(record.family) : "";
    if (!family) throw new Error(`font "${id}" needs a non-empty family name`);
    const kind = record.kind ?? "serif";
    if (kind !== "sans" && kind !== "serif" && kind !== "cjk") {
      throw new Error(`font "${id}" kind must be "sans", "serif", or "cjk"`);
    }
    if (!Array.isArray(record.files) || record.files.length === 0) {
      throw new Error(`font "${id}" needs at least one file`);
    }
    if (record.files.length > MAX_FONT_FILES) {
      throw new Error(`font "${id}" allows at most ${MAX_FONT_FILES} files`);
    }
    const files: PluginFontFile[] = record.files.map((file) => {
      if (typeof file !== "object" || file === null) {
        throw new Error(`font "${id}" files must be objects`);
      }
      const f = file as Record<string, unknown>;
      if (!isFontFilePath(f.path)) {
        throw new Error(
          `font "${id}" file paths must be plain relative paths ending in ${FONT_EXTENSIONS.join("/")}`,
        );
      }
      if (
        f.weight != null &&
        (typeof f.weight !== "number" || !Number.isInteger(f.weight) || f.weight < 1 || f.weight > 1000)
      ) {
        throw new Error(`font "${id}" file weights must be integers between 1 and 1000`);
      }
      if (f.style != null && f.style !== "normal" && f.style !== "italic") {
        throw new Error(`font "${id}" file styles must be "normal" or "italic"`);
      }
      if (f.unicodeRange != null &&
        (typeof f.unicodeRange !== "string" || !UNICODE_RANGE.test(f.unicodeRange.trim()))
      ) {
        throw new Error(`font "${id}" has an invalid unicode-range`);
      }
      return {
        path: f.path as string,
        weight: f.weight as number | undefined,
        style: f.style as "normal" | "italic" | undefined,
        unicodeRange: (f.unicodeRange as string | undefined)?.trim(),
      };
    });
    return { id, family, kind, files };
  });
}

/**
 * Validate `manifest.themes`. `fontIds` are the same manifest's declared font
 * ids, so a typography default may reference its own fonts as
 * `plugin:<fontId>`.
 */
export function validateThemeContributions(
  raw: unknown,
  fontIds: ReadonlySet<string>,
): PluginThemeContribution[] {
  if (!Array.isArray(raw)) throw new Error("manifest.themes must be an array");
  if (raw.length > MAX_THEMES) {
    throw new Error(`manifest.themes allows at most ${MAX_THEMES} themes`);
  }
  const seen = new Set<string>();
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("manifest.themes entries must be objects");
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !CONTRIBUTION_ID.test(id)) {
      throw new Error("theme ids must be lowercase letters, digits, and hyphens");
    }
    if (seen.has(id)) throw new Error(`duplicate theme id "${id}"`);
    seen.add(id);
    if (!isPluginTextValue(record.name)) {
      throw new Error(`theme "${id}" needs a name (string or localized text)`);
    }
    if (record.polarity !== "light" && record.polarity !== "dark") {
      throw new Error(`theme "${id}" polarity must be "light" or "dark"`);
    }
    if (record.app == null && record.reader == null) {
      throw new Error(`theme "${id}" must declare an app part, a reader part, or both`);
    }

    let app: PluginAppThemeTokens | undefined;
    if (record.app != null) {
      if (typeof record.app !== "object" || Array.isArray(record.app)) {
        throw new Error(`theme "${id}" app tokens must be an object`);
      }
      app = {};
      for (const [token, value] of Object.entries(record.app)) {
        if (!APP_THEME_TOKEN_NAMES.includes(token as keyof PluginAppThemeTokens)) {
          throw new Error(
            `theme "${id}" has unknown app token "${token}" (valid: ${APP_THEME_TOKEN_NAMES.join(", ")})`,
          );
        }
        if (!isPluginThemeColor(value)) {
          throw new Error(`theme "${id}" app token "${token}" is not a valid color`);
        }
        app[token as keyof PluginAppThemeTokens] = value;
      }
      if (Object.keys(app).length === 0) {
        throw new Error(`theme "${id}" app part must set at least one token`);
      }
    }

    let reader: PluginThemeContribution["reader"];
    if (record.reader != null) {
      if (typeof record.reader !== "object" || Array.isArray(record.reader)) {
        throw new Error(`theme "${id}" reader part must be an object`);
      }
      const readerRecord = record.reader as Record<string, unknown>;
      const palette = readerRecord.palette;
      if (typeof palette !== "object" || palette === null || Array.isArray(palette)) {
        throw new Error(`theme "${id}" reader part needs a palette`);
      }
      const paletteRecord = palette as Record<string, unknown>;
      for (const key of READER_PALETTE_KEYS) {
        if (!isPluginThemeColor(paletteRecord[key])) {
          throw new Error(`theme "${id}" reader palette "${key}" is not a valid color`);
        }
      }
      const extraKey = Object.keys(paletteRecord).find(
        (key) => !(READER_PALETTE_KEYS as readonly string[]).includes(key),
      );
      if (extraKey) {
        throw new Error(`theme "${id}" reader palette has unknown key "${extraKey}"`);
      }

      let typography: NonNullable<PluginThemeContribution["reader"]>["typography"];
      if (readerRecord.typography != null) {
        if (typeof readerRecord.typography !== "object" || Array.isArray(readerRecord.typography)) {
          throw new Error(`theme "${id}" typography must be an object`);
        }
        const t = readerRecord.typography as Record<string, unknown>;
        typography = {};
        if (t.fontFamily != null) {
          if (typeof t.fontFamily !== "string" || !isThemeFontFamily(t.fontFamily, fontIds)) {
            throw new Error(
              `theme "${id}" typography fontFamily must be "plugin:<declared fontId>", "curated:<id>", or "system:<family>"`,
            );
          }
          typography.fontFamily = t.fontFamily;
        }
        if (t.fontSize != null) {
          if (!FONT_SIZES.has(String(t.fontSize))) {
            throw new Error(`theme "${id}" typography fontSize is invalid`);
          }
          typography.fontSize = t.fontSize as NonNullable<typeof typography>["fontSize"];
        }
        if (t.fontWeight != null) {
          if (!FONT_WEIGHTS.has(String(t.fontWeight))) {
            throw new Error(`theme "${id}" typography fontWeight is invalid`);
          }
          typography.fontWeight = t.fontWeight as NonNullable<typeof typography>["fontWeight"];
        }
        if (t.lineSpacing != null) {
          if (!LINE_SPACINGS.has(String(t.lineSpacing))) {
            throw new Error(`theme "${id}" typography lineSpacing is invalid`);
          }
          typography.lineSpacing = t.lineSpacing as NonNullable<typeof typography>["lineSpacing"];
        }
        if (t.paragraphSpacing != null) {
          if (!PARAGRAPH_SPACINGS.has(String(t.paragraphSpacing))) {
            throw new Error(`theme "${id}" typography paragraphSpacing is invalid`);
          }
          typography.paragraphSpacing =
            t.paragraphSpacing as NonNullable<typeof typography>["paragraphSpacing"];
        }
      }
      reader = {
        palette: {
          bg: paletteRecord.bg as string,
          text: paletteRecord.text as string,
          selection: paletteRecord.selection as string,
          rule: paletteRecord.rule as string,
          faint: paletteRecord.faint as string,
          muted: paletteRecord.muted as string,
        },
        typography,
      };
    }

    return {
      id,
      name: record.name as PluginText,
      polarity: record.polarity as "light" | "dark",
      app,
      reader,
    };
  });
}

/**
 * A typography fontFamily in a manifest: the plugin's own font
 * (`plugin:<fontId>`, single colon — expanded to the full stored ref at
 * registration), a curated host font, or a system family.
 */
function isThemeFontFamily(value: string, fontIds: ReadonlySet<string>): boolean {
  if (value.startsWith("plugin:")) {
    const fontId = value.slice("plugin:".length);
    return CONTRIBUTION_ID.test(fontId) && fontIds.has(fontId);
  }
  if (value.startsWith("curated:")) return value.length > "curated:".length;
  if (value.startsWith("system:")) {
    return sanitizeFamilyName(value.slice("system:".length)).length > 0;
  }
  return false;
}

// ─── CSS generation (host-side; inputs already validated) ────────────────────

/**
 * The app-skin rule for one theme, keyed off the `data-skin` attribute that
 * `useAppearance` stamps next to the polarity `data-theme`. The double
 * attribute selector outranks the base light/dark token blocks regardless of
 * source order, and re-pointing `background-color`/`color` at the tokens
 * neutralizes the literal colors those blocks set.
 */
export function buildAppSkinCss(ref: string, tokens: PluginAppThemeTokens): string {
  const declarations = Object.entries(tokens)
    .filter(([token]) => token in APP_THEME_TOKEN_VARS)
    .map(([token, value]) => `  ${APP_THEME_TOKEN_VARS[token as keyof PluginAppThemeTokens]}: ${value};`)
    .join("\n");
  return `html[data-theme][data-skin="${ref}"] {
${declarations}
  background-color: var(--color-paper);
  color: var(--color-fg);
}
html[data-theme][data-skin="${ref}"] body {
  background-color: var(--color-paper);
}`;
}

/**
 * `@font-face` rules for one plugin font, served straight from the plugin
 * folder over `raplugin://` (allowed by the desktop CSP's font-src). The same
 * string is injected into the app document (picker/preview) and the reader
 * section iframes (via `buildReaderContentCss`'s fontFaceCss slot).
 */
export function buildPluginFontFaceCss(
  font: { family: string; files: PluginFontFile[] },
  assetUrl: (path: string) => string,
): string {
  const family = sanitizeFamilyName(font.family);
  if (!family) return "";
  return font.files
    .map((file) => {
      const format = fontFormat(file.path);
      const range = file.unicodeRange ? `unicode-range:${file.unicodeRange};` : "";
      return (
        `@font-face{font-family:"${family}";` +
        `font-style:${file.style ?? "normal"};` +
        `font-weight:${file.weight ?? 400};` +
        `font-display:swap;` +
        `src:url(${assetUrl(file.path)}) format("${format}");${range}}`
      );
    })
    .join("\n");
}

function fontFormat(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".woff2")) return "woff2";
  if (lower.endsWith(".woff")) return "woff";
  if (lower.endsWith(".otf")) return "opentype";
  return "truetype";
}
