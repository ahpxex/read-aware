import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n, i18n } from "./index";

if (process.env.GRAPH_QUEUE_LOCALE_CASE === "1") test("graph queue capacity has retryable localized copy without exposing raw errors", async () => {
  await initI18n("en");
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    await i18n.changeLanguage(locale);
    const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    expect(common.errors.memoryTaskLimit).toBeTruthy();
    const copy = describeError(new AppError("memory/task-limit", "PRIVATE_QUEUE"));
    expect(copy.retryable).toBe(true);
    expect(copy.body).toBe(common.errors.memoryTaskLimit);
    expect(copy.body).not.toContain("PRIVATE_QUEUE");
  }
});
else test("graph queue error localization uses a fresh language-loader lifecycle", async () => {
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, GRAPH_QUEUE_LOCALE_CASE: "1" }, stdout: "ignore", stderr: "pipe",
  });
  const output = await new Response(child.stderr).text();
  expect(await child.exited, output).toBe(0); expect(output).toContain("32 expect() calls");
}, 30_000);
