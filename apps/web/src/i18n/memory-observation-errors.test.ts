import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("memory observation failures have localized stable copy in every supported locale", async () => {
  await initI18n("en");
  for (const code of ["memory/observer-limit", "memory/observation-failed"]) {
    const copy = describeError(new AppError(code, "PRIVATE_OBSERVATION"));
    expect(copy.body).not.toContain("PRIVATE_OBSERVATION"); expect(copy.body).toBeTruthy();
    expect(copy.retryable).toBe(code === "memory/observation-failed");
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const key of ["memoryObserverLimit", "memoryObservationFailed"]) expect(common.errors[key]).toBeTruthy();
  }
});
