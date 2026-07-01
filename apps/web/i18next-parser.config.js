/**
 * i18next-parser config — extraction tooling for maintenance.
 *
 * Statically scans `t()` / `<Trans>` usage across the app and the shared UI
 * package and merges keys into the per-locale catalogs. Run with:
 *
 *   bun run i18n:extract
 *
 * `keepRemoved: true` is deliberate: it never deletes keys, so a partial scan
 * can't silently drop translations. Flip it to prune once the whole tree is
 * migrated. English is the source; other locales get empty placeholders that
 * fall back to `en` until translated.
 */
export default {
  locales: ["en", "zh-Hans", "zh-Hant", "ja", "fr", "de", "ru", "es"],
  input: ["src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  output: "src/i18n/locales/$LOCALE/$NAMESPACE.json",
  defaultNamespace: "common",
  namespaceSeparator: ":",
  keySeparator: ".",
  sort: true,
  keepRemoved: true,
  createOldCatalogs: false,
  // Blank missing values so untranslated locales fall back to `en` at runtime.
  defaultValue: (locale, _namespace, key) => (locale === "en" ? key : ""),
};
