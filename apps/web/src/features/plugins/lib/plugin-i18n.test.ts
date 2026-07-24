import { describe, expect, test } from "bun:test";
import { resolvePluginText } from "./plugin-i18n";

const copy = {
  default: "Default",
  translations: { en: "English", fr: "Français", "zh-Hans": "简体中文" },
};

describe("plugin localized text", () => {
  test("resolves exact and case-insensitive locale tags", () => {
    expect(resolvePluginText(copy, "zh-Hans")).toBe("简体中文");
    expect(resolvePluginText(copy, "ZH-HANS")).toBe("简体中文");
  });

  test("falls back from a regional tag to its base language", () => {
    expect(resolvePluginText(copy, "fr-CA")).toBe("Français");
  });

  test("uses the declared default when no translation matches", () => {
    expect(resolvePluginText(copy, "de")).toBe("Default");
    expect(resolvePluginText(copy)).toBe("Default");
  });
});
