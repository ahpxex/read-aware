// The platform boundary for local-first storage.
//
// Implementations (kept out of @read-aware/core, which stays pure):
//   - desktop: native filesystem + SQLite + LanceDB (via Tauri / Rust)
//   - web:     OPFS + wa-sqlite + a WASM vector index
//
// The event log is the source of truth and the unit of sync. Structured tables
// and the vector index are derived projections rebuilt from the log.

import type { DomainEvent, HlcStamp } from "./events";

export interface VectorItem {
  id: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface StorageAdapter {
  // --- Event log (append-only; the sync unit) ---
  /** Append events to the local log. Implementations must preserve HLC order. */
  appendEvents(events: DomainEvent[]): Promise<void>;
  /** Read events after a given HLC stamp (omit to read from the beginning). */
  readEventsSince(after?: HlcStamp): Promise<DomainEvent[]>;

  // --- Blobs (book files + normalized derivatives) ---
  putBlob(key: string, data: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
  deleteBlob(key: string): Promise<void>;

  // --- Vector index (semantic retrieval; LanceDB on desktop) ---
  upsertVectors(items: VectorItem[]): Promise<void>;
  queryVectors(embedding: number[], k: number): Promise<VectorMatch[]>;
}
