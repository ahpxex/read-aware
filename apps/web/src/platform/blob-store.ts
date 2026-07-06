/**
 * Raw-IPC wrappers for the desktop blob store (book files + derivatives).
 *
 * Bytes cross the Tauri bridge as BINARY bodies, never JSON: a serde
 * `Vec<u8>` would serialize a whole book into a JSON array of numbers, and
 * stringifying/parsing tens of millions of array elements froze the webview
 * main thread every time a large book was opened. `get_blob` returns a raw
 * `tauri::ipc::Response` (an `ArrayBuffer` here); `put_blob` sends the payload
 * as the raw request body with the key (and optional MIME type) riding in
 * headers.
 *
 * Storage side (see src-tauri/storage.rs): bytes land as files under
 * `<app_data>/blobs/`, registered in the SQLite `blob_objects` table with
 * their sha256 — which `put_blob` returns, so import paths can stamp
 * `book.imported.sourceSha256` without hashing twice.
 *
 * Desktop-only — browser dev builds keep their IndexedDB paths in
 * `library-db.ts` and never call these.
 */
import { invoke } from "@tauri-apps/api/core";

/** Must match `BLOB_KEY_HEADER` / `BLOB_MIME_HEADER` in storage.rs. */
const BLOB_KEY_HEADER = "x-blob-key";
const BLOB_MIME_HEADER = "x-blob-mime";

/** What the Rust side recorded about the stored payload. */
export type BlobPutResult = { sha256: string; byteSize: number };

/**
 * Fetch a blob's bytes. An empty body means "no such key" (see the Rust
 * command: a raw response cannot express `Option`, and no real blob here is
 * zero-length), so zero bytes maps back to `null`.
 */
export async function getDesktopBlob(key: string): Promise<Uint8Array | null> {
  const buffer = await invoke<ArrayBuffer>("get_blob", { key });
  return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
}

/** Remove a blob (bytes + registry row). Missing keys are a no-op. */
export async function deleteDesktopBlob(key: string): Promise<void> {
  await invoke("delete_blob", { key });
}

/** Store a blob's bytes under `key`, transferred as a raw binary body. */
export async function putDesktopBlob(
  key: string,
  data: Uint8Array,
  mimeType?: string,
): Promise<BlobPutResult> {
  return invoke<BlobPutResult>("put_blob", data, {
    headers: {
      [BLOB_KEY_HEADER]: key,
      ...(mimeType ? { [BLOB_MIME_HEADER]: mimeType } : {}),
    },
  });
}
