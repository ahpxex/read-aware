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

const repoRoot = resolve(import.meta.dir, "..");
const marketRoot = resolve(process.argv[2] ?? join(repoRoot, "../readaware-plugins"));
const sourcePath = join(repoRoot, "packages/plugin-types/src/index.ts");
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
const mirrorHeader = cut(mirror, "/**\n * MIRROR", "// ─── Permissions");
const payloadMap = cut(mirror, "// ─── Events", "/** Everything library management emits");
const readModels = cut(mirror, "// ─── Read models", "// ─── Domain APIs");

// ── Source sections, with the curated transformations ───────────────────────
let perms = cut(src, "// ─── Permissions", "// ─── Manifest");
perms = swap(
  perms,
  `export const PLUGIN_PERMISSIONS = [
  "reader:modes",
  "ui:themes",
  "shelf:read",
  "shelf:write",
  "annotations:read",
  "annotations:write",
  "conversations:read",
  "agent:tools",
  "service:network",
  "service:llm",
  "service:clipboard",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];`,
  `export type PluginPermission =
  | "ui:themes"
  | "shelf:read"
  | "shelf:write"
  | "annotations:read"
  | "annotations:write"
  | "conversations:read"
  | "agent:tools"
  | "service:network"
  | "service:llm"
  | "service:clipboard";`,
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
const eventsTail = cut(src, "/** Everything library management emits", "// ─── Read models");
const domainApis = cut(src, "// ─── Domain APIs", "// ─── Context handed to activate()");

let context = src.slice(src.indexOf("// ─── Context handed to activate()"));
context = swap(
  context,
  `    goTo(target: { bookId?: string; cfi?: string; href?: string }): void;
    /** \`reader:modes\` — bundled plugins may register a host-rendered reader mode. */
    modes?: {
      register(mode: PluginReaderMode): PluginDisposable;
    };
  };`,
  `    goTo(target: { bookId?: string; cfi?: string; href?: string }): void;
  };`,
);

const output =
  mirrorHeader +
  perms +
  middle +
  localized +
  contributions +
  payloadMap +
  eventsTail +
  readModels +
  domainApis +
  context;

writeFileSync(mirrorPath, output);
console.log(`wrote ${mirrorPath} (${output.split("\n").length} lines)`);
console.log("next: cd", marketRoot, "&& bun run typecheck && node scripts/validate.mjs");
