import { AppError } from "@read-aware/core";
import type { PluginNetworkAccess } from "@read-aware/plugin-types";

function httpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AppError("plugin/network-denied", "Network URL must be absolute HTTP(S)"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AppError("plugin/network-denied", "Network URL scheme or credentials are not allowed");
  }
  return url;
}

/** Shared by manifest validation and the authoritative runtime, never a worker claim. */
export function parsePluginNetworkAccess(raw: unknown): PluginNetworkAccess {
  if (raw === undefined) return { origins: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some(key => key !== "origins")) {
    throw new Error("networkAccess must contain only origins");
  }
  const origins = (raw as { origins?: unknown }).origins;
  if (!Array.isArray(origins) || origins.length > 32 ||
      origins.some(origin => typeof origin !== "string" || origin.length > 2048)) {
    throw new Error("networkAccess.origins must contain at most 32 HTTP(S) origins");
  }
  if (origins.length === 1 && origins[0] === "*") return { origins: ["*"] };
  return { origins: [...new Set(origins.map((origin: string) => {
    const url = httpUrl(origin);
    if (url.pathname !== "/" || url.search || url.hash || origin.includes("*") ||
        ![url.origin, `${url.origin}/`].includes(origin)) {
      throw new Error("networkAccess requires canonical origins without paths, queries or fragments");
    }
    return url.origin;
  }))] };
}

export function authorizePluginNetworkUrl(origins: readonly string[], value: string): URL {
  const url = httpUrl(value);
  if (!origins.includes("*") && !origins.includes(url.origin)) {
    throw new AppError("plugin/network-denied", "Destination is outside the plugin's declared network access");
  }
  return url;
}
