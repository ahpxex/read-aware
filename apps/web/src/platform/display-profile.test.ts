import { describe, expect, test } from "bun:test";
import { classifyEinkPanel, type DisplayProfileReport } from "./display-profile";

const report = (overrides: Partial<DisplayProfileReport>): DisplayProfileReport => ({
  manufacturer: "",
  brand: "",
  model: "",
  device: "",
  epdProperties: [],
  ...overrides,
});

describe("e-ink panel classification", () => {
  test("an e-paper display property decides on its own", () => {
    expect(classifyEinkPanel(report({ manufacturer: "Rockchip", epdProperties: ["sys.eink.mode"] }))).toBe(true);
  });

  test("an e-paper-only vendor is recognized by manufacturer or brand, in any case", () => {
    expect(classifyEinkPanel(report({ manufacturer: "ONYX", model: "NoteX5" }))).toBe(true);
    expect(classifyEinkPanel(report({ manufacturer: "unknown", brand: "iReader " }))).toBe(true);
  });

  test("an ordinary phone or tablet is not e-ink", () => {
    expect(classifyEinkPanel(report({ manufacturer: "Google", brand: "google", model: "Pixel 9" }))).toBe(false);
    expect(classifyEinkPanel(report({}))).toBe(false);
  });
});
