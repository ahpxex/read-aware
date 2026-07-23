/**
 * The domain-event append seam (desktop).
 *
 * `domain_events` in SQLite is the append-only source of truth and the unit of
 * sync (CLAUDE.md > Memory and Context); the typed tables the app reads are
 * projections. Persistence seams (library-db, annotation-db, the reading-time
 * tracker) DUAL-WRITE through here: event first, projection second, so the log
 * stays a superset of what the projections show.
 *
 * Envelope filling lives here: event id, HLC stamp, actor, aggregate routing.
 * The HLC is monotonic within a session and reseeds from the highest persisted
 * stamp at boot (`local_device_get`), so a wall clock stepping backwards across
 * restarts can never mint a duplicate stamp.
 *
 * Desktop-only: outside Tauri (vite dev / Storybook) every append is a no-op —
 * the browser shell has no event log, and its IndexedDB paths are dev scaffolding.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  DomainEvent,
  DomainEventEnvelope,
  DomainEventType,
  EventOrigin,
  HlcStamp,
} from "@read-aware/core";
import { isTauri } from "./environment";

/**
 * What a call site provides: the typed event minus everything this module
 * fills in. `createdAt` is only passed by genesis backfill (historical rows).
 * `origin` defaults to `"user"`; seams reachable by the agent runtime or the
 * plugin data API thread the caller's origin through.
 */
export type DomainEventDraft = DomainEvent extends infer E
  ? E extends DomainEventEnvelope<infer T, infer P>
    ? { type: T; payload: P; createdAt?: string; origin?: EventOrigin }
    : never
  : never;

/**
 * Aggregate routing: which projection object an event is "about", mirrored to
 * the `aggregate_type`/`aggregate_id` columns for per-object history queries.
 * Exhaustive over the event catalog — adding a variant without routing it is a
 * compile error. `null` = no single aggregate (e.g. profile).
 */
const AGGREGATE_ROUTES: Record<DomainEventType, { type: string; idKey: string } | null> = {
  "book.imported": { type: "book", idKey: "bookId" },
  "book.metadataEdited": { type: "book", idKey: "bookId" },
  "book.coverExtracted": { type: "book", idKey: "bookId" },
  "book.opened": { type: "book", idKey: "bookId" },
  "book.starred": { type: "book", idKey: "bookId" },
  "book.removed": { type: "book", idKey: "bookId" },
  "collection.created": { type: "collection", idKey: "collectionId" },
  "collection.renamed": { type: "collection", idKey: "collectionId" },
  "collection.removed": { type: "collection", idKey: "collectionId" },
  "book.addedToCollection": { type: "book", idKey: "bookId" },
  "book.removedFromCollection": { type: "book", idKey: "bookId" },
  "reading.progressed": { type: "book", idKey: "bookId" },
  "reading.timeRecorded": { type: "book", idKey: "bookId" },
  "highlight.created": { type: "highlight", idKey: "highlightId" },
  "highlight.recolored": { type: "highlight", idKey: "highlightId" },
  "highlight.removed": { type: "highlight", idKey: "highlightId" },
  "note.created": { type: "note", idKey: "noteId" },
  "note.updated": { type: "note", idKey: "noteId" },
  "note.removed": { type: "note", idKey: "noteId" },
  "ask.recorded": { type: "ask", idKey: "askId" },
  "ask.removed": { type: "ask", idKey: "askId" },
  "aiConversation.started": { type: "conversation", idKey: "conversationId" },
  "aiMessage.appended": { type: "conversation", idKey: "conversationId" },
  "aiMessage.removed": { type: "conversation", idKey: "conversationId" },
  "aiConversation.cleared": { type: "conversation", idKey: "conversationId" },
  "profile.updated": null,
  "entity.resolved": { type: "entity", idKey: "entityId" },
  "entity.merged": { type: "entity", idKey: "keepId" },
  "memory.promoted": { type: "memory", idKey: "memoryId" },
  "memory.revised": { type: "memory", idKey: "memoryId" },
  "memory.superseded": { type: "memory", idKey: "memoryId" },
  "memory.feedback": { type: "memory", idKey: "memoryId" },
  "memory.forgotten": { type: "memory", idKey: "memoryId" },
};

/** Wire shape of the Rust `EventRow` (camelCase serde). */
type EventRowWire = {
  id: string;
  type: string;
  hlc: HlcStamp;
  aggregateType?: string;
  aggregateId?: string;
  origin?: string;
  createdAt?: string;
  payload: unknown;
};

