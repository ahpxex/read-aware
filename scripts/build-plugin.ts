import { cp, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type PluginManifestFile = {
  id?: unknown;
  main?: unknown;
  version?: unknown;
};

type PluginPackageFile = {
  name?: unknown;
  version?: unknown;
};

const packageRoot = resolve(process.cwd());
const manifestPath = join(packageRoot, "manifest.json");
const packagePath = join(packageRoot, "package.json");
const sourcePath = join(packageRoot, "src/index.ts");
const distDir = join(packageRoot, "dist");

const manifest = (await Bun.file(manifestPath).json()) as PluginManifestFile;
const packageJson = (await Bun.file(packagePath).json()) as PluginPackageFile;

if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) {
  throw new Error("Plugin manifest must declare a valid lowercase id");
}
if (basename(packageRoot) !== manifest.id) {
  throw new Error(`Plugin folder must match manifest id "${manifest.id}"`);
}
if (manifest.main !== "main.js") {
  throw new Error(`Plugin "${manifest.id}" must use main.js as its entry`);
}
if (packageJson.name !== `@read-aware/plugin-${manifest.id}`) {
  throw new Error(`Plugin "${manifest.id}" workspace package name does not match its manifest`);
}
if (typeof manifest.version !== "string" || manifest.version !== packageJson.version) {
  throw new Error(`Plugin "${manifest.id}" manifest and package versions must match`);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [sourcePath],
  outdir: distDir,
  naming: "main.js",
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error(`Failed to build plugin "${manifest.id}"`);
}

await cp(manifestPath, join(distDir, "manifest.json"));
