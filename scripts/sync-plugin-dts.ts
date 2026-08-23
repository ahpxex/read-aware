/**
 * Regenerate the marketplace repo's `types/plugin-api.d.ts` mirror from the
 * contract source (`packages/plugin-types/src/index.ts`).
 *
 *   bun scripts/sync-plugin-dts.ts [path-to-readaware-plugins]
 *
 * The mirror is the PUBLIC contract: everything is carried verbatim from the
 * source except the curated transformations below — change them deliberately,
 * they encode policy, not convenience:
 *
 * 1. The core-import block is replaced by the mirror's own inlined sections
 *    (header + core vocabulary, the domain-event payload map, the inline
 *    read models). Those sections are PRESERVED from the existing mirror
 *    file between their headings — when core read models or the event
 *    catalog change, update them there by hand.
 * 2. Runtime consts become pure types (`PLUGIN_PERMISSIONS` → the
 *    `PluginPermission` union, `MIN_SCHEDULE_MINUTES` → a literal in JSDoc):
 *    the mirror stays a value-free declaration file.
 * 3. `reader:modes` and the reader-mode contract stay OUT — reserved for
 *    bundled first-party plugins (enforced at activation) and rejected by
 *    the registry validator.
 *
 * After running: `bun run typecheck` and `node scripts/validate.mjs` in the
 * marketplace repo must pass before pushing.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_PERMISSIONS } from "../packages/core/src/capabilities";

const repoRoot = resolve(import.meta.dir, "..");
const marketRoot = resolve(process.argv[2] ?? join(repoRoot, "../readaware-plugins"));
const sourcePath = join(repoRoot, "packages/plugin-types/src/index.ts");
const coreDomainsPath = join(repoRoot, "packages/core/src/domains.ts");
const coreCapabilitiesPath = join(repoRoot, "packages/core/src/capabilities.ts");
const coreSettingsPath = join(repoRoot, "packages/core/src/settings.ts");
const coreReadModelsPath = join(repoRoot, "packages/core/src/read-models.ts");
const mirrorPath = join(marketRoot, "types/plugin-api.d.ts");

if (!existsSync(mirrorPath)) {
  console.error(`mirror not found: ${mirrorPath}`);
  process.exit(1);
}

const src = readFileSync(sourcePath, "utf8");
const mirror = readFileSync(mirrorPath, "utf8");

/** Slice `text` from `start` to `end` (start inclusive, end exclusive). */
function cut(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`anchor not found: ${start.slice(0, 60)}`);
  const to = text.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`anchor not found after start: ${end.slice(0, 60)}`);
  return text.slice(from, to);
}

