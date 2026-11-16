import { expect, test } from "bun:test";
import { dateFormatter, formatDate, formatDuration, numberFormatter } from "./format";
import { initI18n } from ".";
import { i18n } from "./instance";

test("formatters are built once per locale and options, then reused", () => {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
  expect(dateFormatter("en", options)).toBe(dateFormatter("en", { ...options }));
  expect(dateFormatter("en", options)).not.toBe(dateFormatter("de", options));
  expect(dateFormatter("en", options)).not.toBe(dateFormatter("en", { month: "long" }));
  expect(numberFormatter("en", { style: "percent" })).toBe(numberFormatter("en", { style: "percent" }));
  expect(numberFormatter("en")).toBe(numberFormatter("en", undefined));
});

test("a language switch formats in the new language", async () => {
  const day = Date.UTC(2026, 10, 16, 12);
  await initI18n("en");
  // Other suites in the same run may have left another language active.
  await i18n.changeLanguage("en");
  const english = formatDate(day, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  expect(english).toBe("November 16, 2026");
  expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
  await i18n.changeLanguage("de");
  expect(formatDate(day, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })).toBe(
    "16. November 2026",
  );
  await i18n.changeLanguage("en");
});
