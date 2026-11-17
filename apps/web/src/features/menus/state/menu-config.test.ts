import { describe, expect, test } from "bun:test";
import {
  arrangeSurface,
  canMoveMenuItem,
  clampPrimaryNavVisible,
  CORE_DESTINATION_IDS,
  CORE_MENU_DEFAULTS,
  CORE_OVERFLOW_DEFAULTS,
  moveMenuItem,
  resolveMenuLayouts,
  resolveSurfaceLayout,
  type MenuCatalog,
  type MenuConfig,
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

/** The catalog with no plugins beyond two shelf pages — what menuCatalog builds. */
const PAGES = ["plugin:dictionary:vocabulary", "plugin:rss-reader:feeds"];
const catalog: MenuCatalog = {
  known: {
    primaryNav: [...CORE_DESTINATION_IDS, ...PAGES],
    shelfHeader: [
      "core:search",
      "core:import",
      "core:importFolder",
      "core:viewControl",
      "core:settings",
      ...CORE_DESTINATION_IDS,
      ...PAGES,
    ],
    readerHeader: CORE_MENU_DEFAULTS.readerHeader,
    readerToolbar: [...CORE_MENU_DEFAULTS.readerToolbar, ...CORE_OVERFLOW_DEFAULTS.readerToolbar],
    selection: CORE_MENU_DEFAULTS.selection,
  },
  destinations: [...CORE_DESTINATION_IDS, ...PAGES],
  defaultVisible: {},
};

const defaults = (): MenuConfig => ({
  primaryNav: { visible: [...CORE_MENU_DEFAULTS.primaryNav], overflow: [] },
  shelfHeader: { visible: [...CORE_MENU_DEFAULTS.shelfHeader], overflow: [...CORE_OVERFLOW_DEFAULTS.shelfHeader] },
  readerHeader: { visible: [...CORE_MENU_DEFAULTS.readerHeader], overflow: [] },
  readerToolbar: {
    visible: [...CORE_MENU_DEFAULTS.readerToolbar],
    overflow: [...CORE_OVERFLOW_DEFAULTS.readerToolbar],
  },
  selection: { visible: [...CORE_MENU_DEFAULTS.selection], overflow: [] },
});

/** Every destination is in exactly one place across the two shared surfaces. */
function expectEachDestinationOnce(layouts: MenuConfig) {
  for (const id of catalog.destinations) {
    const places = [
      layouts.primaryNav.visible.includes(id),
      layouts.shelfHeader.visible.includes(id),
      layouts.shelfHeader.overflow.includes(id),
    ].filter(Boolean);
    expect({ id, places: places.length }).toEqual({ id, places: 1 });
  }
}

describe("destinations live in one place", () => {
  test("defaults: Library, Agent and Notes in the navigation; Stats and plugin pages in the shelf header", () => {
    const layouts = resolveMenuLayouts(defaults(), catalog);
    expect(layouts.primaryNav.visible).toEqual(["core:library", "core:agent", "core:annotations"]);
    expect(layouts.shelfHeader.visible).toEqual([
      "core:search",
      "core:import",
      "core:viewControl",
      "core:stats",
      "core:settings",
    ]);
    expect(layouts.shelfHeader.overflow).toEqual(["core:importFolder", ...PAGES]);
    // The navigation's second zone is derived: what the shelf header holds.
    expect(layouts.primaryNav.overflow).toEqual(["core:stats", ...PAGES]);
    expectEachDestinationOnce(layouts);
  });

  test("a layout saved with Notes in the old hidden zone shows Notes in More (stored dev config)", () => {
    const saved: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library", "core:agent"], overflow: ["core:annotations", "core:stats", ...PAGES] },
      shelfHeader: {
        visible: ["core:search", "core:import", "core:viewControl", "core:stats", "core:settings"],
        overflow: [],
      },
    };
    const layouts = resolveMenuLayouts(saved, catalog);
    expect(layouts.primaryNav.visible).toEqual(["core:library", "core:agent"]);
    expect(layouts.shelfHeader.overflow).toEqual(["core:importFolder", "core:annotations", ...PAGES]);
    expectEachDestinationOnce(layouts);
  });

  test("a layout saved before Notes existed gains it in the navigation (stored prod config)", () => {
    // Saved 2026-08-11 — before Notes was a page, and without readerToolbar.
    const saved: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library", "core:agent"], overflow: ["core:stats", ...PAGES] },
      shelfHeader: {
        visible: ["core:search", "core:import", "core:viewControl", "core:stats", "core:settings"],
        overflow: [],
      },
    };
    const layouts = resolveMenuLayouts(saved, catalog);
    expect(layouts.primaryNav.visible).toEqual(["core:library", "core:agent", "core:annotations"]);
    expect(layouts.shelfHeader.visible).toContain("core:stats");
    expect(layouts.shelfHeader.overflow).toEqual(["core:importFolder", ...PAGES]);
    expectEachDestinationOnce(layouts);
  });

  test("taking Notes out through the navigation's own list keeps it out", () => {
    const out = arrangeSurface(defaults(), catalog, "primaryNav", {
      visible: ["core:library", "core:agent"],
      overflow: [],
    });
    if (!out.ok) throw new Error("expected the arrangement to apply");
    const layouts = resolveMenuLayouts(out.config, catalog);
    expect(layouts.primaryNav.visible).toEqual(["core:library", "core:agent"]);
    expect(layouts.shelfHeader.overflow).toContain("core:annotations");
    expectEachDestinationOnce(layouts);
  });

  test("rearranging the shelf header leaves the navigation's stored slots alone", () => {
    // A plugin page sits in the navigation while its plugin is disabled.
    const saved: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library", "plugin:off:page", "core:agent"], overflow: [] },
    };
    const reordered = arrangeSurface(saved, catalog, "shelfHeader", {
      visible: ["core:import", "core:search", "core:viewControl", "core:stats", "core:settings"],
      overflow: ["core:importFolder"],
    });
    if (!reordered.ok) throw new Error("expected the arrangement to apply");
    expect(reordered.config.primaryNav.visible).toEqual(["core:library", "plugin:off:page", "core:agent"]);

    const adopted = arrangeSurface(saved, catalog, "shelfHeader", {
      visible: ["core:search", "core:agent"],
      overflow: [],
    });
    if (!adopted.ok) throw new Error("expected the arrangement to apply");
    expect(adopted.config.primaryNav.visible).toEqual(["core:library", "plugin:off:page"]);
  });

  test("a stored layout listing a destination on both surfaces resolves with the navigation winning", () => {
    const saved: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library", "core:stats"], overflow: ["core:agent", "core:annotations"] },
      shelfHeader: { visible: ["core:search", "core:stats", "core:library"], overflow: [] },
    };
    const layouts = resolveMenuLayouts(saved, catalog);
    expect(layouts.primaryNav.visible).toEqual(["core:library", "core:stats"]);
    expect(layouts.shelfHeader.visible).not.toContain("core:stats");
    expect(layouts.shelfHeader.visible).not.toContain("core:library");
    expectEachDestinationOnce(layouts);
  });

  test("dragging Notes from the navigation into More moves it, and back again", () => {
    const out = moveMenuItem(
      defaults(),
      catalog,
      { surface: "primaryNav", id: "core:annotations" },
      { surface: "shelfHeader", zone: "overflow", beforeId: null },
    );
    if (!out?.ok) throw new Error("expected the move to apply");
    const moved = resolveMenuLayouts(out.config, catalog);
    expect(moved.primaryNav.visible).toEqual(["core:library", "core:agent"]);
    expect(moved.shelfHeader.overflow.at(-1)).toBe("core:annotations");
    expectEachDestinationOnce(moved);

    const back = moveMenuItem(
      out.config,
      catalog,
      { surface: "shelfHeader", id: "core:annotations" },
      { surface: "primaryNav", zone: "visible", beforeId: "core:agent" },
    );
    if (!back?.ok) throw new Error("expected the move to apply");
    const restored = resolveMenuLayouts(back.config, catalog);
    expect(restored.primaryNav.visible).toEqual(["core:library", "core:annotations", "core:agent"]);
    expect([...restored.shelfHeader.visible, ...restored.shelfHeader.overflow]).not.toContain("core:annotations");
    // The stored shelf layout no longer carries it either.
    expect([...back.config.shelfHeader.visible, ...back.config.shelfHeader.overflow]).not.toContain("core:annotations");
    expectEachDestinationOnce(restored);
  });

  test("promoting the shelf's inline Stats icon into the navigation removes the icon", () => {
    const out = moveMenuItem(
      defaults(),
      catalog,
      { surface: "shelfHeader", id: "core:stats" },
      { surface: "primaryNav", zone: "visible", beforeId: null },
    );
    if (!out?.ok) throw new Error("expected the move to apply");
    const layouts = resolveMenuLayouts(out.config, catalog);
    expect(layouts.primaryNav.visible.at(-1)).toBe("core:stats");
    expect(layouts.shelfHeader.visible).not.toContain("core:stats");
    expectEachDestinationOnce(layouts);
  });

  test("the navigation's limits hold whichever side the move comes from", () => {
    const full: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library", "core:agent", "core:annotations", PAGES[0]], overflow: [] },
    };
    const fifth = moveMenuItem(
      full,
      catalog,
      { surface: "shelfHeader", id: "core:stats" },
      { surface: "primaryNav", zone: "visible", beforeId: null },
    );
    expect(fifth).toEqual({ ok: false, error: { surface: "primaryNav", rule: "maxVisible", limit: 4 } });

    const lone: MenuConfig = {
      ...defaults(),
      primaryNav: { visible: ["core:library"], overflow: ["core:agent", "core:annotations"] },
    };
    const empty = moveMenuItem(
      lone,
      catalog,
      { surface: "primaryNav", id: "core:library" },
      { surface: "shelfHeader", zone: "visible", beforeId: null },
    );
    expect(empty).toEqual({ ok: false, error: { surface: "primaryNav", rule: "minVisible", limit: 1 } });
  });

  test("only destinations cross surfaces, and the navigation has no hidden zone to drop into", () => {
    expect(
      canMoveMenuItem(
        catalog,
        { surface: "shelfHeader", id: "core:search" },
        { surface: "primaryNav", zone: "visible", beforeId: null },
      ),
    ).toBe(false);
    expect(
      canMoveMenuItem(
        catalog,
        { surface: "readerHeader", id: "core:find" },
        { surface: "readerToolbar", zone: "visible", beforeId: null },
      ),
    ).toBe(false);
    expect(
      canMoveMenuItem(
        catalog,
        { surface: "primaryNav", id: "core:agent" },
        { surface: "primaryNav", zone: "overflow", beforeId: null },
      ),
    ).toBe(false);
  });

  test("items shared by the reader header and toolbar are not destinations and stay on both", () => {
    const layouts = resolveMenuLayouts(defaults(), catalog);
    expect(layouts.readerHeader.visible).toContain("core:find");
    expect(layouts.readerToolbar.visible).toContain("core:find");
  });
});
