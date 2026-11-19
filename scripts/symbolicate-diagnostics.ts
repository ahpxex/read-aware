#!/usr/bin/env bun
/**
 * Maps the minified stack frames in a diagnostics bundle back to source.
 *
 *   bun scripts/symbolicate-diagnostics.ts <readaware-diagnostics.json> [--maps <dir|zip>]... [--out <file>]
 *
 * Without --maps, the release's archives are downloaded with `gh`: every
 * `*-<platform>*-sourcemaps.zip` of tag `v<appVersion>` (CI attaches one per
 * build job; see docs/development/diagnostics.md). A frame such as
 * `http://tauri.localhost/assets/plugin-host-BXLa5K2T.js:2:207408` gains
 * `→ src/features/plugins/runtime/plugin-worker-host.ts:992:30 (onmessage)`.
 * Asset names are content hashes, so a map applies only to the exact bytes
 * it was built with; frames whose asset has no map are listed, not guessed.
 */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, relative } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

type Bundle = {
  appVersion?: string | null;
  platform?: string;
  build?: { commit?: string };
  logs?: { name: string; text: string }[] | { unavailable: string };
};

/** `scheme://host/<asset>.js:line:column` as the webviews print frames. */
const FRAME = /\b(?:https?|tauri):\/\/[^\s/()]+\/([^\s():?#]+\.m?js):(\d+):(\d+)/g;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("usage: bun scripts/symbolicate-diagnostics.ts <bundle.json> [--maps <dir|zip>]... [--out <file>]");
  process.exit(2);
}

function run(command: string[], cwd?: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** A directory of maps, unzipping an archive first. */
async function mapsDirectory(source: string): Promise<string> {
  if (!source.endsWith(".zip")) return source;
  const dir = await mkdtemp(join(tmpdir(), "ra-sourcemaps-"));
  run(["unzip", "-q", source, "-d", dir]);
  return dir;
}

async function downloadReleaseMaps(bundle: Bundle): Promise<string[]> {
  if (!bundle.appVersion || !bundle.platform) usage("The bundle names no app version or platform; pass --maps.");
  const dir = await mkdtemp(join(tmpdir(), "ra-release-maps-"));
  const tag = `v${bundle.appVersion}`;
  console.error(`Downloading ${tag} source maps for ${bundle.platform}…`);
  run(["gh", "release", "download", tag, "--pattern", `*-${bundle.platform}*-sourcemaps.zip`, "--dir", dir]);
  return (await readdir(dir)).filter((name) => name.endsWith(".zip")).map((name) => join(dir, name));
}

const args = process.argv.slice(2);
const bundlePath = args.shift();
if (!bundlePath || bundlePath.startsWith("--")) usage();
const sources: string[] = [];
let out: string | undefined;
while (args.length) {
  const flag = args.shift();
  const value = args.shift();
  if (!value) usage(`${flag} needs a value`);
  if (flag === "--maps") sources.push(value);
  else if (flag === "--out") out = value;
  else usage(`unknown option ${flag}`);
}

const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as Bundle;
if (!Array.isArray(bundle.logs)) usage("The bundle holds no logs.");

// Index every map by the asset path it belongs to (`assets/x.js.map` → `assets/x.js`).
const maps = new Map<string, string>();
const commits = new Set<string>();
for (const source of sources.length ? sources : await downloadReleaseMaps(bundle)) {
  const dir = await mapsDirectory(source);
  for (const path of await files(dir)) {
    if (path.endsWith(".map")) maps.set(relative(dir, path).slice(0, -".map".length), path);
    else if (path.endsWith("build.json")) {
      const stamp = JSON.parse(await readFile(path, "utf8")) as { commit?: string };
      if (stamp.commit) commits.add(stamp.commit);
    }
  }
}
if (bundle.build?.commit && commits.size && !commits.has(bundle.build.commit)) {
  console.error(
    `Note: the bundle was built from ${bundle.build.commit}, the maps from ${[...commits].join(", ")}; ` +
      "frames still map wherever an asset's hashed name matches.",
  );
}

const traces = new Map<string, TraceMap>();
async function trace(asset: string): Promise<TraceMap | undefined> {
  const path = maps.get(asset);
  if (!path) return undefined;
  if (!traces.has(asset)) traces.set(asset, new TraceMap(await readFile(path, "utf8")));
  return traces.get(asset);
}

/** `../../src/x.ts` → `src/x.ts`; dependencies keep their `node_modules/` path. */
const sourcePath = (source: string) => normalize(source).replace(/^(\.\.[\\/])+/, "");

let mapped = 0;
const missing = new Set<string>();
const rendered: string[] = [];
for (const log of bundle.logs) {
  let text = log.text;
  const replacements: { from: number; to: number; value: string }[] = [];
  for (const match of text.matchAll(FRAME)) {
    const [frame, asset, line, column] = match;
    const map = await trace(asset);
    if (!map) {
      missing.add(asset);
      continue;
    }
    // Stack columns are 1-based; source map columns are 0-based.
    const original = originalPositionFor(map, { line: Number(line), column: Number(column) - 1 });
    if (original.source === null) continue;
    mapped += 1;
    const name = original.name ? ` (${original.name})` : "";
    replacements.push({
      from: match.index,
      to: match.index + frame.length,
      value: `${frame} → ${sourcePath(original.source)}:${original.line}:${original.column + 1}${name}`,
    });
  }
  for (const { from, to, value } of replacements.reverse()) text = text.slice(0, from) + value + text.slice(to);
  rendered.push(`===== ${log.name} =====\n${text}`);
}

const output = rendered.join("\n");
if (out) await writeFile(out, output);
else process.stdout.write(output);
console.error(`Mapped ${mapped} frame(s).`);
if (missing.size) console.error(`No map for: ${[...missing].sort().join(", ")}`);
