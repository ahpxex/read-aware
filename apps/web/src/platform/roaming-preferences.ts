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
 * - a local save writes KV and its event in ONE native transaction; a failed
 *   save rolls both back (the KV queue restores the optimistic value and
 *   emits `local-write-failed`), so KV never diverges from the log;
 * - boot overlays the projection onto KV before any settings module reads;
 * - a sync pull re-overlays and announces changed keys, so mounted UI
 *   follows a remote change without a restart.
 *
 * Deliberately NOT roaming: OS integration (launch at startup, file
 * associations, auto-update), shortcuts (platform-shaped), and the interface
 * language. Credentials DO roam, but only sealed — see "Roaming secrets"
 * below: plaintext never enters the log or any queryable table.
 */
import { flushRestoredCredentialPublications } from "./restored-credential-publication";
import { PluginPreferencePublication } from "./plugin-preference-publication";
import { causalActor, type DomainActor } from "./domain-actor";
import { errorCode } from "@read-aware/core";
import { waitForPluginDataUpdates, withPluginDataWrites } from "./plugin-data-access";
import { invoke } from "./ipc";
import { emitAppEvent } from "./app-events";
import { commitDomainEvents, type DomainEventDraft } from "./domain-events";
import { runDomainWrite } from "./domain-write-gate";
import { isTauri } from "./environment";
import { localKV, onLocalKVWrite, flushLocalKV, setLocalKVEventSource } from "./local-store";
import { isPluginScheduleStateKey } from "./plugin-local-state";
import { createLogger } from "./logger";
import {
  afterSecretWrites,
  deleteSecretAsync,
  getDurableSecret,
  getSecret,
  onLocalSecretWrite,
  setSecretAsync,
  type SecretKey,
} from "./secret-store";
import { fromBase64, openSecret } from "./sync-envelope";

const log = createLogger("roaming-preferences");

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
  // E-ink mode describes this device's panel, not the user: a BOOX must
  // not turn the desktop's animations and colors off. Never published, so a
  // device that has not chosen yet cannot adopt another device's choice.
  "read-aware-app-settings": { deviceLocalFields: ["eink"], stripOnPublish: ["eink"] },
  "read-aware-ai-preferences": { deviceLocalFields: [] },
  // Provider/model choices roam as plain KV; the API key roams SEPARATELY as
  // a sealed secret (below) — stripped from what we publish here, and
  // preserved locally on overlay for legacy blobs that still carry it inline.
  "read-aware-ai-config": { deviceLocalFields: ["apiKey"], stripOnPublish: ["apiKey"] },
  "read-aware-search-config": { deviceLocalFields: [], stripOnPublish: ["apiKey"] },
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
  // Host scheduler bookkeeping belongs to this device, unlike plugin preferences.
  if (isPluginScheduleStateKey(key)) return null;
  const exact = ROAMING_POLICIES[key];
  if (exact) return exact;
  for (const { prefix, policy } of ROAMING_PREFIXES) {
    if (key.startsWith(prefix)) return policy;
  }
  return null;
}

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
// the device secret store (AES-GCM sealed app_kv); plaintext is never logged.

const SECRET_EVENT_PREFIX = "secret:";

/** Slot prefixes allowed to roam. `sync.*` (session, master key) never does. */
const ROAMING_SECRET_SLOT_PREFIXES = ["ai-api-key"] as const;

const isRoamingSecretSlot = (slot: string): boolean =>
  ROAMING_SECRET_SLOT_PREFIXES.some((prefix) => slot.startsWith(prefix));

function masterKey(): Uint8Array | null {
  const b64 = getDurableSecret("sync.master-key");
  return b64 ? fromBase64(b64) : null;
}

/** Ordinary local writes atomically enqueue with the encrypted value in native
 * SQLite. Publication reads that current durable value, including deletions. */
function publishRoamingSecret(slot: SecretKey): void {
  if (!isTauri() || !isRoamingSecretSlot(slot)) return;
  void flushRestoredCredentialPublications().catch((error) => {
    log.error(`failed to publish credential slot ${slot}; durable marker retained`, error);
  });
}
onLocalSecretWrite(publishRoamingSecret);

async function enqueueCurrentCredentials(onlyUnpublished: boolean): Promise<void> {
  if (!isTauri()) return;
  await runDomainWrite(() =>
    afterSecretWrites(() => invoke("restored_credentials_enqueue_current", { onlyUnpublished })),
  );
  await flushRestoredCredentialPublications();
}

/** Explicit account connection republishes existing credentials for that account.
 * The native queue also retains deletions and survives process termination. */
