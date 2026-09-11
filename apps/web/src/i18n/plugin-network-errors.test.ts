import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { i18n, initI18n } from "./index";

const cases = [
  ["plugin/network-failed", "pluginNetworkFailed", true],
  ["plugin/network-timeout", "pluginNetworkTimeout", false],
  ["plugin/http-auth", "pluginHttpAuth", false],
  ["plugin/http-not-found", "pluginHttpNotFound", false],
  ["plugin/http-rate-limited", "pluginHttpRateLimited", true],
  ["plugin/http-server", "pluginHttpServer", true],
  ["plugin/http-rejected", "pluginHttpRejected", false],
] as const;

test("network and HTTP errors have eight-locale copy and truthful retry metadata", async () => {
  await initI18n("en");
  const original = i18n.language;
  try {
    for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
      const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
      await i18n.changeLanguage(locale);
      for (const [code, key, retryable] of cases) {
        expect(common.errors[key]).toBeTruthy();
        const copy = describeError(new AppError(code, "PRIVATE_NETWORK_FAILURE"));
        expect(copy.body).toBe(common.errors[key]);
        expect(copy.retryable).toBe(retryable);
        expect(copy.body).not.toContain("PRIVATE_NETWORK_FAILURE");
      }
    }
  } finally { await i18n.changeLanguage(original); }
});
