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
 * MOBILE (Android/iOS) takes a staged, chunked path instead — the twin of
 * `readPickedBookBytes` in pick-book-files.ts: Android's WebView never
 * exposes raw POST bodies (a `put_blob` upload would fall back to a JSON
 * number array — parsing a whole book that way stalls the import for
 * minutes), and IPC responses are injected via `evaluateJavascript`, which
 * chokes on one multi-megabyte `get_blob` ArrayBuffer. Downloads pull 256 KiB
 * raw-response chunks; uploads push base64 chunks (one JSON string parses
 * orders of magnitude faster than the number-array fallback).
 *
 * Desktop-only — browser dev builds keep their IndexedDB paths in
 * `library-db.ts` and never call these.
 */
import { invoke } from "@tauri-apps/api/core";
import { isMobileOS } from "./environment";

/** Must match `BLOB_KEY_HEADER` / `BLOB_MIME_HEADER` in storage.rs. */
const BLOB_KEY_HEADER = "x-blob-key";
const BLOB_MIME_HEADER = "x-blob-mime";

/** Chunk size for staged mobile transfers (matches BOOK_READ_CHUNK_BYTES). */
const BLOB_CHUNK_BYTES = 256 * 1024;

/**
 * Desktop uploads above this stream as raw chunks instead of one body: a
 * single ~80MB `put_blob` body saturates the WKWebView main thread for
 * seconds (~10MB/s through the IPC scheme handler), while 4MB slices cost
 * ~0.4s each with the event loop breathing between awaits.
 */
const DESKTOP_ONESHOT_MAX_BYTES = 8 * 1024 * 1024;
const DESKTOP_RAW_CHUNK_BYTES = 4 * 1024 * 1024;

/** What the Rust side recorded about the stored payload. */
export type BlobPutResult = { sha256: string; byteSize: number };

async function getBlobChunked(key: string): Promise<Uint8Array | null> {
  const total = await invoke<number>("blob_read_open", { key });
  if (total === 0) return null;
  try {
    const bytes = new Uint8Array(total);
    for (let offset = 0; offset < total; offset += BLOB_CHUNK_BYTES) {
      const chunk = await invoke<ArrayBuffer>("blob_read_chunk", {
        key,
        offset,
        length: BLOB_CHUNK_BYTES,
      });
      bytes.set(new Uint8Array(chunk), offset);
    }
    return bytes;
  } finally {
    void invoke("blob_read_close", { key }).catch(() => {});
  }
}

/** btoa over a byte range, strided so the argument list stays small. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

async function putBlobChunked(
  key: string,
  data: Uint8Array,
  mimeType?: string,
): Promise<BlobPutResult> {
  await invoke("blob_write_open", { key });
  try {
    for (let offset = 0; offset < data.length; offset += BLOB_CHUNK_BYTES) {
      await invoke("blob_write_chunk", {
        key,
        chunkBase64: toBase64(data.subarray(offset, offset + BLOB_CHUNK_BYTES)),
      });
    }
    return await invoke<BlobPutResult>("blob_write_commit", {
      key,
      mimeType: mimeType ?? null,
    });
  } catch (error) {
    void invoke("blob_write_abort", { key }).catch(() => {});
    throw error;
  }
}

/**
 * Fetch a blob's bytes. An empty body means "no such key" (see the Rust
 * command: a raw response cannot express `Option`, and no real blob here is
 * zero-length), so zero bytes maps back to `null`.
 */
export async function getDesktopBlob(key: string): Promise<Uint8Array | null> {
  if (isMobileOS()) return getBlobChunked(key);
  const buffer = await invoke<ArrayBuffer>("get_blob", { key });
  return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
}

/** Remove a blob (bytes + registry row). Missing keys are a no-op. */
export async function deleteDesktopBlob(key: string): Promise<void> {
  await invoke("delete_blob", { key });
}

/** Desktop staged upload: raw binary slices through the write session. */
async function putBlobChunkedRaw(
  key: string,
  data: Uint8Array,
  mimeType?: string,
): Promise<BlobPutResult> {
  await invoke("blob_write_open", { key });
  try {
    for (let offset = 0; offset < data.length; offset += DESKTOP_RAW_CHUNK_BYTES) {
      await invoke("blob_write_chunk_raw", data.subarray(offset, offset + DESKTOP_RAW_CHUNK_BYTES), {
        headers: { [BLOB_KEY_HEADER]: key },
      });
    }
    return await invoke<BlobPutResult>("blob_write_commit", {
      key,
      mimeType: mimeType ?? null,
    });
  } catch (error) {
    void invoke("blob_write_abort", { key }).catch(() => {});
    throw error;
  }
}

/** Store a blob's bytes under `key`, transferred as a raw binary body. */
export async function putDesktopBlob(
  key: string,
  data: Uint8Array,
  mimeType?: string,
): Promise<BlobPutResult> {
  if (isMobileOS()) return putBlobChunked(key, data, mimeType);
  if (data.length > DESKTOP_ONESHOT_MAX_BYTES) return putBlobChunkedRaw(key, data, mimeType);
  return invoke<BlobPutResult>("put_blob", data, {
    headers: {
      [BLOB_KEY_HEADER]: key,
      ...(mimeType ? { [BLOB_MIME_HEADER]: mimeType } : {}),
    },
  });
}