export function republishRoamingSecrets(): Promise<void> {
  return enqueueCurrentCredentials(false);
}

/** Sealed projection row → this device's secret store. True if it moved. */
async function overlaySecret(slot: string, valueJson: string, origin: DomainActor): Promise<boolean> {
  return afterSecretWrites(async () => {
    if (!isRoamingSecretSlot(slot)) return false;
    try {
      const key = masterKey();
      if (!key) return false;
      const parsed: unknown = JSON.parse(valueJson);
      const typedSlot = slot as SecretKey;
      if (parsed === null) {
        if (!getSecret(typedSlot)) return false;
        await deleteSecretAsync(typedSlot, "remote", origin);
        return true;
      }
      const sealed = (parsed as { sealed?: unknown }).sealed;
      if (typeof sealed !== "string") return false;
      const value = openSecret(key, slot, sealed);
      if (getSecret(typedSlot) === value) return false;
      await setSecretAsync(typedSlot, value, "remote", origin);
      return true;
    } catch (error) {
      // Bad ciphertext preserves the old value; a failed write rolls back in
      // the secret queue. Neither is announced as a completed overlay.
      log.warn(`could not apply roamed secret ${slot}`, error);
      return false;
    }
  });
}

/** The `preference.changed` event for a local write of `raw` to a roaming
 * key, or null when the key does not roam here. Non-JSON KV values are outside
 * the roaming contract; stripped fields never enter the log. */
