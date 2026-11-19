import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Production bundles are built with hidden source maps (`build.sourcemap:
 * "hidden"`: the maps are written, the bundles carry no `sourceMappingURL`).
 * This moves every map out of `dist/` into `sourcemaps/` beside it, so the
 * desktop shell, which embeds all of `dist/`, never ships one, and CI archives
 * `sourcemaps/` with the release. `scripts/symbolicate-diagnostics.ts` maps a
 * diagnostics bundle's stack frames back to source with that archive.
 *
 * Asset file names are content hashes, so a frame's file name alone selects
 * its map; `build.json` records the commit only as a sanity check.
 */
export function archiveSourcemaps(commit: string): Plugin {
  let outDir = "";
  let assetsDir = "";
  let archiveDir = "";
  return {
    name: "readaware-archive-sourcemaps",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      assetsDir = join(outDir, config.build.assetsDir);
      archiveDir = resolve(config.root, "sourcemaps");
    },
    async closeBundle() {
      await rm(archiveDir, { recursive: true, force: true });
      const maps = (await files(outDir)).filter((path) => path.endsWith(".map"));
      for (const path of maps) {
        const target = join(archiveDir, relative(outDir, path));
        await mkdir(dirname(target), { recursive: true });
        await rename(path, target);
      }
      await mkdir(archiveDir, { recursive: true });
      await writeFile(join(archiveDir, "build.json"), `${JSON.stringify({ commit, maps: maps.length }, null, 2)}\n`);

      // The guard: nothing that ships may carry or point at a map. Only the
      // bundler's own output is checked for references; vendored files under
      // public/ keep the upstream comments they arrived with.
      const shipped = await files(outDir);
      const leftover = shipped.filter((path) => path.endsWith(".map"));
      const referencing: string[] = [];
      for (const path of shipped.filter((file) => file.startsWith(assetsDir) && /\.(c|m)?js$/.test(file))) {
        if ((await readFile(path, "utf8")).includes("sourceMappingURL=")) referencing.push(path);
      }
      if (leftover.length || referencing.length)
        this.error(
          `Source maps would ship in dist/: ${[...leftover, ...referencing].map((path) => relative(outDir, path)).join(", ")}`,
        );
      if (!maps.length) this.error("The production build wrote no source maps to archive");
    },
  };
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}
