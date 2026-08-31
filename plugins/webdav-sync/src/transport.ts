/**
 * The `sync:transport` session over a WebDAV folder — pure carrier logic.
 * Everything that crosses here is ciphertext the host sealed; this module's
 * whole responsibility is the remote layout (see layout.ts) and the contract
 * semantics the host's feed adapter depends on:
 *
 *  - batches per device are dense and immutable (create-only PUT; a retry
 *    after a lost ack becomes the NEXT index once the listing is re-read,
 *    which duplicates events — harmless, merge is idempotent by event id);
 *  - `putMetaIfAbsent` is first-writer-wins;
 *  - `commitBlob` refuses to write the descriptor while any part is missing,
 *    so a torn upload can never look complete.
 */
import type {
  PluginSyncBatchListing,
  PluginSyncTransportSession,
  SealedEventWire,
} from "@read-aware/plugin-types";
import type { WebdavClient } from "./client";
import {
  batchFile,
  blobMainPath,
  blobPartPath,
  blobPartsDir,
  BLOBS_DIR,
  deviceDir,
  EVENTS_DIR,
  metaPath,
  parseBatchName,
  parsePartName,
} from "./layout";

/** Sealed-envelope shape check — a foreign file in the events tree (or a
 *  torn write on a sloppy server) must not poison the pull pipeline. */
function isSealedEvent(value: unknown): value is SealedEventWire {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  const hlc = event.hlc as Record<string, unknown> | null | undefined;
  return (
    typeof event.id === "string" &&
    typeof event.nonce === "string" &&
    typeof event.ciphertext === "string" &&
    typeof hlc === "object" &&
    hlc !== null &&
    typeof hlc.wallMs === "number" &&
    typeof hlc.counter === "number" &&
    typeof hlc.deviceId === "string"
  );
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

export function createWebdavTransportSession(options: {
  client: WebdavClient;
  endpointId: string;
}): PluginSyncTransportSession {
  const { client, endpointId } = options;

  return {
    endpointId,

    probe: () => client.probe(),

    getMeta: (name) => client.get(metaPath(name)),

    async putMetaIfAbsent(name, bytes) {
      const path = metaPath(name);
      await client.ensureCollections(path.slice(0, -1));
      const outcome = await client.put(path, bytes, { ifNoneMatch: true });
      if (outcome === "exists") return "exists";
      // Servers that ignore If-None-Match overwrite instead of refusing; the
      // read-back tells whether OUR bytes are what actually stands. (Equal
      // bytes from a lost race are indistinguishable — and interchangeable.)
      const stored = await client.get(path);
      return stored && bytesEqual(stored, bytes) ? "stored" : "exists";
    },

    async listEventBatches(): Promise<PluginSyncBatchListing> {
      const devices = await client.listChildren([EVENTS_DIR]);
      if (!devices) return [];
      const listing: PluginSyncBatchListing = [];
      for (const device of devices) {
        if (!device.collection) continue;
        const files = (await client.listChildren(deviceDir(device.name))) ?? [];
        let count = 0;
        for (const file of files) {
          const index = parseBatchName(file.name);
          // Dense contract: count = highest index + 1. A hole (a batch file
          // someone deleted by hand) serves as an empty batch downstream
          // rather than hiding everything after it.
          if (index !== null && index + 1 > count) count = index + 1;
        }
        if (count > 0) listing.push({ deviceId: device.name, count });
      }
      return listing;
    },

    async getEventBatch(deviceId, index): Promise<SealedEventWire[]> {
      const bytes = await client.get(batchFile(deviceId, index));
      if (!bytes) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        // A torn write from a device that died mid-PUT: that device never got
        // its ack, so the same events re-enter its NEXT batch when it comes
        // back. Serving the fragment as empty is deterministic and safe;
        // throwing would poison the pull position forever.
        return [];
      }
      return Array.isArray(parsed) ? parsed.filter(isSealedEvent) : [];
    },

    async putEventBatch(deviceId, index, events) {
      await client.ensureCollections(deviceDir(deviceId));
      const body = new TextEncoder().encode(JSON.stringify(events));
      const outcome = await client.put(batchFile(deviceId, index), body, {
        ifNoneMatch: true,
      });
      if (outcome === "exists") {
        // Stale bookkeeping (a lost ack): fail the push; the caller re-reads
        // the listing and lands on the next free index.
        throw new Error(
          `webdav: batch ${index} already exists for device ${deviceId} — stale push index`,
        );
      }
    },

    async putBlob(key, bytes) {
      await client.ensureCollections([BLOBS_DIR]);
      await client.put(blobMainPath(key), bytes);
    },

    getBlob: (key) => client.get(blobMainPath(key)),

    async putBlobPart(key, index, _parts, bytes) {
      await client.ensureCollections(blobPartsDir(key));
      await client.put(blobPartPath(key, index), bytes);
    },

    async commitBlob(key, parts) {
      const files = (await client.listChildren(blobPartsDir(key))) ?? [];
      const present = new Set<number>();
      for (const file of files) {
        const index = parsePartName(file.name);
        if (index !== null) present.add(index);
      }
      for (let index = 0; index < parts; index += 1) {
        if (!present.has(index)) {
          throw new Error(`webdav: blob "${key}" is missing part ${index} of ${parts}`);
        }
      }
      // Leftovers from an earlier attempt with a different chunking must not
      // linger next to the committed set (best effort — a survivor is dead
      // weight, not corruption: reads are descriptor-driven).
      for (const index of present) {
        if (index >= parts) await client.remove(blobPartPath(key, index));
      }
      // The 5-byte v2 descriptor the engine reads back via getBlob:
      // [version=2][partCount u32 big-endian] (sync-envelope wire format).
      const descriptor = new Uint8Array(5);
      descriptor[0] = 2;
      new DataView(descriptor.buffer).setUint32(1, parts, false);
      await client.ensureCollections([BLOBS_DIR]);
      await client.put(blobMainPath(key), descriptor);
    },

    async getBlobPart(key, index) {
      const bytes = await client.get(blobPartPath(key, index));
      if (!bytes) {
        throw new Error(`webdav: blob "${key}" has no part ${index} on the server`);
      }
      return bytes;
    },
  };
}
