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
export type AppEventMap = {
  "book-opened": { book: { id: string; title: string; author?: string } };
  "book-closed": { bookId: string };
  "chapter-changed": { bookId: string; chapterHref: string | null };
  "reading-progress": { bookId: string; fraction: number };
  /** A book row was deleted (any path — shelf UI included). */
  "book-removed": { bookId: string };
  /** Library contents changed outside the controller (e.g. plugin import). */
  "library-changed": Record<string, never>;
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
      console.error(`[app-events] handler for "${event}" failed`, error);
    }
  }
}
