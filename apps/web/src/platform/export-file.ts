import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./environment";

export type TextFileExport = {
  filename: string;
  content: string;
  mimeType?: string;
};

function safeBasename(filename: string): string {
  const segments = filename.split(/[\\/]/);
  const basename = segments[segments.length - 1] ?? "";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "export.txt";
}

function extensionOf(filename: string): string | null {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Save plugin-generated UTF-8 text through host-owned platform UI. */
export async function exportTextFile(file: TextFileExport): Promise<boolean> {
  const filename = safeBasename(file.filename);

  if (isTauri()) {
    const extension = extensionOf(filename);
    const path = await save({
      defaultPath: filename,
      filters: extension
        ? [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }]
        : undefined,
    });
    if (!path) return false;
    await invoke("write_export_file", { path, content: file.content });
    return true;
  }

  const url = URL.createObjectURL(
    new Blob([file.content], { type: file.mimeType ?? "text/plain;charset=utf-8" }),
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
