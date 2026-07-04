/**
 * Raw-IPC wrappers for the desktop blob store (book files + derivatives).
 *
 * Bytes cross the Tauri bridge as BINARY bodies, never JSON: a serde
 * `Vec<u8>` would serialize a whole book into a JSON array of numbers, and
 * stringifying/parsing tens of millions of array elements froze the webview
 * main thread every time a large book was opened. `get_blob` returns a raw
 * `tauri::ipc::Response` (an `ArrayBuffer` here); `put_blob` sends the payload
 * as the raw request body with the key riding in a header.
 *
 * Desktop-only — browser dev builds keep their IndexedDB paths in
 * `library-db.ts` and never call these.
 */
import { invoke } from "@tauri-apps/api/core";

/** Must match `BLOB_KEY_HEADER` in `apps/desktop/src-tauri/src/storage.rs`. */
const BLOB_KEY_HEADER = "x-blob-key";

/**
 * Fetch a blob's bytes. An empty body means "no such key" (see the Rust
 * command: a raw response cannot express `Option`, and no real blob here is
 * zero-length), so zero bytes maps back to `null`.
 */
export async function getDesktopBlob(key: string): Promise<Uint8Array | null> {
  const buffer = await invoke<ArrayBuffer>("get_blob", { key });
  return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
}

/** Store a blob's bytes under `key`, transferred as a raw binary body. */
export async function putDesktopBlob(key: string, data: Uint8Array): Promise<void> {
  await invoke("put_blob", data, { headers: { [BLOB_KEY_HEADER]: key } });
}
