import { describe, expect, test } from "bun:test";
import { createContributionRegistry } from "./contribution-registry";

describe("contribution registry", () => {
  test("refreshing immutable contribution data retains its original disposal owner", () => {
    const registry = createContributionRegistry<{ key: string; pluginId: string; value: number }>("voiceProviders", { catalog: false });
    const registration = registry.register({ key: "voice:main", pluginId: "voice", value: 0 });
    registry.update("voice:main", entry => ({ ...entry, value: 1 }));
    registry.update("voice:main", entry => ({ ...entry, value: 2 }));
    registration.dispose(); registration.dispose();
    expect(registry.list()).toEqual([]);
  });

  test("old disposal never removes a replacement even after both entries were refreshed", () => {
    const registry = createContributionRegistry<{ key: string; pluginId: string; value: number }>("voiceProviders", { catalog: false });
    const old = registry.register({ key: "voice:main", pluginId: "voice", value: 0 });
    registry.update("voice:main", entry => ({ ...entry, value: 1 }));
    const current = registry.register({ key: "voice:main", pluginId: "voice", value: 2 });
    registry.update("voice:main", entry => ({ ...entry, value: 3 }));
    old.dispose();
    expect(registry.list()[0]?.value).toBe(3);
    current.dispose();
    expect(registry.list()).toEqual([]);
  });

  test("an update cannot change the key or declaring plugin", () => {
    const registry = createContributionRegistry("voiceProviders", { catalog: false });
    const registration = registry.register({ key: "voice:main", pluginId: "voice" });
    expect(() => registry.update("voice:main", entry => ({ ...entry, key: "voice:other" }))).toThrow("cannot transfer");
    expect(() => registry.update("voice:main", entry => ({ ...entry, pluginId: "other" }))).toThrow("cannot transfer");
    expect(registry.list()).toEqual([{ key: "voice:main", pluginId: "voice" }]);
    registration.dispose();
    expect(registry.list()).toEqual([]);
  });
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
