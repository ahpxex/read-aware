import { getDefaultStore, type Atom } from "jotai";
import { afterLocalKVWrites, hasPendingLocalKVWrites, onLocalKVCommit } from "../../platform/local-store";
import { afterSecretWrites, onSecretCommit } from "../../platform/secret-store";
import { createLogger } from "../../platform/logger";
import { AI_CONFIG_KEY } from "../../features/ai/lib/ai-config";
import { MENU_CONFIG_KEY } from "../../features/menus/state/menu-config";
import { APP_SETTINGS_KEY } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY } from "../../features/settings/lib/general-settings";
import { SHELF_VIEW_KEY } from "../../features/shelf/lib/shelf-view";
import { PAGE_TURN_SETTINGS_KEY } from "./page-turn-settings";
import { HEADER_FOOTER_SETTINGS_KEY } from "./header-footer-settings";
import { SHORTCUT_BINDINGS_KEY } from "../../features/settings/lib/shortcut-bindings";
import { AI_PREFERENCES_KEY } from "../../features/settings/lib/ai-preferences";
import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { READER_LANGUAGES_KEY } from "../../features/settings/lib/reader-languages";
import { CONTENT_TYPOGRAPHY_KEY } from "../../features/settings/lib/content-typography";
import { DEFAULT_COLOR_KEY } from "../../features/annotations/lib/annotation-prefs";
import { CHANNEL_KV_KEY } from "../../features/update/lib/update-channel";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
  readerModesAtom,
  pluginCommandsAtom,
  activeReaderModeSourceAtom,
} from "../../features/plugins/state/plugin-store";
import { SettingsObservationHub } from "./observation";
import { copyEventCause } from "../../platform/domain-actor";

const keys = new Set([
  AI_CONFIG_KEY,
  MENU_CONFIG_KEY,
  APP_SETTINGS_KEY,
  GENERAL_SETTINGS_KEY,
  SHELF_VIEW_KEY,
  PAGE_TURN_SETTINGS_KEY,
  HEADER_FOOTER_SETTINGS_KEY,
  SHORTCUT_BINDINGS_KEY,
  AI_PREFERENCES_KEY,
  READER_PREFERENCES_KEY,
  READER_OVERRIDES_KEY,
  READER_LANGUAGES_KEY,
  CONTENT_TYPOGRAPHY_KEY,
  DEFAULT_COLOR_KEY,
  CHANNEL_KV_KEY,
]);
const log = createLogger("settings-observation");
export const settingsObservation = new SettingsObservationHub((error) => log.warn("Settings observer failed", error));
let started = false;
export function initializeSettingsObservation(): void {
  if (started) return;
  started = true;
  onLocalKVCommit((commit) => {
    if (
      !commit.entries.some(
        ({ key }) => keys.has(key) || (key.startsWith("read-aware-plugin.") && key.endsWith(".settings")),
      )
    )
      return;
    settingsObservation.invalidate(copyEventCause(commit, { source: commit.source, origin: commit.actor }));
  });
  onSecretCommit((key, _source, commit) => {
    if (key === "ai-api-key" || key.startsWith("ai-api-key."))
      settingsObservation.invalidate(copyEventCause(commit, { source: commit.source, origin: commit.origin }));
  });
  const store = getDefaultStore();
  const sources: Atom<object>[] = [
    installedPluginsAtom,
    pluginFontsAtom,
    pluginThemesAtom,
    headerActionsAtom,
    selectionActionsAtom,
    readerModesAtom,
    pluginCommandsAtom,
    activeReaderModeSourceAtom,
  ];
  for (const atom of sources) {
    // Subscribe to the stamped producer, not a derived catalog object which
    // has lost provenance. The settings read still uses its normal selectors.
    store.sub(atom, () =>
      settingsObservation.invalidate(copyEventCause(store.get(atom), { source: "catalog", origin: null })),
    );
  }
}

/** Both queues must be settled in the same JS turn before reading credential-presence metadata. */
export async function afterSettingsWrites<T>(read: () => T | Promise<T>): Promise<T> {
  while (true) {
    await afterLocalKVWrites(() => {});
    const result = await afterSecretWrites(() =>
      hasPendingLocalKVWrites() ? { retry: true as const } : { value: read() },
    );
    if (!("retry" in result)) return result.value;
  }
}
