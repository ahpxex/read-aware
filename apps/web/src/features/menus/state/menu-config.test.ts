import { describe, expect, test } from "bun:test";
import {
  clampPrimaryNavVisible,
  CORE_MENU_DEFAULTS,
  CORE_OVERFLOW_DEFAULTS,
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

  test("a built-in that starts in overflow joins a saved layout there, not in the header", () => {
    // A layout saved before folder import existed.
    const saved = { visible: ["core:search", "core:import", "core:settings"], overflow: ["core:stats"] };
    const known = [...CORE_MENU_DEFAULTS.shelfHeader, ...CORE_OVERFLOW_DEFAULTS.shelfHeader];
    const layout = resolveSurfaceLayout(saved, known, { defaultOverflowIds: CORE_OVERFLOW_DEFAULTS.shelfHeader });
    expect(layout.visible).toEqual(["core:search", "core:import", "core:settings", "core:viewControl"]);
    expect(layout.overflow).toEqual(["core:stats", "core:importFolder"]);
    // Once the user places it, their choice stands.
    const promoted = resolveSurfaceLayout(
      { visible: [...saved.visible, "core:importFolder"], overflow: ["core:stats"] },
      known,
      { defaultOverflowIds: CORE_OVERFLOW_DEFAULTS.shelfHeader },
    );
    expect(promoted.visible).toContain("core:importFolder");
    expect(promoted.overflow).not.toContain("core:importFolder");
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
    const layout = resolveSurfaceLayout({ visible: [...CORE_MENU_DEFAULTS.primaryNav], overflow: ["core:stats"] }, [
      "core:library",
      "core:agent",
      "core:stats",
      "plugin:reader:feed",
    ]);
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

describe("phone reader toolbar", () => {
  test("arranges contents and notes itself, unlike the desktop header's fixed left cluster", () => {
    expect(CORE_MENU_DEFAULTS.readerToolbar).toEqual(expect.arrayContaining(["core:toc", "core:notes"]));
    expect(CORE_MENU_DEFAULTS.readerHeader).not.toContain("core:toc");
    expect(CORE_MENU_DEFAULTS.readerHeader).not.toContain("core:notes");
  });

  test("keeps notes where the user tucked it and sends new plugin actions to overflow", () => {
    const layout = resolveSurfaceLayout({ visible: ["core:toc", "core:chat"], overflow: ["core:notes"] }, [
      ...CORE_MENU_DEFAULTS.readerToolbar,
      "plugin:tts:speak",
    ]);
    expect(layout.visible).toEqual(["core:toc", "core:chat", "core:find", "core:navigator", "core:appearance"]);
    expect(layout.overflow).toEqual(["core:notes", "plugin:tts:speak"]);
  });
});
