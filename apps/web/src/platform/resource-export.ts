import { AppError, RESOURCE_MAX_CHUNK, RESOURCE_MAX_SIZE } from "@read-aware/core";
import type { nativeResourceFiles } from "./resource-files";

type IO = Pick<typeof nativeResourceFiles, "create" | "append" | "commit" | "save" | "release">;

/** Convenience exports and explicit references use the same sealed native files. */
export async function exportResourceBytes(io: IO, filename: string, data: string | Uint8Array | ArrayBuffer,
  report: (error: unknown) => void, signal?: AbortSignal): Promise<boolean> {
  return withResourceBytes(io, data, id => io.save(id, filename, signal), report, signal);
}

export async function copyResourceImageBytes(io: Omit<IO, "save"> & Pick<typeof nativeResourceFiles, "copyImage">,
  data: Uint8Array | ArrayBuffer, report: (error: unknown) => void, signal?: AbortSignal) {
  if (data.byteLength > 16 * 1024 * 1024) throw new AppError("ui/invalid-target", "Image exceeds clipboard limits");
  return withResourceBytes(io, data, id => io.copyImage(id), report, signal);
}

async function withResourceBytes<T>(io: Omit<IO, "save">, data: string | Uint8Array | ArrayBuffer,
  consume: (id: string) => Promise<T>, report: (error: unknown) => void, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : null;
  const size = encoded ? encoded.byteLength : (data as Uint8Array | ArrayBuffer).byteLength;
  if (size > RESOURCE_MAX_SIZE) throw new AppError("ui/unavailable", "Export exceeds resource size limit");
  const bytes = typeof data === "string" ? encoded!
    : data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const resource = await io.create();
  try {
    for (let offset = 0; offset < bytes.length; offset += RESOURCE_MAX_CHUNK) {
      signal?.throwIfAborted();
      const chunk = bytes.subarray(offset, offset + RESOURCE_MAX_CHUNK);
      const size = await io.append(resource.id, offset, chunk);
      if (size !== offset + chunk.length) throw new AppError("internal", "Unexpected resource export offset");
    }
    signal?.throwIfAborted(); await io.commit(resource.id);
    signal?.throwIfAborted(); return await consume(resource.id);
  } finally {
    try { await io.release(resource.id); } catch (error) { report(error); }
  }
}
