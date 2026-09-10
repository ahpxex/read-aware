import { AppError } from "./errors";

export type HostExportFile = { filename: string; content: string | Uint8Array | ArrayBuffer; mimeType?: string };
export type PluginDirectoryQuery = { search?: string; offset?: number; limit?: number };
export type PluginDirectoryEntry = {
  id: string; name: string; version: string; builtin: boolean;
  /** Configured enabled state, not proof that every contribution is active. */
  enabled: boolean; activationFailed: boolean;
};
export type PluginDirectoryPage = { plugins: PluginDirectoryEntry[]; total: number; offset: number; nextOffset: number | null };

const invalid = (message: string): never => { throw new AppError("ui/invalid-target", message); };
export function normalizeClipboardText(value: unknown): string {
  if (typeof value !== "string" || value.length > 1_000_000) return invalid("Clipboard text must contain at most 1000000 characters");
  return value;
}
export function normalizeExternalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return invalid("Invalid external URL");
  let url: URL;
  try { url = new URL(value); } catch { return invalid("Invalid external URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return invalid("Only HTTP(S) URLs without credentials may be opened");
  return url.href;
}
export function normalizeHostExport(value: HostExportFile): HostExportFile {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["filename", "content", "mimeType"].includes(key))
    || typeof value.filename !== "string" || !value.filename.trim() || value.filename.length > 256
    || value.mimeType !== undefined && (typeof value.mimeType !== "string" || value.mimeType.length > 256 || /[\r\n]/.test(value.mimeType))) return invalid("Invalid export description");
  const content = value.content;
  if (typeof content !== "string" && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer)) return invalid("Export requires text or bytes");
  if ((typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength) > 64 * 1024 * 1024) return invalid("Export exceeds 64 MiB");
  return { filename: value.filename, content: typeof content === "string" ? content : content.slice(0),
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }) };
}
export function normalizePluginDirectoryQuery(value: PluginDirectoryQuery = {}): Required<PluginDirectoryQuery> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["search", "offset", "limit"].includes(key))) return invalid("Invalid plugin directory query");
  const { search = "", offset = 0, limit = 50 } = value;
  if (typeof search !== "string" || search.length > 200 || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalid("Invalid plugin directory bounds");
  return { search: search.trim().toLowerCase(), offset, limit };
}
