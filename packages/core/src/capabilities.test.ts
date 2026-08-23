import { describe, expect, test } from "bun:test";
import {
  PLUGIN_PERMISSIONS,
  canUseContribution,
  canUseHostService,
  permissionForContribution,
  permissionForHostService,
} from "./capabilities";

describe("plugin capability catalog", () => {
  test("derives one manifest vocabulary from domains, contributions, and services", () => {
    expect(PLUGIN_PERMISSIONS).toEqual([
      "library:read",
      "library:write",
      "reading:read",
      "reading:write",
      "annotations:read",
      "annotations:write",
      "conversations:read",
      "reader:modes",
      "agent:tools",
      "ui:themes",
      "service:network",
      "service:llm",
      "service:clipboard",
    ]);
  });

  test("keeps permission-free and consented capabilities explicit", () => {
    expect(permissionForContribution("commands")).toBeNull();
    expect(permissionForContribution("readerModes")).toBe("reader:modes");
    expect(permissionForHostService("storage")).toBeNull();
    expect(permissionForHostService("network")).toBe("service:network");
  });

  test("uses the catalogs for runtime capability gates", () => {
    const permissions = new Set(["agent:tools", "service:network"]);

    expect(canUseContribution("commands", permissions)).toBe(true);
    expect(canUseContribution("agentTools", permissions)).toBe(true);
    expect(canUseContribution("readerModes", permissions)).toBe(false);
    expect(canUseHostService("storage", permissions)).toBe(true);
    expect(canUseHostService("network", permissions)).toBe(true);
    expect(canUseHostService("llm", permissions)).toBe(false);
  });
});