function preferenceDraft(key: RoamingPreferenceKey, raw: string | null, origin: DomainActor): DomainEventDraft | null {
  const policy = roamingPolicyFor(key);
  // A plugin namespace inside an update publishes through its own scope.
  if (!policy || PluginPreferencePublication.blocks(key)) return null;
  let value: unknown = null;
  if (raw !== null) {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (policy.stripOnPublish?.length && value && typeof value === "object" && !Array.isArray(value)) {
    const clone = { ...(value as Record<string, unknown>) };
    for (const field of policy.stripOnPublish) delete clone[field];
    value = clone;
  }
  return { type: "preference.changed", origin: causalActor(origin), payload: { key, value } };
}

/** Final accepted values use the same event log as ordinary preferences. A
 * failed append stays in this process's publication scope for a later save or
 * refresh to retry; remote overlays cannot replace it with an older projection. */
export function acceptPluginPreferencePublication(scope: PluginPreferencePublication): Promise<void> {
  return scope.accept(
    async (changes, sources) => {
      const events: import("./domain-events").DomainEventDraft[] = [];
      for (const [key, raw] of changes) {
        if (!roamingPolicyFor(key)) continue;
        try {
          events.push({
            type: "preference.changed",
            origin: sources.get(key),
            payload: { key, value: raw === null ? null : JSON.parse(raw) },
          });
        } catch {
          /* Non-JSON plugin KV is outside the existing roaming contract. */
        }
      }
      if (events.length && isTauri()) await commitDomainEvents(...events);
    },
    (error) => log.error(`failed to log accepted plugin ${scope.pluginId} preferences`, error),
  );
}

/** Log a KV value that is already durable but was never published (backfill).
 * No KV write is involved, so there is nothing to roll back: a failed append is
 * logged and retried by the next refresh's row-presence check. */
export function backfillRoamingPreference(
  key: RoamingPreferenceKey,
  raw: string,
  origin: DomainActor = "system",
): void {
  if (!isTauri()) return;
  const draft = preferenceDraft(key, raw, origin);
  if (!draft) return;
  void commitDomainEvents(draft).catch((error) =>
    log.error(`failed to backfill ${key}; retried on the next refresh`, error),
  );
}

// ── The write seam ───────────────────────────────────────────────────────────
//
// Publishing is POLICY, not a call sites remember to make: every local KV
// write asks this source for the events it must carry, and local-store
// commits them in the same native transaction as the KV bytes. Save functions
// know nothing about sync. Remote overlays are tagged before persistence and
// never ask — otherwise every pull would echo its contents back into the log.

setLocalKVEventSource((entries, actor) => {
  if (!isTauri()) return [];
  return [...entries].flatMap(([key, raw]) => preferenceDraft(key, raw, actor) ?? []);
});

// A plugin namespace inside an update scope defers publication to acceptance;
// its scope records only exact durable receipts.
onLocalKVWrite((key, raw, origin, actor) => {
  if (origin === "remote" || !isTauri() || !roamingPolicyFor(key)) return;
  PluginPreferencePublication.record(key, raw, actor);
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
async function overlayRows(rows: PreferenceRow[], origin: DomainActor): Promise<string[]> {
  await afterSecretWrites(() => {});
  const changed: string[] = [];
  for (const row of rows) {
    if (row.key.startsWith(SECRET_EVENT_PREFIX)) {
      if (await overlaySecret(row.key.slice(SECRET_EVENT_PREFIX.length), row.valueJson, origin)) {
        changed.push(row.key);
      }
      continue;
    }
    const policy = roamingPolicyFor(row.key);
    if (!policy) continue;
    // A roamed deletion (value null) clears the local cache.
    if (row.valueJson === "null") {
      if (localKV.getItem(row.key) !== null) {
        localKV.removeItem(row.key, "remote", origin);
        changed.push(row.key);
      }
      continue;
    }
    const current = localKV.getItem(row.key);
    const next = mergeForDevice(row.valueJson, current, policy.deviceLocalFields);
    if (next === null || canonical(next) === canonical(current)) continue;
    localKV.setItem(row.key, next, "remote", origin);
    changed.push(row.key);
  }
  return changed;
}

/** A concurrent plugin migration must not consume a remote settings save into
 * its rollback baseline halfway through. Retry from the current projection once
 * the update settles, and keep admission until queued remote KV writes settle. */
async function loadAndOverlayRows(origin: DomainActor): Promise<{ rows: PreferenceRow[]; changed: string[] }> {
  while (true) {
    await PluginPreferencePublication.flushAccepted();
    await flushRestoredCredentialPublications();
    const rows = await invoke<PreferenceRow[]>("preferences_load_all");
    const eligible = rows.filter((row) => !PluginPreferencePublication.suppressesOverlay(row.key));
    if (eligible.length !== rows.length)
      log.warn("Skipped plugin preferences awaiting update recovery or accepted publication");
    const ids = eligible.flatMap((row) => /^read-aware-plugin\.([a-z0-9-]+)\./.exec(row.key)?.[1] ?? []);
    try {
      return await withPluginDataWrites(ids, async () => {
        // Even a later overlay failure must drain every earlier native write.
        const drain = async () => {
          const results = await Promise.allSettled(
            [...new Set(ids)].map((id) => flushLocalKV(`read-aware-plugin.${id}.`)),
          );
          return results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        };
        let changed: string[];
        try {
          changed = await overlayRows(eligible, origin);
        } catch (error) {
          const failure = await drain();
          if (failure) log.warn("Plugin preference drain also failed", failure.reason);
          throw error;
        }
        const failure = await drain();
        if (failure) throw failure.reason;
        return { rows, changed };
      });
    } catch (error) {
      if (errorCode(error) !== "plugin/data-busy") throw error;
      await waitForPluginDataUpdates(ids);
    }
  }
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
    // A malformed (non-JSON) local blob yields no draft and is not replicated.
    if (raw) backfillRoamingPreference(key, raw);
  };
  for (const key of Object.keys(ROAMING_POLICIES)) publishIfLocal(key);
  for (const { prefix } of ROAMING_PREFIXES) {
    for (const suffix of Object.keys(localKV.entries(prefix))) {
      publishIfLocal(prefix + suffix);
    }
  }
  // Native row-presence check avoids a stale JS projection snapshot deciding
  // which credentials to backfill. Existing pending local changes drained first.
  void enqueueCurrentCredentials(true).catch((error) => log.error("Credential backfill remains pending", error));
}

/**
 * Boot overlay — MUST run after `hydrateLocalStore` and before the module
 * graph that seeds settings atoms synchronously (see main.tsx ordering).
 * Overlay first (remote rows win), then backfill what the log has never seen.
 */
export async function hydrateRoamingPreferences(origin: DomainActor = "system"): Promise<void> {
  origin = causalActor(origin);
  if (!isTauri()) return;
  try {
    const { rows } = await loadAndOverlayRows(origin);
    reconcileUnpublished(rows);
  } catch (error) {
    log.error("boot overlay failed; using device-local values", error);
  }
}

/**
 * Post-pull refresh: re-overlay, tell mounted consumers which namespaces
 * moved, and backfill anything still unpublished (a namespace first touched
 * on a build older than this one). Called by the sync scheduler after a
 * merge lands remote events.
 */
export async function refreshRoamingPreferences(origin: DomainActor = "system"): Promise<void> {
  origin = causalActor(origin);
  if (!isTauri()) return;
  try {
    const { rows, changed } = await loadAndOverlayRows(origin);
    reconcileUnpublished(rows);
    if (changed.length > 0) {
      emitAppEvent("roaming-preferences-changed", { keys: changed }, origin);
    }
  } catch (error) {
    log.error("post-pull refresh failed", error);
  }
}
