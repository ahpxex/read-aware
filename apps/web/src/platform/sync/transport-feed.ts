/**
 * Adapts a plugin sync transport (dumb remote storage of per-device event
 * batches — see `PluginSyncTransportSession` in @read-aware/plugin-types) to
 * the engine's `SyncRelayApi` (a single monotonically increasing pull
 * cursor).
 *
 * The relay assigns a server sequence on arrival; dumb storage cannot. The
 * bridge is a locally persisted, append-only JOURNAL of discovered batches:
 * the pull cursor is a position in that journal. The journal records
 * EXISTENCE (extended and saved before anything is served), never
 * consumption — consumption is the engine's cursor, committed after apply.
 * That split keeps every crash window safe:
 *
 *  - crash after journal save, before apply → same batches re-served, same
 *    positions (the journal is append-only, so positions never move);
 *  - journal lost entirely (KV wiped) → the cursor points past the rebuilt
 *    journal's end; the feed clamps to 0 and re-serves everything, and
 *    `apply_remote_events` drops the duplicates (INSERT OR IGNORE by event
 *    id). Losing bookkeeping costs a re-download, never data.
 *
 * Own-device batches are listed in the journal (positions must be identical
 * on every device-independent rebuild) but skipped when serving — their
 * events are already in the local log.
 */
import type { PluginSyncTransportSession, SealedEventWire } from "@read-aware/plugin-types";
import type { SyncRelayApi } from "./sync-engine";

/** Persisted journal shape. `order` is append-only; `devices` interns ids. */
export type TransportFeedJournal = {
  endpointId: string;
  devices: string[];
  /** `[deviceIndex, batchIndex]` in discovery order. */
  order: Array<[number, number]>;
};

export type TransportFeedStore = {
  load(): TransportFeedJournal | null;
  save(journal: TransportFeedJournal): void;
};

/** Synthetic per-event sequence recorded as push bookkeeping (`remote_id`).
 *  Diagnostic only — pull ordering comes from the journal, never from this. */
const BATCH_SEQ_STRIDE = 1_000_000;

export type TransportFeedOptions = {
  /** Resolve the live session (re-resolved per operation so a restarted
   *  plugin worker heals without rebuilding the engine). */
  session: () => Promise<PluginSyncTransportSession>;
  /** This device's id — names the batch directory pushes land in. */
  deviceId: string;
  /** The endpoint the connection ritual bound; journals from any other
   *  endpoint are stale bookkeeping and reset. */
  endpointId: string;
  store: TransportFeedStore;
};

export function createTransportFeedRelay(options: TransportFeedOptions): SyncRelayApi {
  const { deviceId, endpointId, store } = options;

  /** Next batch index for our own pushes; null = derive from a fresh remote
   *  listing. Reset on any push failure so a collision or lost ack re-syncs
   *  with what the remote actually holds. */
  let ownNext: number | null = null;

  function loadJournal(): TransportFeedJournal {
    const journal = store.load();
    if (journal && journal.endpointId === endpointId) return journal;
    return { endpointId, devices: [], order: [] };
  }

  /** Per-device batch counts as the journal currently knows them. */
  function knownCounts(journal: TransportFeedJournal): Map<number, number> {
    const counts = new Map<number, number>();
    for (const [device] of journal.order) {
      counts.set(device, (counts.get(device) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Bring the journal up to date with the remote listing. New batches append
   * in deterministic order (device id ascending, batch index ascending), so
   * two extensions from the same remote state produce the same journal.
   */
  async function extendJournal(
    session: PluginSyncTransportSession,
  ): Promise<TransportFeedJournal> {
    const journal = loadJournal();
    const listing = await session.listEventBatches();
    const counts = knownCounts(journal);
    const deviceIndex = new Map(journal.devices.map((id, index) => [id, index]));
    let grew = false;
    for (const remote of [...listing].sort((a, b) =>
      a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0,
    )) {
      let index = deviceIndex.get(remote.deviceId);
      if (index === undefined) {
        index = journal.devices.length;
        journal.devices.push(remote.deviceId);
        deviceIndex.set(remote.deviceId, index);
      }
      const known = counts.get(index) ?? 0;
      for (let batch = known; batch < remote.count; batch += 1) {
        journal.order.push([index, batch]);
        grew = true;
      }
    }
    if (grew) store.save(journal);
    return journal;
  }

  return {
    async pushEvents(events: SealedEventWire[]): Promise<Record<string, number>> {
      const session = await options.session();
      if (ownNext === null) {
        const listing = await session.listEventBatches();
        ownNext = listing.find((entry) => entry.deviceId === deviceId)?.count ?? 0;
      }
      const index = ownNext;
      try {
        await session.putEventBatch(deviceId, index, events);
      } catch (error) {
        // Whatever went wrong (collision, network, lost ack), the remote's
        // truth is the listing — re-derive before the retry.
        ownNext = null;
        throw error;
      }
      ownNext = index + 1;
      return Object.fromEntries(
        events.map((event, position) => [event.id, index * BATCH_SEQ_STRIDE + position]),
      );
    },

    async pullEvents(
      after: number,
      limit: number,
    ): Promise<{ events: SealedEventWire[]; next: number }> {
      const session = await options.session();
      let journal = loadJournal();
      let position = after < 0 ? 0 : after;
      const events: SealedEventWire[] = [];
      // Whole batches only — the cursor is batch-granular. A page must reach
      // `limit` whenever more data exists: the engine reads a short page as
      // the end of the feed. So serve from the journal first, and before ever
      // returning a short page, refresh the journal from the remote listing
      // once — the genuinely-final page is the one that stays short even
      // against a fresh listing.
      let listed = false;
      for (;;) {
        while (position < journal.order.length && events.length < limit) {
          const [device, batch] = journal.order[position];
          if (journal.devices[device] !== deviceId) {
            events.push(...(await session.getEventBatch(journal.devices[device], batch)));
          }
          position += 1;
        }
        if (events.length >= limit || listed) break;
        journal = await extendJournal(session);
        listed = true;
        // Past the end even after a fresh listing: the journal was lost and
        // rebuilt shorter. Re-serve from the start; apply is idempotent.
        if (position > journal.order.length) position = 0;
      }
      return { events, next: position };
    },

    async putBlob(key, bytes) {
      await (await options.session()).putBlob(key, bytes);
    },
    async getBlob(key) {
      return (await options.session()).getBlob(key);
    },
    async putBlobPart(key, index, parts, bytes) {
      await (await options.session()).putBlobPart(key, index, parts, bytes);
    },
    async commitBlob(key, parts) {
      await (await options.session()).commitBlob(key, parts);
    },
    async getBlobPart(key, index) {
      return (await options.session()).getBlobPart(key, index);
    },
  };
}