type LocalDeviceInfo = {
  deviceId: string;
  lastHlcWallMs: number | null;
  lastHlcCounter: number | null;
};

const clock = { wallMs: 0, counter: 0 };
let devicePromise: Promise<LocalDeviceInfo> | null = null;

function getDeviceInfo(): Promise<LocalDeviceInfo> {
  devicePromise ??= invoke<LocalDeviceInfo>("local_device_get").then((info) => {
    // Reseed past every stamp this device already persisted.
    clock.wallMs = Math.max(clock.wallMs, info.lastHlcWallMs ?? 0);
    if (clock.wallMs === info.lastHlcWallMs) {
      clock.counter = Math.max(clock.counter, (info.lastHlcCounter ?? -1) + 1);
    }
    return info;
  });
  return devicePromise;
}

function nextHlc(deviceId: string): HlcStamp {
  const now = Date.now();
  if (now > clock.wallMs) {
    clock.wallMs = now;
    clock.counter = 0;
  } else {
    clock.counter += 1;
  }
  return { wallMs: clock.wallMs, counter: clock.counter, deviceId };
}

function toEventRow(draft: DomainEventDraft, deviceId: string): EventRowWire {
  const route = AGGREGATE_ROUTES[draft.type];
  const aggregateId = route
    ? (draft.payload as Record<string, unknown>)[route.idKey]
    : undefined;
  return {
    id: crypto.randomUUID(),
    type: draft.type,
    hlc: nextHlc(deviceId),
    aggregateType: route?.type,
    aggregateId: typeof aggregateId === "string" ? aggregateId : undefined,
    origin: draft.origin,
    createdAt: draft.createdAt,
    payload: draft.payload,
  };
}

// --- In-app broadcast (the observation seam over the same vocabulary) --------

/**
 * A just-emitted domain event as in-app observers (the plugin runtime's domain
 * subscriptions) see it: the canonical type + payload with origin and display
 * time, minus persistence internals (HLC, ids). Broadcast happens on the UX
 * emit path only — genesis backfill replays history and must not fire live
 * observers.
 */
export type DomainEventBroadcast = {
  [K in DomainEventType]: {
    type: K;
    payload: Extract<DomainEvent, { type: K }>["payload"];
    createdAt: string;
    origin: EventOrigin;
  };
}[DomainEventType];

const domainListeners = new Set<(event: DomainEventBroadcast) => void>();

/** Observe every UX-emitted domain event; returns the unsubscribe. */
export function onDomainEventBroadcast(
  listener: (event: DomainEventBroadcast) => void,
): () => void {
  domainListeners.add(listener);
  return () => {
    domainListeners.delete(listener);
  };
}

function broadcastDomainEvents(drafts: DomainEventDraft[]): void {
  if (domainListeners.size === 0) return;
  const now = new Date().toISOString();
  for (const draft of drafts) {
    const event = {
      type: draft.type,
      payload: draft.payload,
      createdAt: draft.createdAt ?? now,
      origin: draft.origin ?? "user",
    } as DomainEventBroadcast;
    for (const listener of [...domainListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[domain-events] broadcast listener for "${draft.type}" failed`, error);
      }
    }
  }
}

/**
 * Append events to the log, throwing on failure. Use where the caller owns the
 * outcome (genesis backfill); UX write paths use `emitDomainEvents` instead.
 */
export async function appendDomainEvents(drafts: DomainEventDraft[]): Promise<void> {
  if (!isTauri() || drafts.length === 0) return;
  const { deviceId } = await getDeviceInfo();
  const events = drafts.map((draft) => toEventRow(draft, deviceId));
  await invoke("append_events", { events });
}

/**
 * Best-effort append for UX write paths: a failed log write must not break the
 * user's action (the projection write still lands), so failures are logged and
 * swallowed. The boot-time genesis reconciliation re-synthesizes missed
 * CREATION events later; missed mutation events are accepted drift until the
 * projections are themselves replayed from the log.
 */
export function emitDomainEvents(...drafts: DomainEventDraft[]): void {
  broadcastDomainEvents(drafts);
  void appendDomainEvents(drafts).catch((error) => {
    console.error("[domain-events] append failed; projections now lead the log", error);
  });
}

/**
 * Aggregate ids already covered by any of the given event types. Backs genesis
 * reconciliation (which projection rows still need a creation event?).
 */
export async function listEventAggregateIds(types: DomainEventType[]): Promise<Set<string>> {
  if (!isTauri()) return new Set();
  const ids = await invoke<string[]>("list_event_aggregate_ids", { types });
  return new Set(ids);
}
