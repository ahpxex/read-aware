/**
 * The credential seam — encrypted at rest, reachable only over IPC.
 *
 * Shaped exactly like `localKV` and for the same reason: the config readers
 * (`getAIConfig`) are synchronous and are called per request by the agent
 * runtime, so values are hydrated once before the app module graph evaluates
 * and read from memory afterwards. Writes update the snapshot immediately and
 * persist through IPC.
 *
 * This replaces a plain `localStorage` slot, which was readable by any script
 * in the webview realm — every installed plugin included — and made "keep the
 * secret out of SQLite" exactly backwards. Storage now lives behind
 * `secrets.rs` (AES-256-GCM with a separate `0600` key file); read its header
 * for why the OS keychain is deliberately not used.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./environment";

/**
 * Secrets the app stores — two audited families. The `ai-api-key` family:
 * the legacy single slot plus one slot per provider (`ai-api-key.<provider>`),
 * so switching providers never clobbers another provider's key. The `sync.`
 * family: the relay session token and the passphrase-derived E2E master key
 * (base64) — the "encryption_key_ref" that `sync_profile` points at, kept out
 * of SQLite per the schema's key-material policy. Hydration discovers live
 * slots by prefix (`secret_keys`); plugin credentials go through their own
 * async helpers below and never enter this snapshot.
 */
export type SecretKey =
  | "ai-api-key"
  | `ai-api-key.${string}`
  | "sync.session"
  | "sync.master-key";
const SECRET_PREFIXES = ["ai-api-key", "sync."] as const;

/** Where older builds kept the key in the clear; migrated away on first boot. */
const LEGACY_AI_KEY_STORAGE_KEY = "read-aware-ai-key";

const snapshot = new Map<SecretKey, string>();
let hydrated = false;

/**
 * Fill the in-memory snapshot, and move any key an older build left in
 * localStorage into the encrypted store. Local decryption only — no user
 * interaction, so boot can await it outright.
 */
export async function hydrateSecrets(): Promise<void> {
  if (!isTauri()) {
    hydrated = true;
    return;
  }
  try {
    // One-time move out of the webview-readable slot. The old copy is cleared
    // only after the encrypted write succeeds, so a failure here retries next
    // launch rather than losing the user's key.
    const legacy = localStorage.getItem(LEGACY_AI_KEY_STORAGE_KEY);
    if (legacy) {
      await invoke("secret_set", { key: "ai-api-key", value: legacy });
      localStorage.removeItem(LEGACY_AI_KEY_STORAGE_KEY);
      console.info("[secrets] moved the API key out of localStorage into encrypted storage");
    }
    for (const prefix of SECRET_PREFIXES) {
      const keys = await invoke<string[]>("secret_keys", { prefix });
      for (const key of keys) {
        // Per-key isolation: one unreadable secret (e.g. sealed under a lost
        // key file) must not abort loading every credential after it.
        try {
          const value = await invoke<string | null>("secret_get", { key });
          if (value) snapshot.set(key as SecretKey, value);
        } catch (error) {
          console.error(`[secrets] "${key}" is unreadable; skipping`, error);
        }
      }
    }
  } catch (error) {
    console.error("[secrets] hydrate failed; the app starts without stored credentials", error);
  }
  hydrated = true;
}

export function getSecret(key: SecretKey): string {
  if (!hydrated) {
    console.warn(`[secrets] read of "${key}" before hydration; returning empty`);
  }
  return snapshot.get(key) ?? "";
}

export function setSecret(key: SecretKey, value: string): void {
  if (!value) {
    deleteSecret(key);
    return;
  }
  snapshot.set(key, value);
  if (!isTauri()) return;
  void invoke("secret_set", { key, value }).catch((error) => {
    console.error(`[secrets] failed to persist "${key}"`, error);
  });
}

export function deleteSecret(key: SecretKey): void {
  snapshot.delete(key);
  if (!isTauri()) return;
  void invoke("secret_delete", { key }).catch((error) => {
    console.error(`[secrets] failed to delete "${key}"`, error);
  });
}

// ─── Plugin-scoped secrets ───────────────────────────────────────────────────
//
// Same encrypted store, namespaced per plugin (`plugin.<id>.<key>`), but
// ASYNC and snapshot-free: plugin tokens are read at use time, not per
// request on the hot path. Values live outside SQLite and outside backups,
// and survive uninstall — a reinstall finds its credentials again, mirroring
// how the plugin KV behaves.

function pluginSecretKey(pluginId: string, key: string): string {
  return `plugin.${pluginId}.${key}`;
}

export async function getPluginSecret(pluginId: string, key: string): Promise<string | null> {
  if (!isTauri()) throw new Error("secrets require the desktop app");
  return (await invoke<string | null>("secret_get", { key: pluginSecretKey(pluginId, key) })) ?? null;
}

export async function setPluginSecret(
  pluginId: string,
  key: string,
  value: string,
): Promise<void> {
  if (!isTauri()) throw new Error("secrets require the desktop app");
  await invoke("secret_set", { key: pluginSecretKey(pluginId, key), value });
}

export async function deletePluginSecret(pluginId: string, key: string): Promise<void> {
  if (!isTauri()) throw new Error("secrets require the desktop app");
  await invoke("secret_delete", { key: pluginSecretKey(pluginId, key) });
}
