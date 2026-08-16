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
import { localKV, onLocalKVWrite } from "./local-store";
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
type RoamingPolicy = {
  deviceLocalFields: readonly string[];
  stripOnPublish?: readonly string[];
};

const ROAMING_POLICIES: Record<string, RoamingPolicy> = {
  // App chrome theme (light/dark) + motion: identity-like, follows the user.
  // Reading APPEARANCE (reader typography, page color, content typography)
  // deliberately does NOT roam: each device's screen and posture want their
  // own type size, spacing, and page color — syncing them forces one
  // device's ergonomics onto another (the WeChat-Reading lesson).
  "read-aware-app-settings": { deviceLocalFields: [] },
  "read-aware-ai-preferences": { deviceLocalFields: [] },
  // Provider/model choices roam as plain KV; the API key roams SEPARATELY as
  // a sealed secret (below) — stripped from what we publish here, and
  // preserved locally on overlay for legacy blobs that still carry it inline.
  "read-aware-ai-config": { deviceLocalFields: ["apiKey"], stripOnPublish: ["apiKey"] },
  // The Context page's active thread: cross-device continuation — pick up on
  // the phone in the conversation the desktop was in.
  "read-aware-active-global-thread": { deviceLocalFields: [] },
};

/**
 * Namespace families where the concrete keys are dynamic. Plugin storage is
 * `read-aware-plugin.<id>.<key>` — a plugin's settings and small state roam
 * wholesale; anything a plugin must keep per-device belongs in its own
 * heuristics, not ours.
 */
const ROAMING_PREFIXES: ReadonlyArray<{ prefix: string; policy: RoamingPolicy }> = [
  { prefix: "read-aware-plugin.", policy: { deviceLocalFields: [] } },
];

function roamingPolicyFor(key: string): RoamingPolicy | null {
  const exact = ROAMING_POLICIES[key];
  if (exact) return exact;
  for (const { prefix, policy } of ROAMING_PREFIXES) {
    if (key.startsWith(prefix)) return policy;
  }
  return null;
}

export const ROAMING_PREFERENCE_KEYS = Object.keys(ROAMING_POLICIES);

export type RoamingPreferenceKey = string;

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
  const strip = roamingPolicyFor(key)?.stripOnPublish;
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

// ── The write seam ───────────────────────────────────────────────────────────
//
// Publishing is POLICY, not a call sites remember to make: every durable KV
// write flows through localKV, the listener below matches it against the
// roaming policies, and a matching write becomes its preference.changed
// event automatically. Save functions know nothing about sync. The overlay
// mutes the listener while it writes remote values back into KV — without
// that, every pull would echo its own contents straight back into the log.

let overlayMuted = false;

onLocalKVWrite((key, raw) => {
  if (overlayMuted || !isTauri()) return;
  if (!roamingPolicyFor(key)) return;
  if (raw === null) {
    publishRoamingPreference(key, null);
    return;
  }
  try {
    publishRoamingPreference(key, JSON.parse(raw));
  } catch {
    // Non-JSON KV values are not part of the roaming contract.
  }
});

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
function overlayRows(rows: PreferenceRow[]): string[] {
  const changed: string[] = [];
  overlayMuted = true;
  try {
    for (const row of rows) {
      if (row.key.startsWith(SECRET_EVENT_PREFIX)) {
        if (overlaySecret(row.key.slice(SECRET_EVENT_PREFIX.length), row.valueJson)) {
          changed.push(row.key);
        }
        continue;
      }
      const policy = roamingPolicyFor(row.key);
      if (!policy) continue;
      // A roamed deletion (value null) clears the local cache.
      if (row.valueJson === "null") {
        if (localKV.getItem(row.key) !== null) {
          localKV.removeItem(row.key);
          changed.push(row.key);
        }
        continue;
      }
      const current = localKV.getItem(row.key);
      const next = mergeForDevice(row.valueJson, current, policy.deviceLocalFields);
      if (next === null || canonical(next) === canonical(current)) continue;
      localKV.setItem(row.key, next);
      changed.push(row.key);
    }
  } finally {
    overlayMuted = false;
  }
  return changed;
}

/**
 * Backfill: local state the log has never seen gets its event. A namespace
 * saved BEFORE roaming existed (or before this build) has a KV value but no
 * projection row — without this pass it would never travel, because
 * publishing otherwise only fires on the next save. Row-presence is the
 * idempotency guard: committing applies the projection locally, so each
 * namespace backfills at most once. Same for credentials, gated on the
 * master key being present.
 */
function reconcileUnpublished(rows: PreferenceRow[]): void {
  const present = new Set(rows.map((row) => row.key));
  const publishIfLocal = (key: string) => {
    if (present.has(key)) return;
    const raw = localKV.getItem(key);
    if (!raw) return;
    try {
      publishRoamingPreference(key, JSON.parse(raw));
    } catch {
      // A malformed local blob is not worth replicating.
    }
  };
  for (const key of Object.keys(ROAMING_POLICIES)) publishIfLocal(key);
  for (const { prefix } of ROAMING_PREFIXES) {
    for (const suffix of Object.keys(localKV.entries(prefix))) {
      publishIfLocal(prefix + suffix);
    }
  }
  for (const prefix of ROAMING_SECRET_SLOT_PREFIXES) {
    for (const slot of listSecretSlots(prefix)) {
      if (present.has(`${SECRET_EVENT_PREFIX}${slot}`)) continue;
      const value = getSecret(slot);
      if (value) publishRoamingSecret(slot, value);
    }
  }
}

/**
 * Boot overlay — MUST run after `hydrateLocalStore` and before the module
 * graph that seeds settings atoms synchronously (see main.tsx ordering).
 * Overlay first (remote rows win), then backfill what the log has never seen.
 */
export async function hydrateRoamingPreferences(): Promise<void> {
  if (!isTauri()) return;
  try {
    const rows = await invoke<PreferenceRow[]>("preferences_load_all");
    overlayRows(rows);
    reconcileUnpublished(rows);
  } catch (error) {
    console.error("[roaming-preferences] boot overlay failed; using device-local values", error);
  }
}

/**
 * Post-pull refresh: re-overlay, tell mounted consumers which namespaces
 * moved, and backfill anything still unpublished (a namespace first touched
 * on a build older than this one). Called by the sync scheduler after a
 * merge lands remote events.
 */
export async function refreshRoamingPreferences(): Promise<void> {
  if (!isTauri()) return;
  try {
    const rows = await invoke<PreferenceRow[]>("preferences_load_all");
    const changed = overlayRows(rows);
    reconcileUnpublished(rows);
    if (changed.length > 0) {
      emitAppEvent("roaming-preferences-changed", { keys: changed });
    }
  } catch (error) {
    console.error("[roaming-preferences] post-pull refresh failed", error);
  }
}
