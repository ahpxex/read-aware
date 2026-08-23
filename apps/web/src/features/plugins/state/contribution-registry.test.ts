import { describe, expect, test } from "bun:test";
import { createContributionRegistry } from "./contribution-registry";

describe("contribution registry", () => {
  test("a stale disposable cannot remove a replacement with the same key", () => {
    const registry = createContributionRegistry<{
      key: string;
      pluginId: string;
      value: number;
    }>("commands", { catalog: false });
    const stale = registry.register({ key: "test:item", pluginId: "test", value: 1 });
    registry.register({ key: "test:item", pluginId: "test", value: 2 });

    stale.dispose();

    expect(registry.list()).toEqual([
      { key: "test:item", pluginId: "test", value: 2 },
    ]);
  });

  test("rejects keys outside the declaring plugin namespace", () => {
    const registry = createContributionRegistry("agentTools", { catalog: false });
    expect(() =>
      registry.register({ key: "other:item", pluginId: "test" }),
    ).toThrow(/owned by plugin/);
  });
});
