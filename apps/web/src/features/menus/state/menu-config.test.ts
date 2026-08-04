import { describe, expect, test } from "bun:test";
import { CORE_MENU_DEFAULTS, resolveSurfaceLayout } from "./menu-config";

describe("shelf menu placement", () => {
  test("drops the former context item now that Agent is primary navigation", () => {
    const layout = resolveSurfaceLayout(
      {
        visible: ["core:search", "core:context", "core:settings"],
        overflow: [],
      },
      CORE_MENU_DEFAULTS.shelfHeader,
    );

    expect(layout.visible).not.toContain("core:context");
    expect(layout.overflow).not.toContain("core:context");
  });
});

describe("selection menu contribution placement", () => {
  const known = ["core:copy", "plugin:dictionary:lookup-save"];
  const defaults = { defaultVisibleIds: ["plugin:dictionary:lookup-save"] };

  test("drops the retired core lookup and promotes the plugin role once", () => {
    expect(
      resolveSurfaceLayout(
        {
          visible: ["core:copy", "core:lookUp"],
          overflow: [],
        },
        known,
        defaults,
      ),
    ).toEqual({
      visible: ["core:copy", "plugin:dictionary:lookup-save"],
      overflow: [],
    });
  });

  test("keeps an explicit user placement in overflow", () => {
    expect(
      resolveSurfaceLayout(
        {
          visible: ["core:copy"],
          overflow: ["plugin:dictionary:lookup-save"],
        },
        known,
        defaults,
      ),
    ).toEqual({
      visible: ["core:copy"],
      overflow: ["plugin:dictionary:lookup-save"],
    });
  });
});
