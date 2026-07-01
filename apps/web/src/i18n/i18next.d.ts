/**
 * Typed translation keys. i18next derives `t()` autocomplete + compile-time key
 * checking from the English catalogs below (the source of truth). The other
 * locales are not type-checked against these, so they may lag without breaking
 * the build; only `en` must stay in sync with the code.
 */
import "i18next";

import type common from "./locales/en/common.json";
import type ui from "./locales/en/ui.json";
import type settings from "./locales/en/settings.json";
import type reader from "./locales/en/reader.json";
import type shelf from "./locales/en/shelf.json";
import type stats from "./locales/en/stats.json";
import type ai from "./locales/en/ai.json";
import type command from "./locales/en/command.json";
import type nav from "./locales/en/nav.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      ui: typeof ui;
      settings: typeof settings;
      reader: typeof reader;
      shelf: typeof shelf;
      stats: typeof stats;
      ai: typeof ai;
      command: typeof command;
      nav: typeof nav;
    };
  }
}
