import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { applyDisplayAttributes, isEinkActive, resolveAppTheme, resolveReducedMotion } from "./app-settings";

// No e-ink panel is detected outside an Android shell, so `auto` reads as off here.
describe("display mode resolution", () => {
  test("the explicit e-ink choice wins over detection", () => {
    expect(isEinkActive({ eink: "on" })).toBe(true);
    expect(isEinkActive({ eink: "off" })).toBe(false);
    expect(isEinkActive({ eink: "auto" })).toBe(false);
  });

  test("e-ink mode pins the chrome light, whatever the theme preference", () => {
    expect(resolveAppTheme({ theme: "dark", eink: "on" })).toBe("light");
    expect(resolveAppTheme({ theme: "dark", eink: "off" })).toBe("dark");
  });

  test("e-ink mode turns motion off as surely as the Motion setting", () => {
    expect(resolveReducedMotion({ motion: "system", eink: "on" })).toBe(true);
    expect(resolveReducedMotion({ motion: "reduced", eink: "off" })).toBe(true);
    expect(resolveReducedMotion({ motion: "system", eink: "off" })).toBe(false);
  });

  test("the root carries both flags while e-ink mode is on and drops them after", () => {
    const root = new JSDOM("").window.document.documentElement;
    applyDisplayAttributes(root, { motion: "system", eink: "on" });
    expect(root.dataset.motion).toBe("reduced");
    expect(root.hasAttribute("data-eink")).toBe(true);
    applyDisplayAttributes(root, { motion: "system", eink: "off" });
    expect(root.dataset.motion).toBeUndefined();
    expect(root.hasAttribute("data-eink")).toBe(false);
  });
});
