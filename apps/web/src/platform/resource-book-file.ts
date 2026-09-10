import { AppError, RESOURCE_MAX_CHUNK } from "@read-aware/core";
import type { BookFileSource } from "../features/reader/lib/reader-types";
import type { NativeResource } from "../services/resource-owner";
import { nativeResourceFiles } from "./resource-files";

function index(value: number | undefined, size: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isNaN(value)) return 0;
  const integer = Number.isFinite(value) ? Math.trunc(value) : value < 0 ? -size : size;
  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

/** Lazy parser source. The caller must hold the resource owner's use lease. */
export function resourceBookFile(resource: NativeResource, signal?: AbortSignal): BookFileSource {
  function slice(offset: number, size: number, type: string): BookFileSource {
    return {
      name: resource.name, size, type,
      async arrayBuffer() {
        signal?.throwIfAborted();
        const bytes = new Uint8Array(size);
        for (let cursor = 0; cursor < size; cursor += RESOURCE_MAX_CHUNK) {
          signal?.throwIfAborted();
          const length = Math.min(RESOURCE_MAX_CHUNK, size - cursor);
          const chunk = await nativeResourceFiles.read(resource.id, offset + cursor, length);
          signal?.throwIfAborted();
          if (chunk.byteLength !== length) throw new AppError("fs/not-found", "Resource became unavailable");
          bytes.set(new Uint8Array(chunk), cursor);
        }
        return bytes.buffer;
      },
      slice(start, end, contentType = "") {
        const first = index(start, size, 0), last = index(end, size, size);
        return slice(offset + first, Math.max(0, last - first), contentType.toLowerCase());
      },
    };
  }
  return slice(0, resource.size, resource.mimeType);
}
