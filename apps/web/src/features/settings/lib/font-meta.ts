import type { UserFontEntry } from "../../../domain/fonts";

/** "TTF · 1.4 MB" — the file facts under an imported font's parsed name. */
export function fontMeta(font: UserFontEntry, syncing: string): string {
  const size =
    font.byteSize >= 1024 * 1024
      ? `${(font.byteSize / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(font.byteSize / 1024))} KB`;
  const base = `${font.format.toUpperCase()} · ${size}`;
  return font.bytesLocal ? base : `${base} · ${syncing}`;
}
