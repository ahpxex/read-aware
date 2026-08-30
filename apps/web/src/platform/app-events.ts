/**
 * The app-wide event bus for SESSION facts — runtime state of the open
 * reader and cross-feature notifications. Lives in platform/ so feature libs
 * (library-db, reader session) can emit without depending on consumers.
 * Handlers are isolated: one throwing never breaks the emitter or its peers.
 *
 * Domain facts do NOT go through here — they are domain events
 * (platform/domain-events.ts), which plugins observe via the in-app
 * broadcast under their canonical names.
 */
import { createLogger } from "./logger";

const log = createLogger("app-events");

export type AppEventMap = {
  "book-opened": { book: { id: string; title: string; author?: string } };
  "book-closed": { bookId: string };
  "chapter-changed": { bookId: string; chapterHref: string | null };
  "reading-progress": { bookId: string; fraction: number };
  /** A book row was deleted (any path — shelf UI included). */
  "book-removed": { bookId: string };
  /** Library contents changed outside the controller (e.g. plugin import). */
  "library-changed": Record<string, never>;
  /** A plugin's namespaced KV was written on the HOST side (settings change). */
  "plugin-storage-changed": { pluginId: string };
  /** A sync pull moved roaming preference namespaces (see platform/roaming-preferences). */
  "roaming-preferences-changed": { keys: string[] };
  /**
   * A sync pull merged events into the store — AI transcripts may have gained
   * or lost rows underneath any mounted conversation, which must reload rather
   * than keep saving its stale in-memory view.
   */
  "conversations-changed": Record<string, never>;
  /**
   * A durable local write (app_kv or the secret store) failed AFTER the
   * in-memory snapshot was rolled back. The UI layer toasts a generic
   * "couldn't save" so the user doesn't believe a lost change stuck; the raw
   * cause is already in the log at the failure site.
   */
  "local-write-failed": { kind: "kv" | "secret"; code?: string };
};

export type AppEventName = keyof AppEventMap;

const listeners = new Map<AppEventName, Set<(payload: never) => void>>();

export function onAppEvent<K extends AppEventName>(
  event: K,
  handler: (payload: AppEventMap[K]) => void,
): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as (payload: never) => void);
  return () => {
    set?.delete(handler as (payload: never) => void);
  };
}

export function emitAppEvent<K extends AppEventName>(event: K, payload: AppEventMap[K]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      (handler as (payload: AppEventMap[K]) => void)(payload);
    } catch (error) {
      log.error(`handler for "${event}" failed`, error);
    }
  }
}
