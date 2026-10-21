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

export { pluginSettingsPagesAtom } from "./state/plugin-store";
export { usePluginViewSource } from "./hooks/usePluginViewSource";
