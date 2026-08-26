import { parseManifestJson } from "../apps/web/src/features/plugins/lib/manifest";
import { assertPluginCapabilityRequirements } from "../apps/web/src/features/plugins/runtime/plugin-capabilities";
import appConfig from "../apps/desktop/src-tauri/tauri.conf.json";

const DEFAULT_BASES = [
  "https://raw.githubusercontent.com/ahpxex/readaware-plugins/main",
  "https://cdn.jsdelivr.net/gh/ahpxex/readaware-plugins@main",
];
const baseUrls = process.env.READAWARE_MARKETPLACE_URL
  ? [process.env.READAWARE_MARKETPLACE_URL.replace(/\/$/, "")]
  : DEFAULT_BASES;
const timeoutMs = 15_000;
const fetchAttempts = 3;

type ReleaseVersion = {
  major: number;
  minor: number;
  patch: number;
  /** ReadAware's numbered prerelease (`0.5.0-6`); null is the stable release. */
  revision: number | null;
};

function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    revision: match[4] === undefined ? null : Number(match[4]),
  };
}

function releaseSatisfies(version: string, minimum: string): boolean {
  const current = parseReleaseVersion(version);
  const required = parseReleaseVersion(minimum);
  if (!current) throw new Error(`app version "${version}" is not a supported release version`);
  if (!required) throw new Error(`minAppVersion "${minimum}" is not a supported release version`);
  for (const field of ["major", "minor", "patch"] as const) {
    if (current[field] !== required[field]) return current[field] > required[field];
  }
  // A stable release follows every numbered prerelease of the same core.
  if (current.revision === null) return true;
  if (required.revision === null) return false;
  return current.revision >= required.revision;
}

type RegistryEntry = {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  permissions?: string[];
  files?: string[];
};

function requireEntry(raw: unknown, index: number): RegistryEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`registry.plugins[${index}] must be an object`);
  }
  const entry = raw as Record<string, unknown>;
  for (const field of ["id", "name", "version"] as const) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      throw new Error(`registry.plugins[${index}].${field} must be a non-empty string`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id as string)) {
    throw new Error(`registry.plugins[${index}].id is not a valid plugin id`);
  }
  if (
    entry.files != null &&
    (!Array.isArray(entry.files) ||
      entry.files.some((file) => typeof file !== "string" || !isSafePath(file)))
  ) {
    throw new Error(`registry.plugins[${index}].files contains an unsafe path`);
  }
  return entry as RegistryEntry;
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

async function fetchText(baseUrl: string, path: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/${path}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${response.status} fetching ${path}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < fetchAttempts) {
        await Bun.sleep(250 * attempt);
      }
    }
  }
  throw lastError;
}

function sameStrings(left: readonly string[] = [], right: readonly string[] = []): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

async function checkSource(baseUrl: string): Promise<number> {
  const registryRaw = JSON.parse(await fetchText(baseUrl, "registry.json")) as {
    plugins?: unknown;
  };
  if (!Array.isArray(registryRaw.plugins)) {
    throw new Error("registry.json must contain a plugins array");
  }

  const entries = registryRaw.plugins.map(requireEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`duplicate marketplace plugin id "${entry.id}"`);
    seen.add(entry.id);

    const folder = `plugins/${entry.id}`;
    const manifest = parseManifestJson(
      await fetchText(baseUrl, `${folder}/manifest.json`),
    );
    if (manifest.id !== entry.id) {
      throw new Error(
        `${entry.id}: registry id does not match manifest id "${manifest.id}"`,
      );
    }
    if (
      manifest.name !== entry.name ||
      manifest.version !== entry.version ||
      manifest.minAppVersion !== entry.minAppVersion ||
      !sameStrings(manifest.permissions, entry.permissions)
    ) {
      throw new Error(
        `${entry.id}: registry metadata differs from the authoritative manifest`,
      );
    }
    if (
      manifest.minAppVersion &&
      !releaseSatisfies(appConfig.version, manifest.minAppVersion)
    ) {
      throw new Error(
        `${entry.id}: requires app ${manifest.minAppVersion}, but this release is ${appConfig.version}`,
      );
    }
    assertPluginCapabilityRequirements(manifest);

    const declaredPackageFiles = new Set(entry.files ?? []);
    for (const font of manifest.fonts ?? []) {
      for (const file of font.files) {
        if (!declaredPackageFiles.has(file.path)) {
          throw new Error(
            `${entry.id}: manifest font "${file.path}" is missing from registry.files`,
          );
        }
      }
    }
    const files = [...new Set([manifest.main ?? "main.js", ...declaredPackageFiles])];
    for (const file of files) {
      if (!isSafePath(file)) throw new Error(`${entry.id}: unsafe package path "${file}"`);
      await fetchText(baseUrl, `${folder}/${file}`);
    }
    console.log(`OK ${entry.id}@${entry.version} from ${new URL(baseUrl).host}`);
  }
  return entries.length;
}

for (const baseUrl of baseUrls) {
  const count = await checkSource(baseUrl);
  console.log(
    `Marketplace contract accepted ${count} plugin(s) for ReadAware ${appConfig.version}.`,
  );
}
