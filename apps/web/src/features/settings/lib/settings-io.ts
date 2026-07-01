/**
 * Reset for the locally-persisted ReadAware settings.
 *
 * These keys are the preference surface of the device-local KV layer, reached
 * through `localKV` (SQLite on desktop, localStorage in the browser). Full
 * backup/restore of everything lives in `backup-io`; this module only owns the
 * "reset preferences to defaults" action. Keep this list current as new settings
 * stores are added.
 */
import { localKV } from "../../../platform/local-store";

const SETTINGS_KEYS = [
  "read-aware-reader-settings",
  "read-aware-reader-overrides",
  "read-aware-reader-panels",
  "read-aware-reader-panel-sizes",
  "read-aware-app-settings",
  "read-aware-general-settings",
  "read-aware-ai-preferences",
  "read-aware-ai-config",
  "read-aware-shelf-view",
  "read-aware-shortcuts",
  "read-aware-default-mark-color",
] as const;

/** Remove every locally-persisted settings key (restore preferences to defaults). */
export function resetAllSettings(): void {
  for (const key of SETTINGS_KEYS) {
    localKV.removeItem(key);
  }
}
