import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("search errors use localized copy and do not suggest blind retries", async () => {
  await initI18n("en");
  for (const code of ["library/cancelled", "library/invalid-query", "library/book-not-found"]) {
    const result = describeError(new AppError(code, "PRIVATE_TEST_ERROR"));
    expect(result.body).not.toContain("PRIVATE_TEST_ERROR");
    expect(result.body).toBeTruthy();
    expect(result.retryable).toBe(false);
  }
});

test("all eight locale catalogs contain explicit search error copy", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const catalog = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const key of ["bookSearchCancelled", "bookSearchInvalid", "bookNotFound"]) expect(catalog.errors[key]).toBeTruthy();
  }
});
