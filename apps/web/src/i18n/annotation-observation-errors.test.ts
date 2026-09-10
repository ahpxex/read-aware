import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("annotation observation errors are localized and never render raw messages", async () => {
  await initI18n("en");
  for (const code of ["annotations/observer-limit", "annotations/observation-failed"]) {
    const copy = describeError(new AppError(code, "PRIVATE_OBSERVATION"));
    expect(copy.body).not.toContain("PRIVATE_OBSERVATION"); expect(copy.body).toBeTruthy();
    expect(copy.retryable).toBe(code === "annotations/observation-failed");
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const key of ["annotationObserverLimit", "annotationObservationFailed"]) expect(common.errors[key]).toBeTruthy();
  }
});
