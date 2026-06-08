import { invoke } from "@tauri-apps/api/core";
import type {
  DomainEvent,
  HlcStamp,
  StorageAdapter,
  VectorItem,
  VectorMatch,
} from "@read-aware/core";

/**
 * Desktop StorageAdapter — bridges to the Tauri Rust backend (SQLite event log
 * + blob store). The Rust command names and payload shapes mirror this file.
 */
export class TauriStorageAdapter implements StorageAdapter {
  appendEvents(events: DomainEvent[]): Promise<void> {
    return invoke<void>("append_events", { events });
  }

  readEventsSince(after?: HlcStamp): Promise<DomainEvent[]> {
    return invoke<DomainEvent[]>("read_events_since", { after: after ?? null });
  }

  putBlob(key: string, data: Uint8Array): Promise<void> {
    return invoke<void>("put_blob", { key, data });
  }

  async getBlob(key: string): Promise<Uint8Array | undefined> {
    const bytes = await invoke<number[] | null>("get_blob", { key });
    return bytes ? new Uint8Array(bytes) : undefined;
  }

  deleteBlob(key: string): Promise<void> {
    return invoke<void>("delete_blob", { key });
  }

  upsertVectors(items: VectorItem[]): Promise<void> {
    return invoke<void>("upsert_vectors", { items });
  }

  queryVectors(embedding: number[], k: number): Promise<VectorMatch[]> {
    return invoke<VectorMatch[]>("query_vectors", { embedding, k });
  }
}
