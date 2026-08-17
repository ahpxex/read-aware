/**
 * The domain-event write seam (desktop).
 *
 * `domain_events` in SQLite is the append-only source of truth and the unit of
 * sync (CLAUDE.md > Memory and Context); the typed tables the app reads are
 * projections DERIVED from it. Persistence seams (library-db, annotation-db,
 * the reading-time tracker) state their intent as events and hand them to
 * `commitDomainEvents`; SQLite appends and applies them in one transaction.
 * Nothing in the app writes a projection row directly — the one exception is
 * book cover artwork, a local cache over object-storage content that is not a
 * domain fact and never enters the log.
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
import { createHlcClock } from "./hlc";
import { createLogger } from "./logger";

const log = createLogger("domain-events");

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
  "preference.changed": { type: "preference", idKey: "key" },
  "book.imported": { type: "book", idKey: "bookId" },
  "book.metadataEdited": { type: "book", idKey: "bookId" },
  "book.coverExtracted": { type: "book", idKey: "bookId" },
  "book.chapterDigested": { type: "book", idKey: "bookId" },
  "book.merged": { type: "book", idKey: "keepId" },
  "book.opened": { type: "book", idKey: "bookId" },
  "book.starred": { type: "book", idKey: "bookId" },
  "book.finished": { type: "book", idKey: "bookId" },
  "book.removed": { type: "book", idKey: "bookId" },
  "collection.created": { type: "collection", idKey: "collectionId" },
  "collection.renamed": { type: "collection", idKey: "collectionId" },
  "collection.removed": { type: "collection", idKey: "collectionId" },
  "book.addedToCollection": { type: "book", idKey: "bookId" },
  "book.removedFromCollection": { type: "book", idKey: "bookId" },
  "book.progressed": { type: "book", idKey: "bookId" },
  "book.timeRecorded": { type: "book", idKey: "bookId" },
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

const clock = createHlcClock();
let devicePromise: Promise<LocalDeviceInfo> | null = null;

function getDeviceInfo(): Promise<LocalDeviceInfo> {
  devicePromise ??= invoke<LocalDeviceInfo>("local_device_get").then((info) => {
    // Reseed past every stamp this device already persisted.
    clock.seed(info.lastHlcWallMs, info.lastHlcCounter);
    return info;
  });
  return devicePromise;
}

const nextHlc = (deviceId: string): HlcStamp => clock.next(deviceId);

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
        log.error(`broadcast listener for "${draft.type}" failed`, error);
      }
    }
  }
}

/**
 * Append events WITHOUT applying them to the projections.
 *
 * The one caller is genesis backfill, which synthesizes creation events for
 * pre-event-era rows whose state the projection already holds. Everything that
 * CHANGES state uses `commitDomainEvents`.
 */
export async function appendDomainEvents(drafts: DomainEventDraft[]): Promise<void> {
  if (!isTauri() || drafts.length === 0) return;
  const { deviceId } = await getDeviceInfo();
  const events = drafts.map((draft) => toEventRow(draft, deviceId));
  await invoke("append_events", { events });
}

/** What the store did with a commit — see the Rust `CommitReport`. */
export type CommitReport = { appended: number; applied: number };

/**
 * THE write path: hand the events to SQLite, which appends them to the log and
 * applies them to the projections in ONE transaction.
 *
 * Callers no longer write projection rows themselves. That used to be a dual
 * write — event fire-and-forget on one side, `library_put_book` and friends on
 * the other — which could leave the log and the tables disagreeing with no way
 * to notice. Now the tables are DERIVED: whatever this commits is what the app
 * will read back, and `rebuild_projections` can reproduce it from the log alone.
 *
 * Throws if the store rejects the batch (nothing lands), so callers surface a
 * real failure instead of showing a change that was never persisted.
 */
export async function commitDomainEvents(
  ...drafts: DomainEventDraft[]
): Promise<CommitReport> {
  if (drafts.length === 0) return { appended: 0, applied: 0 };
  if (!isTauri()) {
    // Browser shell (vite dev / Storybook): no store at all. Observers still
    // fire so UI wiring can be exercised, but nothing is persisted.
    broadcastDomainEvents(drafts);
    return { appended: 0, applied: 0 };
  }
  const { deviceId } = await getDeviceInfo();
  const events = drafts.map((draft) => toEventRow(draft, deviceId));
  const report = await invoke<CommitReport>("commit_events", { events });
  // Broadcast only after the write succeeded — in-app observers must never see
  // a change the store rejected.
  broadcastDomainEvents(drafts);
  return report;
}

/**
 * Merge remote HLC stamps into the local clock — the HLC "receive" rule,
 * called by the sync pull loop for every stamp BEFORE the events are applied.
 * Without it, a device whose wall clock lags a peer keeps minting stamps that
 * sort before events it has already merged, putting later local writes in the
 * causal past. (Across restarts the same guarantee comes from
 * `local_device_get` seeding from the whole log.)
 */
export function observeRemoteHlcStamps(stamps: HlcStamp[]): void {
  for (const stamp of stamps) clock.observe(stamp);
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
