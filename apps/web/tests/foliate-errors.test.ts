import { expect, test } from "bun:test";
import { UnsupportedEncryptionError } from "../foliate-js/src/errors.js";
import { describeError } from "../src/i18n/describe-error.js";
import { i18n } from "../src/i18n/instance.js";

test("encrypted books use a localized terminal error instead of leaking algorithm details", async () => {
  const error = new UnsupportedEncryptionError("EPUB", "urn:private-algorithm");
  const languages = ["en", "zh-Hans", "zh-Hant", "ja", "de", "es", "fr", "ru"];
  for (const language of languages) {
    const common: { errors: { bookEncryption: string } } = await Bun.file(
      new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url),
    ).json();
    await i18n.init({ lng: language, resources: { [language]: { common } }, ns: ["common"], defaultNS: "common" });
    const description = describeError(error);
    expect(description.body).toBe(common.errors.bookEncryption);
    expect(description.body).not.toContain("urn:private-algorithm");
    expect(description.retryable).toBe(false);
  }
});
