import { getDefaultStore } from "jotai";
import { afterLocalKVWrites, hasPendingLocalKVWrites, onLocalKVCommit } from "../../platform/local-store";
import { afterSecretWrites, onSecretCommit } from "../../platform/secret-store";
import { createLogger } from "../../platform/logger";
import { AI_CONFIG_KEY } from "../../features/ai/lib/ai-config";
import { MENU_CONFIG_KEY } from "../../features/menus/state/menu-config";
import { APP_SETTINGS_KEY } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY } from "../../features/settings/lib/general-settings";
import { SHELF_VIEW_KEY } from "../../features/shelf/lib/shelf-view";
import { SHORTCUT_BINDINGS_KEY } from "../../features/settings/lib/shortcut-bindings";
import { AI_PREFERENCES_KEY } from "../../features/settings/lib/ai-preferences";
import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { READER_OVERRIDES_KEY } from "../../features/settings/lib/reader-overrides";
import { CONTENT_TYPOGRAPHY_KEY } from "../../features/settings/lib/content-typography";
import { DEFAULT_COLOR_KEY } from "../../features/annotations/lib/annotation-prefs";
import { CHANNEL_KV_KEY } from "../../features/update/lib/update-channel";
import { headerActionsAtom, installedPluginsAtom, pluginFontsAtom, pluginThemesAtom, selectionActionsAtom, textUnitReaderModeAtom } from "../../features/plugins/state/plugin-store";
import { shortcutEnvironmentAtom } from "../../features/settings/state/shortcut-state";
import { SettingsObservationHub } from "./observation";

const keys = new Set([AI_CONFIG_KEY, MENU_CONFIG_KEY, APP_SETTINGS_KEY, GENERAL_SETTINGS_KEY, SHELF_VIEW_KEY,
  SHORTCUT_BINDINGS_KEY, AI_PREFERENCES_KEY, READER_PREFERENCES_KEY, READER_OVERRIDES_KEY, CONTENT_TYPOGRAPHY_KEY, DEFAULT_COLOR_KEY, CHANNEL_KV_KEY]);
const log = createLogger("settings-observation");
export const settingsObservation = new SettingsObservationHub(error => log.warn("Settings observer failed", error));
let started = false;
export function initializeSettingsObservation(): void {
  if (started) return;
  started = true;
  onLocalKVCommit(commit => {
    if (!commit.entries.some(({ key }) => keys.has(key) || (key.startsWith("read-aware-plugin.") && key.endsWith(".settings")))) return;
    settingsObservation.invalidate({ source: commit.source, origin: commit.actor });
  });
  onSecretCommit((key, source) => {
    if (key === "ai-api-key" || key.startsWith("ai-api-key.")) settingsObservation.invalidate({ source, origin: null });
  });
  const store = getDefaultStore();
  for (const atom of [installedPluginsAtom, pluginFontsAtom, pluginThemesAtom, headerActionsAtom, selectionActionsAtom, textUnitReaderModeAtom, shortcutEnvironmentAtom]) {
    store.sub(atom, () => settingsObservation.invalidate({ source: "catalog", origin: null }));
  }
}

/** Both queues must be settled in the same JS turn before reading credential-presence metadata. */
export async function afterSettingsWrites<T>(read: () => T | Promise<T>): Promise<T> {
  while (true) {
    await afterLocalKVWrites(() => {});
    const result = await afterSecretWrites(() => hasPendingLocalKVWrites() ? { retry: true as const } : { value: read() });
    if (!("retry" in result)) return result.value;
  }
}
