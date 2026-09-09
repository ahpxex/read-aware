import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n } from "./index";

test("batch removal errors have stable localized copy without raw details or blind retry", async () => {
  await initI18n("en");
  for (const code of ["library/invalid-removal", "library/removal-cleanup-pending", "library/book-reappeared"]) {
    const result = describeError(new AppError(code, "PRIVATE_REMOVAL_ERROR"));
    expect(result.body).not.toContain("PRIVATE_REMOVAL_ERROR");
    expect(result.body).toBeTruthy();
    expect(result.retryable).toBe(false);
  }
});

test("all eight locales explain removal errors and preserve the exact approval subject", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    const ai = await Bun.file(new URL(`./locales/${locale}/ai.json`, import.meta.url)).json();
    for (const key of ["bookRemovalInvalid", "bookRemovalCleanupPending", "bookRemovalReappeared"]) expect(common.errors[key]).toBeTruthy();
    const permission = ai.chat.interaction.permission.deleteBooks;
    expect(permission.question).toBeTruthy();
    expect(permission.description).toContain("{{subject}}");
    expect(permission.approve).toBeTruthy();
    expect(ai.chat.tools.delete_books).toBeTruthy();
  }
});
