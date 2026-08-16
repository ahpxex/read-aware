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
 * associations, auto-update), shortcuts (platform-shaped), and the interface
 * language. Credentials DO roam, but only sealed — see "Roaming secrets"
 * below: plaintext never enters the log or any queryable table.
 */
import { invoke } from "@tauri-apps/api/core";
import { emitAppEvent } from "./app-events";
import { commitDomainEvents } from "./domain-events";
import { isTauri } from "./environment";
import { localKV } from "./local-store";
import {
  deleteSecret,
  getSecret,
  listSecretSlots,
  setSecret,
  type SecretKey,
} from "./secret-store";
import { fromBase64, openSecret, sealSecret } from "./sync-envelope";

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
  // Provider/model choices roam as plain KV; the API key roams SEPARATELY as
  // a sealed secret (below) — stripped from what we publish here, and
  // preserved locally on overlay for legacy blobs that still carry it inline.
  "read-aware-ai-config": { deviceLocalFields: ["apiKey"], stripOnPublish: ["apiKey"] },
};

export const ROAMING_PREFERENCE_KEYS = Object.keys(ROAMING_POLICIES);

export type RoamingPreferenceKey = keyof typeof ROAMING_POLICIES;

// ── Roaming secrets ──────────────────────────────────────────────────────────
//
// Credentials roam too — the passphrase-derived master key already end-to-end
// encrypts everything that leaves the device, so a device that can open the
// account's events can be trusted with its API keys. The difference from a
// plain preference is at-rest hygiene: the LOCAL event log is not encrypted,
// so the value is sealed with that same master key BEFORE the event is
// committed (`preference.changed` with key `secret:<slot>` and value
// `{sealed}` / null for deletion), and the overlay decrypts it straight into
// the OS-backed secret store — never into a queryable table.

const SECRET_EVENT_PREFIX = "secret:";

/** Slot prefixes allowed to roam. `sync.*` (session, master key) never does. */
const ROAMING_SECRET_SLOT_PREFIXES = ["ai-api-key"] as const;

const isRoamingSecretSlot = (slot: string): boolean =>
  ROAMING_SECRET_SLOT_PREFIXES.some((prefix) => slot.startsWith(prefix));

function masterKey(): Uint8Array | null {
  const b64 = getSecret("sync.master-key");
  return b64 ? fromBase64(b64) : null;
}

/**
 * Record a credential change in the log, sealed. A device that is not
 * connected has no master key and publishes nothing — `republishRoamingSecrets`
 * catches those up when an account connects.
 */
export function publishRoamingSecret(slot: SecretKey, value: string | null): void {
  if (!isTauri() || !isRoamingSecretSlot(slot)) return;
  const key = masterKey();
  if (!key) return;
  void commitDomainEvents({
    type: "preference.changed",
    payload: {
      key: `${SECRET_EVENT_PREFIX}${slot}`,
      value: value ? { sealed: sealSecret(key, slot, value) } : null,
    },
  }).catch((error) => {
    console.error(`[roaming-preferences] failed to log secret ${slot} change`, error);
  });
}

/**
 * Seal every locally-present roaming credential into the log — called right
 * after an account connects, so keys entered before sync existed (or before
 * this device joined the account) roam without waiting for their next edit.
 */
export function republishRoamingSecrets(): void {
  if (!isTauri()) return;
  for (const prefix of ROAMING_SECRET_SLOT_PREFIXES) {
    for (const slot of listSecretSlots(prefix)) {
      const value = getSecret(slot);
      if (value) publishRoamingSecret(slot, value);
    }
  }
}

/** Sealed projection row → this device's secret store. True if it moved. */
function overlaySecret(slot: string, valueJson: string): boolean {
  if (!isRoamingSecretSlot(slot)) return false;
  const key = masterKey();
  if (!key) return false;
  try {
    const parsed: unknown = JSON.parse(valueJson);
    const typedSlot = slot as SecretKey;
    if (parsed === null) {
      if (!getSecret(typedSlot)) return false;
      deleteSecret(typedSlot);
      return true;
    }
    const sealed = (parsed as { sealed?: unknown }).sealed;
    if (typeof sealed !== "string") return false;
    const value = openSecret(key, slot, sealed);
    if (getSecret(typedSlot) === value) return false;
    setSecret(typedSlot, value);
    return true;
  } catch (error) {
    // Sealed under a different passphrase epoch, or malformed: leave this
    // device's credential alone rather than clobbering it with garbage.
    console.warn(`[roaming-preferences] could not open roamed secret ${slot}`, error);
    return false;
  }
}

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

/** Projection → KV (and sealed rows → the secret store). Returns moved keys. */
async function overlayFromProjection(): Promise<string[]> {
  const rows = await invoke<PreferenceRow[]>("preferences_load_all");
  const changed: string[] = [];
  for (const row of rows) {
    if (row.key.startsWith(SECRET_EVENT_PREFIX)) {
      if (overlaySecret(row.key.slice(SECRET_EVENT_PREFIX.length), row.valueJson)) {
        changed.push(row.key);
      }
      continue;
    }
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
