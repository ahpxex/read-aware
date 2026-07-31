/**
 * Proactive plugin update notice: once a day (per launch at most), quietly
 * fetch the marketplace registry and toast when an installed, non-builtin
 * plugin has a newer version listed. Each version is announced once — the
 * user updates from Settings → Plugins → Marketplace at their own pace.
 */
import { getDefaultStore } from "jotai";
import { i18n } from "../../../i18n";
import { localKV } from "../../../platform/local-store";
import { showPluginToast } from "../lib/plugin-toast";
import { installedPluginsAtom } from "../state/plugin-store";
import { fetchMarketplaceRegistry } from "./marketplace";

const CHECK_KEY = "read-aware-plugin-update-check";
const CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000;

type CheckState = {
  at: number;
  /** plugin id → last registry version we announced. */
  notified: Record<string, string>;
};

function readState(): CheckState {
  try {
    const raw = localKV.getItem(CHECK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CheckState>) : null;
    return {
      at: typeof parsed?.at === "number" ? parsed.at : 0,
      notified:
        parsed?.notified && typeof parsed.notified === "object" ? parsed.notified : {},
    };
  } catch {
    return { at: 0, notified: {} };
  }
}

/** "1.2.0" > "1.1.9" — numeric per segment, missing segments are zero. */
export function versionNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return false;
}

export async function checkPluginUpdates(): Promise<void> {
  const state = readState();
  if (Date.now() - state.at < CHECK_INTERVAL_MS) return;

  let entries;
  try {
    entries = await fetchMarketplaceRegistry();
  } catch {
    // Offline or registry hiccup — try again next interval, never nag.
    return;
  }

  const installed = getDefaultStore().get(installedPluginsAtom);
  const t = i18n.getFixedT(null, "plugins");
  const notified = { ...state.notified };

  for (const entry of entries) {
    const plugin = installed.find((candidate) => candidate.manifest.id === entry.id);
    if (!plugin || plugin.builtin) continue;
    if (!versionNewer(entry.version, plugin.manifest.version)) continue;
    if (notified[entry.id] === entry.version) continue;
    notified[entry.id] = entry.version;
    showPluginToast(
      String(t("settings.updateAvailableToast", { name: entry.name, version: entry.version })),
    );
  }

  localKV.setItem(CHECK_KEY, JSON.stringify({ at: Date.now(), notified } satisfies CheckState));
}
