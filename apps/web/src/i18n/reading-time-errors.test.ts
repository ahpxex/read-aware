import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("reading time errors and tool labels are localized without raw failure details", async () => {
  await initI18n("en");
  for (const code of ["reading/invalid-time-query", "reading/stats-stale", "reading/stats-invalid", "reading/stats-unavailable", "reading/stats-observer-limit"]) {
    const copy = describeError(new AppError(code, "PRIVATE_TIME_FAILURE"));
    expect(copy.body).not.toContain("PRIVATE_TIME_FAILURE"); expect(copy.body).toBeTruthy();
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    const ai = await Bun.file(new URL(`./locales/${locale}/ai.json`, import.meta.url)).json();
    for (const key of ["readingTimeInvalid", "readingTimeStale", "readingTimeUnavailable", "readingTimeLimit"]) expect(common.errors[key]).toBeTruthy();
    expect(ai.chat.tools.get_reading_time).toBeTruthy();
  }
});
