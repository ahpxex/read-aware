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
    requires: {},
    ...patch,
  };
}

describe("plugin capability negotiation", () => {
  test("publishes only the actor-visible capability versions", () => {
    const visible = resolvePluginCapabilities(
      manifest({ permissions: ["library:read", "service:network", "ui:themes"] }),
    );

    expect(visible.domains).toEqual({ library: "1.0.0", settings: "1.0.0" });
    expect(visible.services.network).toBe("1.0.0");
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
        manifest({ requires: { services: { storage: "^2.0.0" } } }),
      ),
    ).toThrow(/host provides 1.0.0/);
  });
});
