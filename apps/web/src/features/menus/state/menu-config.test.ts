import { describe, expect, test } from "bun:test";
import {
  clampPrimaryNavVisible,
  CORE_MENU_DEFAULTS,
  resolveSurfaceLayout,
} from "./menu-config";

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

describe("primary navigation guards", () => {
  test("an emptied visible list falls back to the defaults", () => {
    expect(clampPrimaryNavVisible([])).toEqual(CORE_MENU_DEFAULTS.primaryNav);
  });

  test("visible destinations are capped", () => {
    const visible = ["core:library", "core:agent", "core:stats", "plugin:a", "plugin:b"];
    expect(clampPrimaryNavVisible(visible)).toEqual(visible.slice(0, 4));
  });

  test("stats stays out of the switcher for configs that predate primaryNav", () => {
    const layout = resolveSurfaceLayout(
      { visible: [...CORE_MENU_DEFAULTS.primaryNav], overflow: ["core:stats"] },
      ["core:library", "core:agent", "core:stats", "plugin:reader:feed"],
    );
    expect(layout.visible).toEqual(["core:library", "core:agent"]);
    expect(layout.overflow).toEqual(["core:stats", "plugin:reader:feed"]);
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
