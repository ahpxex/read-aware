import { invoke } from "./ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri, isMobileOS } from "./environment";
import { nativeResourceFiles } from "./resource-files";
import { exportResourceBytes } from "./resource-export";
import { createLogger } from "./logger";

const log = createLogger("export");

export type FileExport = {
  filename: string;
  /** UTF-8 text, or raw bytes for binary formats. */
  content: string | Uint8Array | ArrayBuffer;
  mimeType?: string;
};

/** Back-compat alias for the text-only days. */
function safeBasename(filename: string): string {
  const segments = filename.split(/[\\/]/);
  const basename = segments[segments.length - 1] ?? "";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "export.txt";
}

function extensionOf(filename: string): string | null {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function toBytes(content: Uint8Array | ArrayBuffer): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** Chunked base64 — String.fromCharCode over a whole MB-scale array overflows. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Save plugin-generated content (text or binary) through host-owned platform UI. */
export async function exportTextFile(file: FileExport, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const filename = safeBasename(file.filename);
  const binary = typeof file.content !== "string";

  if (isTauri() && !isMobileOS()) {
    return exportResourceBytes(nativeResourceFiles, filename, file.content,
      error => log.warn("Temporary export cleanup failed", error), signal);
  }

  if (isTauri()) {
    const extension = extensionOf(filename);
    const path = await save({
      defaultPath: filename,
      filters: extension
        ? [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }]
        : undefined,
    });
    signal?.throwIfAborted();
    if (!path) return false;
    if (binary) {
      await invoke("write_export_file", {
        path,
        content: bytesToBase64(toBytes(file.content as Uint8Array | ArrayBuffer)),
        base64: true,
      });
    } else {
      await invoke("write_export_file", { path, content: file.content });
    }
    return true;
  }

  const blobPart = binary ? toBytes(file.content as Uint8Array | ArrayBuffer) : file.content;
  const url = URL.createObjectURL(
    new Blob([blobPart as BlobPart], {
      type: file.mimeType ?? (binary ? "application/octet-stream" : "text/plain;charset=utf-8"),
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
