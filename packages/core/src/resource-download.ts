import { AppError } from "./errors";
import type { ResourceRef } from "./resources";

export const RESOURCE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
export type ResourceDownloadInput = { url: string; name: string };
export type ResourceDownloadReceipt =
  | { status: "downloaded"; resource: ResourceRef }
  | { status: "redirect"; url: string; httpStatus: number }
  | { status: "http-error"; httpStatus: number };

/** Canonical request identity used both before approval and before dispatch. */
export function resourceDownloadInput(raw: ResourceDownloadInput): ResourceDownloadInput {
  if (!raw || typeof raw !== "object" || Object.keys(raw).some(key => key !== "url" && key !== "name")
    || typeof raw.url !== "string" || raw.url.length > 2048 || typeof raw.name !== "string"
    || !raw.name.trim() || raw.name.length > 256 || /[\\/\u0000-\u001f\u007f]/.test(raw.name) || raw.name === "." || raw.name === "..") {
    throw new AppError("ui/invalid-target", "Invalid download URL or basename");
  }
  let url: URL;
  try { url = new URL(raw.url); } catch { throw new AppError("ui/invalid-target", "Invalid download URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href.length > 2048) {
    throw new AppError("plugin/network-denied", "Downloads require an HTTPS URL without credentials or fragment");
  }
  return { url: url.href, name: raw.name };
}
