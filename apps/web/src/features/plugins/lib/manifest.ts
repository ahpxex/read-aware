/**
 * Manifest validation — the single gate between a manifest.json on disk and a
 * typed `PluginManifest`. Pure; throws `PluginManifestError` with a
 * human-readable reason (surfaced in settings and at install time).
 */
import {
  MIN_SCHEDULE_MINUTES,
  PLUGIN_PERMISSIONS,
  type PluginManifest,
  type PluginPermission,
} from "./plugin-types";
import { validateFontContributions, validateThemeContributions } from "./plugin-theme";

export class PluginManifestError extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Loose semver: "1", "1.2", "1.2.3" (extra labels ignored). */
function parseVersion(value: string): number[] | null {
  const core = value.trim().split(/[-+]/)[0];
  if (!core) return null;
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part) || part < 0)) return null;
  return parts;
}

/** True when `version` >= `minimum` under lenient semver comparison. */
export function versionSatisfies(version: string, minimum: string): boolean {
  const current = parseVersion(version);
  const min = parseVersion(minimum);
  // Unparseable inputs never block activation — the check is advisory.
  if (!current || !min) return true;
  for (let i = 0; i < Math.max(current.length, min.length); i += 1) {
    const a = current[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function requireString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PluginManifestError(`manifest.${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new PluginManifestError(`manifest.${field} must be a string`);
  }
  return value.trim() || undefined;
}

export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PluginManifestError("manifest.json must be a JSON object");
  }
  const record = raw as Record<string, unknown>;

  const id = requireString(record, "id");
  if (!ID_PATTERN.test(id)) {
    throw new PluginManifestError(
      "manifest.id must be lowercase letters, digits, and hyphens (max 64 chars)",
    );
  }

  const name = requireString(record, "name");
  const version = requireString(record, "version");
  if (!parseVersion(version)) {
    throw new PluginManifestError(`manifest.version "${version}" is not a version number`);
  }

  let permissions: PluginPermission[] | undefined;
  const rawPermissions = record.permissions;
  if (rawPermissions != null) {
    if (!Array.isArray(rawPermissions)) {
      throw new PluginManifestError("manifest.permissions must be an array");
    }
    for (const permission of rawPermissions) {
      if (!(PLUGIN_PERMISSIONS as readonly unknown[]).includes(permission)) {
        throw new PluginManifestError(
          `unknown permission "${String(permission)}" (valid: ${PLUGIN_PERMISSIONS.join(", ")})`,
        );
      }
    }
    permissions = [...new Set(rawPermissions as PluginPermission[])];
  }

  let settings: PluginManifest["settings"];
  if (record.settings != null) {
    if (!Array.isArray(record.settings)) {
      throw new PluginManifestError("manifest.settings must be an array of fields");
    }
    const kinds = new Set([
      "text",
      "textarea",
      "number",
      "select",
      "toggle",
      "checkbox",
      "choice",
      "secret",
    ]);
    // A secret field's id doubles as its ctx.secrets key.
    const SECRET_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    // Field copy is PluginText: a plain string or a localized bundle.
    const validText = (value: unknown): boolean =>
      (typeof value === "string" && value.trim() !== "") ||
      (typeof value === "object" &&
        value !== null &&
        typeof (value as { default?: unknown }).default === "string" &&
        ((value as { default: string }).default.trim() !== ""));
    for (const field of record.settings as Record<string, unknown>[]) {
      if (
        typeof field !== "object" || field === null ||
        !kinds.has(String(field.kind)) ||
        typeof field.id !== "string" || field.id.trim() === "" ||
        !validText(field.label)
      ) {
        throw new PluginManifestError(
          "manifest.settings entries need a valid kind, id, and label",
        );
      }
      if (field.kind === "secret" && !SECRET_ID.test(String(field.id))) {
        throw new PluginManifestError(
          "manifest.settings secret ids must be lowercase letters, digits, _ or - (max 64 chars)",
        );
      }
      // A dynamic select gets its options at runtime (ctx.settings
      // .provideOptions); the declaration may then omit the static list.
      const dynamicSelect = field.kind === "select" && field.dynamicOptions === true;
      if (dynamicSelect && !Array.isArray(field.options)) field.options = [];
      if ((field.kind === "select" || field.kind === "choice") && !Array.isArray(field.options)) {
        throw new PluginManifestError(`manifest.settings ${field.kind} fields need options`);
      }
      if (field.visibleWhen != null) {
        const condition = field.visibleWhen as Record<string, unknown>;
        const equals = condition?.equals;
        const validEquals =
          typeof equals === "string" ||
          (Array.isArray(equals) &&
            equals.length > 0 &&
            equals.every((value) => typeof value === "string"));
        if (
          typeof condition !== "object" || condition === null ||
          typeof condition.field !== "string" || condition.field.trim() === "" ||
          !validEquals
        ) {
          throw new PluginManifestError(
            "manifest.settings visibleWhen needs { field, equals: string | string[] }",
          );
        }
      }
    }
    settings = record.settings as PluginManifest["settings"];
  }

  let schedules: PluginManifest["schedules"];
  if (record.schedules != null) {
    if (!Array.isArray(record.schedules)) {
      throw new PluginManifestError("manifest.schedules must be an array");
    }
    const seen = new Set<string>();
    for (const entry of record.schedules as Record<string, unknown>[]) {
      if (
        typeof entry !== "object" || entry === null ||
        typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id) ||
        typeof entry.label !== "string" || entry.label.trim() === "" ||
        typeof entry.everyMinutes !== "number" ||
        !Number.isFinite(entry.everyMinutes)
      ) {
        throw new PluginManifestError(
          "manifest.schedules entries need an id (lowercase/digits/hyphens), a label, and everyMinutes",
        );
      }
      if (entry.everyMinutes < MIN_SCHEDULE_MINUTES) {
        throw new PluginManifestError(
          `manifest.schedules cadence floor is ${MIN_SCHEDULE_MINUTES} minutes`,
        );
      }
      if (seen.has(entry.id)) {
        throw new PluginManifestError(`duplicate schedule id "${entry.id}"`);
      }
      seen.add(entry.id);
    }
    schedules = record.schedules as PluginManifest["schedules"];
  }

  const main = optionalString(record, "main");
  if (main && (main.includes("..") || main.startsWith("/") || main.includes("\\"))) {
    throw new PluginManifestError("manifest.main must be a plain relative file name");
  }

  // Themes and bundled fonts are the one UI contribution with visual
  // authority, so they sit behind `ui:themes` — the consent dialog must have
  // surfaced it before these declarations may exist.
  let themes: PluginManifest["themes"];
  let fonts: PluginManifest["fonts"];
  if (record.themes != null || record.fonts != null) {
    if (!permissions?.includes("ui:themes")) {
      throw new PluginManifestError(
        'manifest.themes/manifest.fonts require the "ui:themes" permission',
      );
    }
    try {
      fonts = record.fonts != null ? validateFontContributions(record.fonts) : undefined;
      themes =
        record.themes != null
          ? validateThemeContributions(
              record.themes,
              new Set(fonts?.map((font) => font.id) ?? []),
            )
          : undefined;
    } catch (error) {
      throw new PluginManifestError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    id,
    name,
    version,
    description: optionalString(record, "description"),
    author: optionalString(record, "author"),
    minAppVersion: optionalString(record, "minAppVersion"),
    permissions,
    main,
    settings,
    schedules,
    themes,
    fonts,
  };
}

export function parseManifestJson(text: string): PluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PluginManifestError("manifest.json is not valid JSON");
  }
  return validateManifest(parsed);
}
