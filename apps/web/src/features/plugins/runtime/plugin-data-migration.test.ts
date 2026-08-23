import { describe, expect, test } from "bun:test";
import { planPluginDataMigration } from "./plugin-data-migration";

describe("plugin data migration protocol", () => {
  test("plans upgrades and downgrades explicitly", () => {
    expect(
      planPluginDataMigration({ storedVersion: 2, targetVersion: 4, hasMigration: true }),
    ).toEqual({ fromVersion: 2, toVersion: 4, direction: "upgrade" });
    expect(
      planPluginDataMigration({ storedVersion: 4, targetVersion: 2, hasMigration: true }),
    ).toEqual({ fromVersion: 4, toVersion: 2, direction: "downgrade" });
  });

  test("requires migration after the host has committed a schema", () => {
    expect(() =>
      planPluginDataMigration({ storedVersion: 1, targetVersion: 2, hasMigration: false }),
    ).toThrow("migrate() is missing");
  });

  test("adopts a first recorded schema as the baseline", () => {
    expect(
      planPluginDataMigration({ storedVersion: null, targetVersion: 3, hasMigration: false }),
    ).toBeNull();
  });
});
