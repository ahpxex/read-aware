/**
 * The community marketplace client. The marketplace is a public GitHub repo
 * (Raycast model — plugins land via pull request); the app reads its
 * `registry.json` index and installs plugins by fetching their text files and
 * handing them to Rust to write (docs/plugin-system.md §9).
 *
 * Two mirrors, tried in order: raw.githubusercontent.com is always fresh but
 * unreachable on some networks; jsDelivr is widely reachable but caches ~12h.
 */
import { PLUGIN_PERMISSIONS, type InstalledPlugin, type PluginPermission } from "../lib/plugin-types";
import { PluginManifestError, parseManifestJson } from "../lib/manifest";
import { installPluginFiles } from "./plugin-host";
import type { PluginFilePayload } from "./plugin-backend";

export const MARKETPLACE_REPO = "ahpxex/readaware-plugins";
export const MARKETPLACE_REPO_URL = `https://github.com/${MARKETPLACE_REPO}`;

const SOURCES = [
  `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main`,
  `https://cdn.jsdelivr.net/gh/${MARKETPLACE_REPO}@main`,
];

const FETCH_TIMEOUT_MS = 8000;

export type MarketplaceEntry = {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  minAppVersion?: string;
  permissions?: PluginPermission[];
  /** Extra files beyond manifest.json + the entry module, repo-relative to the plugin folder. */
  files?: string[];
};

async function fetchText(path: string): Promise<string> {
  let lastError: unknown = new Error("no marketplace source configured");
  for (const base of SOURCES) {
    try {
      const response = await fetch(`${base}/${path}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) {
        lastError = new Error(`${response.status} for ${path}`);
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function asEntry(raw: unknown): MarketplaceEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.version !== "string"
  ) {
    return null;
  }
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.filter((p): p is PluginPermission =>
        (PLUGIN_PERMISSIONS as readonly string[]).includes(p as string),
      )
    : undefined;
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    description: typeof record.description === "string" ? record.description : undefined,
    author: typeof record.author === "string" ? record.author : undefined,
    minAppVersion:
      typeof record.minAppVersion === "string" ? record.minAppVersion : undefined,
    permissions,
    files: Array.isArray(record.files)
      ? record.files.filter((f): f is string => typeof f === "string")
      : undefined,
  };
}

/** Fetch and shallowly validate the marketplace index. */
export async function fetchMarketplaceRegistry(): Promise<MarketplaceEntry[]> {
  const text = await fetchText("registry.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("registry.json is not valid JSON");
  }
  const list = (parsed as { plugins?: unknown[] }).plugins;
  if (!Array.isArray(list)) throw new Error("registry.json has no plugins array");
  return list
    .map(asEntry)
    .filter((entry): entry is MarketplaceEntry => entry !== null);
}

/**
 * Download a marketplace plugin's files and install them. The manifest is
 * re-validated against the entry — the registry index is a claim, the
 * manifest in the folder is the authority.
 */
export async function installFromMarketplace(
  entry: MarketplaceEntry,
): Promise<InstalledPlugin> {
  const manifestText = await fetchText(`plugins/${entry.id}/manifest.json`);
  const manifest = parseManifestJson(manifestText);
  if (manifest.id !== entry.id) {
    throw new PluginManifestError(
      `marketplace manifest id "${manifest.id}" does not match listing "${entry.id}"`,
    );
  }

  const fileNames = [manifest.main ?? "main.js", ...(entry.files ?? [])];
  const files: PluginFilePayload[] = [{ path: "manifest.json", content: manifestText }];
  for (const name of [...new Set(fileNames)]) {
    files.push({ path: name, content: await fetchText(`plugins/${entry.id}/${name}`) });
  }
  return installPluginFiles(manifest.id, files);
}
