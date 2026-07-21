/**
 * Manifest validation — the single gate between a manifest.json on disk and a
 * typed `PluginManifest`. Pure; throws `PluginManifestError` with a
 * human-readable reason (surfaced in settings and at install time).
 */
import {
  PLUGIN_PERMISSIONS,
  type PluginManifest,
  type PluginPermission,
} from "./plugin-types";

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

  const main = optionalString(record, "main");
  if (main && (main.includes("..") || main.startsWith("/") || main.includes("\\"))) {
    throw new PluginManifestError("manifest.main must be a plain relative file name");
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
