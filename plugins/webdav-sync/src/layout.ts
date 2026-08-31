/**
 * Remote layout under the base folder — the on-server counterpart of the
 * `sync:transport` contract's batch/blob/meta model:
 *
 *   meta/<name>                     named meta objects (key material lives at
 *                                   meta/keys, first-writer-wins)
 *   events/<deviceId>/<n>.json      device <deviceId>'s batch n (dense 0..N-1),
 *                                   a JSON array of sealed event envelopes
 *   blobs/<encoded-key>             a blob's main object (v1 seal or v2
 *                                   descriptor)
 *   blobs/<encoded-key>.parts/<i>   sealed parts of a chunked blob
 *
 * Blob keys contain characters hostile to remote filesystems (`bookfile:<id>`
 * has a colon — illegal on Windows-backed servers), so a key becomes a
 * filename via percent-encoding — the same convention the app's local blob
 * store uses. The wire URL then encodes the `%` itself again; that is the
 * client's job, this module only names path SEGMENTS.
 */

/** A blob key as a safe remote filename ("bookfile:x" → "bookfile%3Ax"). */
export function encodeKeySegment(key: string): string {
  return encodeURIComponent(key);
}

const META_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function metaPath(name: string): string[] {
  if (!META_NAME.test(name)) throw new Error(`invalid meta object name: ${name}`);
  return ["meta", name];
}

export const EVENTS_DIR = "events";
export const BLOBS_DIR = "blobs";

export function deviceDir(deviceId: string): string[] {
  return [EVENTS_DIR, deviceId];
}

export function batchFile(deviceId: string, index: number): string[] {
  return [EVENTS_DIR, deviceId, `${index}.json`];
}

/** "<n>.json" → n; null for anything else in the device directory. */
export function parseBatchName(name: string): number | null {
  const match = /^(0|[1-9]\d*)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}

export function blobMainPath(key: string): string[] {
  return [BLOBS_DIR, encodeKeySegment(key)];
}

export function blobPartsDir(key: string): string[] {
  return [BLOBS_DIR, `${encodeKeySegment(key)}.parts`];
}

export function blobPartPath(key: string, index: number): string[] {
  return [...blobPartsDir(key), String(index)];
}

/** "<i>" → i; null for foreign files in a parts directory. */
export function parsePartName(name: string): number | null {
  const match = /^(0|[1-9]\d*)$/.exec(name);
  return match ? Number(match[1]) : null;
}
