import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../../i18n";

/** Names for collections and secret keys: short, flat, no surprises. */
export const NAMESPACE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The app UI's current locale, normalized to a supported one. */
export function currentAppLocale(): string {
  return i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export function requireSecretKey(key: string): void {
  if (!NAMESPACE_KEY.test(String(key))) {
    throw new Error(`invalid secret key: ${String(key)}`);
  }
}

/** Sanitize a command's declared default shortcut; junk shapes become none. */
export function normalizeDefaultShortcut(
  raw: unknown,
): { key: string; mod?: boolean; alt?: boolean; shift?: boolean } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as { key?: unknown; mod?: unknown; alt?: unknown; shift?: unknown };
  if (typeof candidate.key !== "string" || !candidate.key.trim()) return undefined;
  const key = candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key;
  return {
    key,
    mod: candidate.mod === true || undefined,
    alt: candidate.alt === true || undefined,
    shift: candidate.shift === true || undefined,
  };
}

/**
 * KV namespace for a plugin. Exported so the sandbox host can ship the whole
 * namespace into the Worker at boot, keeping `storage.get()` synchronous there.
 */
export const pluginStoragePrefix = (pluginId: string) => `read-aware-plugin.${pluginId}.`;

export function guardMutationTree<T extends object>(
  value: T,
  assertActive: (operation: string) => void,
  path: string,
): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const operation = `${path}.${key}`;
      if (typeof entry === "function") {
        return [
          key,
          (...args: unknown[]) => {
            assertActive(operation);
            return entry(...args);
          },
        ];
      }
      if (entry && typeof entry === "object") {
        return [key, guardMutationTree(entry, assertActive, operation)];
      }
      return [key, entry];
    }),
  ) as T;
}

export function combinePluginSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  return AbortSignal.any(live);
}
