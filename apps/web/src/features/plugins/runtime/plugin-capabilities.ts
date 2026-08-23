import {
  CONTRIBUTION_CATALOG,
  DECLARATIVE_SCHEMA_CATALOG,
  DOMAIN_CATALOG,
  HOST_SERVICE_CATALOG,
  canUseContribution,
  canUseHostService,
  domainGrantsFromPermissions,
} from "@read-aware/core";
import { satisfies } from "semver";
import type { PluginCapabilityView, PluginManifest } from "../lib/plugin-types";

export function resolvePluginCapabilities(manifest: PluginManifest): PluginCapabilityView {
  const permissions = new Set(manifest.permissions ?? []);
  const grants = domainGrantsFromPermissions(manifest.permissions ?? []);
  const domains: PluginCapabilityView["domains"] = {
    settings: DOMAIN_CATALOG.settings.version,
  };
  for (const id of Object.keys(grants) as Array<keyof typeof DOMAIN_CATALOG>) {
    domains[id] = DOMAIN_CATALOG[id].version;
  }

  const contributions: PluginCapabilityView["contributions"] = {};
  for (const id of Object.keys(CONTRIBUTION_CATALOG) as Array<
    keyof typeof CONTRIBUTION_CATALOG
  >) {
    if (canUseContribution(id, permissions)) {
      contributions[id] = CONTRIBUTION_CATALOG[id].version;
    }
  }

  const services: PluginCapabilityView["services"] = {};
  for (const id of Object.keys(HOST_SERVICE_CATALOG) as Array<
    keyof typeof HOST_SERVICE_CATALOG
  >) {
    if (canUseHostService(id, permissions)) {
      services[id] = HOST_SERVICE_CATALOG[id].version;
    }
  }

  return {
    domains,
    contributions,
    services,
    schemas: {
      views: DECLARATIVE_SCHEMA_CATALOG.views.version,
      settings: DECLARATIVE_SCHEMA_CATALOG.settings.version,
      ...(permissions.has("ui:themes")
        ? { themes: DECLARATIVE_SCHEMA_CATALOG.themes.version }
        : {}),
    },
  };
}

export function assertPluginCapabilityRequirements(manifest: PluginManifest): void {
  const available = resolvePluginCapabilities(manifest);
  for (const family of Object.keys(manifest.requires) as Array<keyof typeof manifest.requires>) {
    const requirements = manifest.requires[family] ?? {};
    const versions = available[family] as Record<string, string | undefined>;
    for (const [id, range] of Object.entries(requirements)) {
      const version = versions[id];
      if (!version) {
        throw new Error(
          `requires unavailable capability ${family}.${id} ${String(range)} (check permissions)`,
        );
      }
      if (!satisfies(version, String(range), { includePrerelease: true })) {
        throw new Error(
          `requires ${family}.${id} ${String(range)}, but the host provides ${version}`,
        );
      }
    }
  }
}
