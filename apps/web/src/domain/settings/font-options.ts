import type { SettingOption, SettingValue } from "@read-aware/core";
import { CURATED_FONTS, getCuratedFont } from "../../features/settings/lib/curated-font-catalog";
import { findRegisteredByRef, toPluginRef } from "../../features/plugins/lib/plugin-theme";
import type { ReaderFontFamily } from "../../features/settings/lib/reader-settings";
import type { UserFontEntry } from "../fonts";
import type { SettingsDraft } from "./catalog";

function option(value: SettingValue, label: string): SettingOption {
  return { value, label };
}

export function fontOptions(draft: SettingsDraft): SettingOption[] {
  return [
    ...CURATED_FONTS.map((font) => option(`curated:${font.id}`, font.label)),
    ...draft.pluginFonts.map((font) => ({
      value: toPluginRef(font.pluginId, font.id),
      label: font.family,
      source: "plugin" as const,
      pluginName: font.pluginName,
    })),
  ];
}

export function isFontSetting(path: string): boolean {
  return path === "reading.fontFamily" || path === "appearance.contentTypography.fontFamily";
}

export function systemFontOptions(families: readonly string[]): SettingOption[] {
  return families.map((family) => ({ value: `system:${family}`, label: family, source: "system" }));
}

/** Imported font files — the user's own fonts, labeled by their parsed family. */
export function userFontOptions(fonts: readonly UserFontEntry[]): SettingOption[] {
  return fonts.map((font) => ({ value: `user:${font.id}`, label: font.name, source: "user" }));
}

export function cleanFontFamily(
  value: SettingValue,
  draft: SettingsDraft,
  path = "reading.fontFamily",
): ReaderFontFamily {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
  const font = value.trim();
  if (font.startsWith("curated:") && getCuratedFont(font.slice("curated:".length))) {
    return font as `curated:${string}`;
  }
  if (font.startsWith("plugin:")) {
    const registered = findRegisteredByRef(font, draft.pluginFonts);
    if (registered) return font as `plugin:${string}`;
    throw new Error(`unknown plugin font: ${font}`);
  }
  if (font.startsWith("system:")) {
    const family = font.slice("system:".length).trim();
    if (family && family.length <= 120 && !/[\u0000-\u001f\u007f]/.test(family)) {
      return `system:${family}`;
    }
  }
  // Imported fonts key by content hash — the registry may not hold the row on
  // this device yet (a preference written on another device and roamed), and
  // the ref stays meaningful either way.
  if (/^user:[0-9a-f]{64}$/.test(font)) {
    return font as `user:${string}`;
  }
  throw new Error(`${path} must be a catalog option or a non-empty system:<family> value`);
}
