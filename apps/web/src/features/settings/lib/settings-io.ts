/**
 * Export / import / reset for all locally-persisted ReadAware settings.
 *
 * These keys are the full surface of the device-local settings/prefs layer,
 * reached through `localKV` (SQLite on desktop, localStorage in the browser).
 * Keep this list in sync as new settings stores are added.
 */
import { localKV } from "../../../platform/local-store";

const SETTINGS_KEYS = [
  "read-aware-reader-settings",
  "read-aware-reader-overrides",
  "read-aware-reader-panels",
  "read-aware-reader-panel-sizes",
  "read-aware-app-settings",
  "read-aware-general-settings",
  "read-aware-ai-preferences",
  "read-aware-ai-config",
  "read-aware-shelf-view",
  "read-aware-shortcuts",
  "read-aware-default-mark-color",
] as const;

export const SETTINGS_EXPORT_VERSION = 1;

type SettingsExport = {
  app: "read-aware";
  kind: "settings";
  version: number;
  data: Record<string, unknown>;
};

/** Serialize all present settings keys into a portable JSON string. */
export function serializeSettings(): string {
  const data: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    const raw = localKV.getItem(key);
    if (raw == null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  const payload: SettingsExport = {
    app: "read-aware",
    kind: "settings",
    version: SETTINGS_EXPORT_VERSION,
    data,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Apply a previously-exported settings JSON string. Only known keys are
 * written; unknown keys are ignored. Returns the count of applied keys.
 */
export function applySettings(json: string): number {
  const parsed = JSON.parse(json) as Partial<SettingsExport>;
  if (!parsed || parsed.kind !== "settings" || typeof parsed.data !== "object") {
    throw new Error("This file is not a ReadAware settings export.");
  }
  let applied = 0;
  for (const key of SETTINGS_KEYS) {
    if (!(key in parsed.data)) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    localKV.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    applied += 1;
  }
  return applied;
}

/** Remove every locally-persisted settings key. */
export function resetAllSettings(): void {
  for (const key of SETTINGS_KEYS) {
    localKV.removeItem(key);
  }
}
