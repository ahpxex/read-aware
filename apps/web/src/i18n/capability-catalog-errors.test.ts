import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("capability query failures have safe non-retryable copy in every locale", async () => {
  await initI18n("en");
  for (const code of ["ai/invalid-capability-query", "ai/capability-catalog-changed", "ai/capability-catalog-unavailable"]) {
    const copy = describeError(new AppError(code, "PRIVATE_CAPABILITY_DETAIL"));
    expect(copy.body).not.toContain("PRIVATE_CAPABILITY_DETAIL"); expect(copy.body).toBeTruthy(); expect(copy.retryable).toBe(false);
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const key of ["capabilityQueryInvalid", "capabilityCatalogChanged", "capabilityCatalogUnavailable"]) expect(common.errors[key]).toBeTruthy();
  }
});
