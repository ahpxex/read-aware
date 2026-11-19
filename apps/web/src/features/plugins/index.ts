/**
 * The plugins feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Settings → Plugins: why an installed plugin is not running, and the update
// that fixes an outdated one.
export { PluginActivationError } from "./components/PluginActivationError";
export { useOutdatedPluginUpdates } from "./hooks/useOutdatedPluginUpdates";
// Install failures from a folder or zip share the marketplace's copy.
export { describePluginInstallFailure } from "./lib/install-failure";
// The diagnostics bundle lists what was installed beside a failing plugin.
export { pluginInventory, type PluginInventoryEntry } from "./lib/plugin-inventory";

export {
  headerActionsAtom,
  pluginSettingsPagesAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "./state/plugin-store";
export { usePluginViewSource } from "./hooks/usePluginViewSource";

// The app header renders shelf contributions (buttons, page links, overflow
// rows) on the user-arranged surfaces the menus feature resolves.
export { PluginHeaderItem } from "./components/PluginHeaderCluster";
export { openHeaderActionDialog } from "./lib/open-header-action";
export { renderPluginIcon } from "./lib/plugin-icons";
export { contributionText, resolvePluginText } from "./lib/plugin-i18n";
export { actionEnabled, actionVisible } from "./lib/plugin-action-state";
export type { RegisteredHeaderAction } from "./lib/plugin-types";
