import { describe, expect, test } from "bun:test";
import { DOMAIN_CATALOG } from "@read-aware/core";
import type { PluginManifest } from "../lib/plugin-types";
import {
  assertPluginCapabilityRequirements,
  resolvePluginCapabilities,
} from "./plugin-capabilities";

function manifest(patch: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    schemaVersion: 1,
    requires: {},
    ...patch,
  };
}

describe("plugin capability negotiation", () => {
  test("annotation 2 requires conditional edits and rejects clients expecting legacy aliases", () => {
    for (const permission of ["annotations:read", "annotations:write"] as const) {
      expect(resolvePluginCapabilities(manifest({ permissions: [permission] })).domains.annotations).toBe("2.0.0");
      expect(() => assertPluginCapabilityRequirements(manifest({ permissions: [permission], requires: { domains: { annotations: "^1.4.0" } } }))).toThrow(/host provides 2.0.0/);
      expect(() => assertPluginCapabilityRequirements(manifest({ permissions: [permission], requires: { domains: { annotations: "^2.0.0" } } }))).not.toThrow();
    }
  });
  test("metadata service does not grant reading access and legacy event contracts are rejected", () => {
    const empty = manifest({ permissions: [] });
    expect(resolvePluginCapabilities(empty).services.session).toBe("2.0.0");
    expect(resolvePluginCapabilities(empty).domains.reading).toBeUndefined();
    expect(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { session: "^1.0.0" } } }))).toThrow(/host provides 2.0.0/);
    expect(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { session: "^2.0.0" } } }))).not.toThrow();
    expect(() => assertPluginCapabilityRequirements(manifest({ requires: { domains: { reading: "^2.0.0" } } }))).toThrow(/unavailable capability domains.reading/);
    expect(() => assertPluginCapabilityRequirements(manifest({ permissions: ["reading:read"], requires: { domains: { reading: "^2.0.0" } } }))).not.toThrow();
  });
  test("publishes only the actor-visible capability versions", () => {
    const visible = resolvePluginCapabilities(
      manifest({ permissions: ["library:read", "service:network", "ui:themes"] }),
    );

    expect(visible.domains).toEqual({ library: DOMAIN_CATALOG.library.version, settings: DOMAIN_CATALOG.settings.version });
    expect(visible.services.network).toBe("2.0.0");
    expect(visible.services.llm).toBeUndefined();
    expect(visible.contributions.themes).toBe("1.0.0");
    expect(visible.contributions.agentTools).toBeUndefined();
    expect(visible.schemas.themes).toBe("1.0.0");
  });

  test("rejects requirements outside the plugin actor's grants", () => {
    expect(() =>
      assertPluginCapabilityRequirements(
        manifest({ requires: { services: { network: "^1.0.0" } } }),
      ),
    ).toThrow(/unavailable capability services.network/);
  });

  test("network scopes require an explicit migration from the broad 1.x contract", () => {
    expect(() => assertPluginCapabilityRequirements(manifest({ permissions: ["service:network"], requires: { services: { network: "^1.1.0" } } }))).toThrow(/host provides 2.0.0/);
    expect(() => assertPluginCapabilityRequirements(manifest({ permissions: ["service:network"], requires: { services: { network: "^2.0.0" } } }))).not.toThrow();
  });

  test("rejects an incompatible host capability version", () => {
    expect(() =>
      assertPluginCapabilityRequirements(
        manifest({ requires: { services: { storage: "^1.0.0" } } }),
      ),
    ).toThrow(/host provides 2.0.0/);
  });

  test("accepts the awaited storage contract", () => {
    expect(() => assertPluginCapabilityRequirements(manifest({ requires: { services: { storage: "^2.0.0" } } }))).not.toThrow();
  });

  test("negotiates paged table, tree and image declarations without adding data permissions", () => {
    for (const version of ["^1.5.0", "^1.6.0", "^1.7.0"]) {
      const request = manifest({ requires: { schemas: { views: version } } });
      expect(() => assertPluginCapabilityRequirements(request)).not.toThrow();
      const visible = resolvePluginCapabilities(request);
      expect(visible.schemas.views).toBe("1.7.0");
      expect(visible.domains.library).toBeUndefined();
      expect(visible.domains.reading).toBeUndefined();
    }
  });
});
