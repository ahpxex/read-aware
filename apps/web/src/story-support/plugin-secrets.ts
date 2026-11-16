/**
 * Plugin secrets for Storybook, held in memory.
 *
 * The plugin secret store lives in the desktop shell (`secret_get` /
 * `secret_set` over IPC), and its browser branch throws, so any story that
 * renders a plugin's key field — a declared settings form, say — would show
 * the "couldn't check the saved key" failure instead of the surface it means
 * to show. `.storybook/preview.ts` mocks `platform/secret-store` in spy mode
 * (Storybook's `sb.mock`) and installs this store before every story, so each
 * story starts with no plugin secrets and can save, read and clear them.
 *
 * Only the three plugin-secret functions are replaced; the app-level secret
 * API keeps its own in-memory browser branch. Writes emit
 * `plugin-storage-changed` as the real store does, so open settings forms
 * rebuild the same way.
 *
 * This is story-only support code; nothing in the product imports it.
 */
import { mocked } from "storybook/test";
import { emitAppEvent } from "../platform/app-events";
import { deletePluginSecret, getPluginSecret, setPluginSecret } from "../platform/secret-store";

/** Replace the plugin secret store with a fresh in-memory one for this story. */
export function installStoryPluginSecrets(initial: Record<string, Record<string, string>> = {}): void {
  const secrets = new Map<string, string>();
  const slot = (pluginId: string, key: string) => `${pluginId}\u0000${key}`;
  for (const [pluginId, values] of Object.entries(initial)) {
    for (const [key, value] of Object.entries(values)) secrets.set(slot(pluginId, key), value);
  }
  mocked(getPluginSecret).mockImplementation(async (pluginId, key) => secrets.get(slot(pluginId, key)) ?? null);
  mocked(setPluginSecret).mockImplementation(async (pluginId, key, value, actor = "system") => {
    secrets.set(slot(pluginId, key), value);
    emitAppEvent("plugin-storage-changed", { pluginId }, actor);
  });
  mocked(deletePluginSecret).mockImplementation(async (pluginId, key, actor = "system") => {
    secrets.delete(slot(pluginId, key));
    emitAppEvent("plugin-storage-changed", { pluginId }, actor);
  });
}
