import { describe, expect, test } from "bun:test";
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

    expect(visible.domains).toEqual({ library: "1.1.0", settings: "1.3.0" });
    expect(visible.services.network).toBe("1.1.0");
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
});
