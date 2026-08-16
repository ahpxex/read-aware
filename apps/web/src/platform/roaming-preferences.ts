/**
 * Roaming preferences — the bridge between device-local KV settings and the
 * event log.
 *
 * A preference namespace on the ALLOWLIST below lives in two places: its
 * `read-aware-*` KV entry (the synchronous read path every settings module
 * already uses) and the `synced_preferences` projection (populated by
 * `preference.changed` events, key-level last-writer-wins in HLC order).
 * The projection is the cross-device authority; the KV entry is this
 * device's cache of it:
 *
 * - a local save writes KV (unchanged) AND publishes the event;
 * - boot overlays the projection onto KV before any settings module reads;
 * - a sync pull re-overlays and announces changed keys, so mounted UI
 *   follows a remote change without a restart.
 *
 * Deliberately NOT roaming: OS integration (launch at startup, file
 * associations, auto-update), shortcuts (platform-shaped), interface
 * language, and every secret — secrets never enter the event log at all.
 */
import { invoke } from "@tauri-apps/api/core";
import { emitAppEvent } from "./app-events";
import { commitDomainEvents } from "./domain-events";
import { isTauri } from "./environment";
import { localKV } from "./local-store";

/**
 * The allowlist, with per-namespace policy.
 *
 * `deviceLocalFields` names object fields whose value is shaped by the
 * DEVICE (touch vs desktop defaults) — the overlay keeps this device's value
 * for them instead of adopting the remote one, so a phone's single-column
 * paging never follows a desktop's two-page spread.
 *
 * `stripOnPublish` names fields that must NEVER enter the event log. The AI
 * config blob is clean on every modern save (the key lives in the secret
 * store), but a pre-secret-store blob can still carry a plaintext `apiKey`
 * until its next save — stripping here makes the invariant unconditional.
 */
const ROAMING_POLICIES: Record<
  string,
  { deviceLocalFields: readonly string[]; stripOnPublish?: readonly string[] }
> = {
  "read-aware-app-settings": { deviceLocalFields: [] },
  "read-aware-reader-settings": { deviceLocalFields: ["pageMargins", "readingMode"] },
  "read-aware-content-typography": { deviceLocalFields: [] },
  "read-aware-ai-preferences": { deviceLocalFields: [] },
  // Provider/model choices roam; the API key is a per-device credential —
  // stripped from what we publish, and preserved locally on overlay for the
  // legacy blobs that still carry it inline.
  "read-aware-ai-config": { deviceLocalFields: ["apiKey"], stripOnPublish: ["apiKey"] },
};

export const ROAMING_PREFERENCE_KEYS = Object.keys(ROAMING_POLICIES);

export type RoamingPreferenceKey = keyof typeof ROAMING_POLICIES;

/**
 * Record a local settings save in the log. Fire-and-forget: the KV write the
 * caller just made is the device's truth either way, and a dropped event is
 * healed by the next save of the same namespace (whole-object payloads).
 */
export function publishRoamingPreference(key: RoamingPreferenceKey, value: unknown): void {
  if (!isTauri()) return;
  const strip = ROAMING_POLICIES[key]?.stripOnPublish;
  let published = value;
  if (strip?.length && value && typeof value === "object" && !Array.isArray(value)) {
    const clone = { ...(value as Record<string, unknown>) };
    for (const field of strip) delete clone[field];
    published = clone;
  }
  void commitDomainEvents({ type: "preference.changed", payload: { key, value: published } }).catch(
    (error) => {
      console.error(`[roaming-preferences] failed to log ${key} change`, error);
    },
  );
}

type PreferenceRow = { key: string; valueJson: string };

/** Projection value + device policy → the JSON this device should cache. */
function mergeForDevice(
  remoteJson: string,
  currentJson: string | null,
  deviceLocalFields: readonly string[],
): string | null {
  try {
    const remote = JSON.parse(remoteJson) as Record<string, unknown>;
    if (deviceLocalFields.length > 0 && currentJson) {
      const current = JSON.parse(currentJson) as Record<string, unknown>;
      for (const field of deviceLocalFields) {
        if (field in current) remote[field] = current[field];
      }
    }
    return JSON.stringify(remote);
  } catch {
    // A malformed projection value must not clobber a working local cache.
    return null;
  }
}

/** Key-order-independent JSON identity, so serializer differences (serde vs
 * JSON.stringify) never read as a preference change. Null for non-JSON. */
function canonical(json: string | null): string | null {
  if (json === null) return null;
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sortKeys(v)]),
      );
    }
    return value;
  };
  try {
    return JSON.stringify(sortKeys(JSON.parse(json)));
  } catch {
    return null;
  }
}

/** Projection → KV. Returns the keys whose cached value actually moved. */
async function overlayFromProjection(): Promise<string[]> {
  const rows = await invoke<PreferenceRow[]>("preferences_load_all");
  const changed: string[] = [];
  for (const row of rows) {
    const policy = ROAMING_POLICIES[row.key];
    if (!policy) continue;
    const current = localKV.getItem(row.key);
    const next = mergeForDevice(row.valueJson, current, policy.deviceLocalFields);
    if (next === null || canonical(next) === canonical(current)) continue;
    localKV.setItem(row.key, next);
    changed.push(row.key);
  }
  return changed;
}

/**
 * Boot overlay — MUST run after `hydrateLocalStore` and before the module
 * graph that seeds settings atoms synchronously (see main.tsx ordering).
 */
export async function hydrateRoamingPreferences(): Promise<void> {
  if (!isTauri()) return;
  try {
    await overlayFromProjection();
  } catch (error) {
    console.error("[roaming-preferences] boot overlay failed; using device-local values", error);
  }
}

/**
 * Post-pull refresh: re-overlay and tell mounted consumers which namespaces
 * moved. Called by the sync scheduler after a merge lands remote events.
 */
export async function refreshRoamingPreferences(): Promise<void> {
  if (!isTauri()) return;
  try {
    const changed = await overlayFromProjection();
    if (changed.length > 0) {
      emitAppEvent("roaming-preferences-changed", { keys: changed });
    }
  } catch (error) {
    console.error("[roaming-preferences] post-pull refresh failed", error);
  }
}
