/**
 * The app-wide event bus — the observation seam core code emits into and the
 * plugin runtime subscribes through. Lives in platform/ so feature libs
 * (annotation-db, reader session) can emit without depending on the plugins
 * feature. Handlers are isolated: one throwing never breaks the emitter or
 * its peers.
 */
import type { Annotation } from "../features/annotations/lib/annotation-types";

export type AppEventMap = {
  "book-opened": { book: { id: string; title: string; author?: string } };
  "book-closed": { bookId: string };
  "chapter-changed": { bookId: string; chapterHref: string | null };
  "reading-progress": { bookId: string; fraction: number };
  "annotation-created": { annotation: Annotation };
  "annotation-deleted": { id: string };
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
