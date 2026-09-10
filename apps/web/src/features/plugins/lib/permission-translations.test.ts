import { expect, test } from "bun:test";
import { PLUGIN_PERMISSIONS } from "@read-aware/core";
import { permissionLabelKey, permissionNameKey } from "./plugin-types";

test("every declared plugin permission has a consent name and description in all locales", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const catalog = await Bun.file(new URL(`../../../i18n/locales/${locale}/plugins.json`, import.meta.url)).json();
    for (const permission of PLUGIN_PERMISSIONS) {
      for (const key of [permissionNameKey(permission), permissionLabelKey(permission)]) {
        const value = key.split(".").reduce((node, part) => node?.[part], catalog);
        expect(typeof value, `${locale}: ${key}`).toBe("string");
        expect(value.trim().length, `${locale}: ${key}`).toBeGreaterThan(0);
      }
    }
  }
});