/** Replace exactly once; loud when the anchor drifted. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`swap anchor drifted: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

// ── Preserved mirror-form sections ──────────────────────────────────────────
const GENERATED_CORE = "// ─── Generated @read-aware/core vocabulary";
const existingHeader = cut(mirror, "/**\n * MIRROR", "// ─── Permissions");
const mirrorPrefix = cut(
  existingHeader,
  "/**\n * MIRROR",
  "/**\n * @read-aware/plugin-types",
);
const sourceImports = src.indexOf("import {");
if (sourceImports < 0) throw new Error("plugin contract import block missing");
const contractIntro = src.slice(0, sourceImports);
const baseCoreStart = existingHeader.indexOf(
  "// ─── Inlined @read-aware/core vocabulary",
);
if (baseCoreStart < 0) throw new Error("inlined core vocabulary marker missing");
const baseCoreEnd = existingHeader.includes(GENERATED_CORE)
  ? existingHeader.indexOf(GENERATED_CORE)
  : existingHeader.length;
const mirrorHeader =
  mirrorPrefix + contractIntro + existingHeader.slice(baseCoreStart, baseCoreEnd);
const payloadTailAnchor = mirror.includes("/** Book, source, metadata")
  ? "/** Book, source, metadata"
  : "/** Everything library management emits";
const payloadMap = cut(mirror, "// ─── Events", payloadTailAnchor);

const domainSource = readFileSync(coreDomainsPath, "utf8");
const domainIds = [...domainSource.matchAll(/^  ([a-z][a-zA-Z]*): \{/gm)].map(
  (match) => match[1],
);
const domainPermissions = [...domainSource.matchAll(/pluginAccess: \[([^\]]*)\]/g)].flatMap(
  (match, index) =>
    [...match[1].matchAll(/"(read|write)"/g)].map(
      (access) => `${domainIds[index]}:${access[1]}`,
    ),
);
const capabilitySource = readFileSync(coreCapabilitiesPath, "utf8");
const catalogIds = (start: string, end: string) =>
  [...cut(capabilitySource, start, end).matchAll(/^  ([a-z][a-zA-Z]*): \{/gm)].map(
    (match) => match[1],
  );
const contributionIds = catalogIds(
  "export const CONTRIBUTION_CATALOG = {",
  "export type ContributionId",
);
const hostServiceIds = catalogIds(
  "export const HOST_SERVICE_CATALOG = {",
  "export type HostServiceId",
);
const declarativeSchemaIds = catalogIds(
  "export const DECLARATIVE_SCHEMA_CATALOG = {",
  "export type DeclarativeSchemaId",
);
const domainVocabulary = `${GENERATED_CORE} ──────────────────────────────────────

export type Id = string;
export type IsoDate = string;
export type DomainId = ${domainIds.map((id) => `"${id}"`).join(" | ")};
export type DomainAccess = "read" | "write";
export type DomainPermission = ${domainPermissions
  .map((permission) => `"${permission}"`)
  .join(" | ")};
export type ContributionId = ${contributionIds.map((id) => `"${id}"`).join(" | ")};
export type HostServiceId = ${hostServiceIds.map((id) => `"${id}"`).join(" | ")};
export type DeclarativeSchemaId = ${declarativeSchemaIds
  .map((id) => `"${id}"`)
  .join(" | ")};

`;
const settingsVocabulary = readFileSync(coreSettingsPath, "utf8").replace(
  /import type \{ EventOrigin \} from "\.\/entities";\n\n/,
  "",
);
const coreReadModels = readFileSync(coreReadModelsPath, "utf8").replace(
  /import type \{[\s\S]*?\} from "\.\/entities";\n\n/,
  "",
);

// ── Source sections, with the curated transformations ───────────────────────
let perms = cut(src, "// ─── Permissions", "// ─── Manifest");
const publicPluginPermissions = PLUGIN_PERMISSIONS.filter(
  (permission) => permission !== "reader:modes",
);
perms = swap(
  perms,
  `export type PluginPermission = CorePluginPermission;

/** Runtime validation list, derived from the canonical capability catalogs. */
export const PLUGIN_PERMISSIONS = CORE_PLUGIN_PERMISSIONS;`,
  `export type PluginPermission =
${publicPluginPermissions.map((permission) => `  | "${permission}"`).join("\n")};`,
);
perms = swap(
  perms,
  ` * - \`reader:modes\` — privileged host-rendered reader-mode registration.\n`,
  "",
);

let middle = cut(src, "// ─── Manifest", "// ─── Reader-mode contributions");
middle = swap(
  middle,
  `/** The floor the host clamps \`everyMinutes\` to. */
export const MIN_SCHEDULE_MINUTES = 15;

`,
  "",
);
middle = swap(
  middle,
  "/** Cadence in minutes, floored at MIN_SCHEDULE_MINUTES. */",
  "/** Cadence in minutes, floored at 15. */",
);

// Keep the localized-copy types; drop the reserved reader-mode contract.
let localized = cut(
  src,
  "// ─── Reader-mode contributions",
  "/** One semantic step size declared by a text-unit reader mode. */",
);
localized = swap(
  localized,
  "// ─── Reader-mode contributions ──────────────────────────────────────────────",
  "// ─── Localized copy ──────────────────────────────────────────────────────────",
);

const contributions = cut(
  src,
  "/**\n * A key chord for a command's default binding.",
  "// ─── Events",
);
const eventsTail = cut(src, "/** Book, source, metadata", "// ─── Read models");
const publicReadModels = cut(src, "// ─── Read models", "// ─── Domain APIs");
const domainApis = cut(src, "// ─── Domain APIs", "// ─── Context handed to activate()");

let context = src.slice(src.indexOf("// ─── Context handed to activate()"));
context = swap(
  context,
  `  readerModes?: {
    register(mode: PluginReaderMode): PluginDisposable;
  };
`,
  "",
);

const output =
  mirrorHeader +
  domainVocabulary +
  settingsVocabulary +
  perms +
  middle +
  localized +
  contributions +
  payloadMap +
  eventsTail +
  coreReadModels +
  publicReadModels +
  domainApis +
  context;

writeFileSync(mirrorPath, output);
console.log(`wrote ${mirrorPath} (${output.split("\n").length} lines)`);
console.log("next: cd", marketRoot, "&& bun run typecheck && node scripts/validate.mjs");
