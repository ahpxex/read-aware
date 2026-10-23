// Rebuilds public/foliate-js/vendor/fflate.js from the locked `fflate`
// devDependency: exactly the exports foliate uses (`unzlibSync` for MOBI
// dictionaries, `Inflate` for the DecompressionStream fallback used on
// engines without it, e.g. iOS 16.0–16.3 — issue #41), browser ESM, minified.
// Run via `bun run vendor:fflate` from apps/web.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(web, "scripts/.vendor-fflate-entry.mjs");
const output = resolve(web, "public/foliate-js/vendor/fflate.js");
const manifest = JSON.parse(await Bun.file(resolve(web, "package.json")).text()) as {
  devDependencies: Record<string, string>;
};
const version = manifest.devDependencies.fflate;
if (!version) throw new Error("fflate is not an apps/web devDependency");

writeFileSync(entry, 'export { unzlibSync, Inflate } from "fflate";\n');
try {
  const result = await Bun.build({
    entrypoints: [entry],
    root: web,
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error("fflate vendor build failed");
  }
  const [artifact] = result.outputs;
  const source = await artifact.text();
  const banner = `// fflate ${version} — vendored subset for foliate-js (unzlibSync for MOBI, Inflate for the\n// DecompressionStream fallback on engines without it, issue #41).\n// Regenerate: bun run vendor:fflate (apps/web/scripts/vendor-fflate.ts)\n`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, banner + source);
  console.log(`wrote ${output} (${Buffer.byteLength(banner + source)} bytes, fflate ${version})`);
} finally {
  rmSync(entry, { force: true });
}
