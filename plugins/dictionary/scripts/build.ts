import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const manifestPath = join(packageRoot, "manifest.json");
const packagePath = join(packageRoot, "package.json");

const manifest = (await Bun.file(manifestPath).json()) as Record<string, unknown>;
const packageJson = (await Bun.file(packagePath).json()) as Record<string, unknown>;
if (manifest.id !== "dictionary" || manifest.main !== "main.js") {
  throw new Error("Dictionary manifest must use id 'dictionary' and entry 'main.js'");
}
if (packageJson.name !== "@read-aware/plugin-dictionary") {
  throw new Error("Dictionary workspace package name does not match its build contract");
}
if (manifest.version !== packageJson.version) {
  throw new Error("Dictionary manifest and package versions must match");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(packageRoot, "src/index.ts")],
  outdir: distDir,
  naming: "main.js",
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Failed to build Dictionary plugin");
}

await cp(manifestPath, join(distDir, "manifest.json"));
