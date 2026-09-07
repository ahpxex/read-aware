import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEXNOW_KEY } from "../scripts/search-manifest.mjs";

const manifest = await Bun.file(
  new URL("../dist/search-manifest.json", import.meta.url),
).json();

test.each([200, 202, 422])(
  "deployment submission handles HTTP %s without confusing receipt with indexing",
  async (status) => {
    const dir = await mkdtemp(join(tmpdir(), "readaware-indexnow-"));
    try {
      const before = join(dir, "before.json"),
        ack = join(dir, "ack.json");
      await writeFile(
        before,
        JSON.stringify({ deployed: null, acknowledged: null }),
      );
      const script = `
      const manifest = ${JSON.stringify(manifest)};
      globalThis.fetch = async (url, options) => {
        if (url === "https://readaware.app/search-manifest.json") return Response.json(manifest);
        if (url === "https://readaware.app/${INDEXNOW_KEY}.txt") return new Response(${JSON.stringify(INDEXNOW_KEY)});
        if (url === "https://api.indexnow.org/indexnow") {
          const body = JSON.parse(options.body);
          if (body.host !== "readaware.app" || body.urlList.length !== manifest.pages.length) throw new Error("Invalid submission");
          return new Response(null, {status:${status}});
        }
        throw new Error("Unexpected network request");
      };
      process.argv = ["bun", "indexnow.mjs", "submit", ${JSON.stringify(before)}, ${JSON.stringify(ack)}];
      await import(${JSON.stringify(new URL("../scripts/indexnow.mjs", import.meta.url).href)});
    `;
      const child = Bun.spawn([process.execPath, "--eval", script], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      const exit = await child.exited;
      if (status === 422) {
        expect(exit).not.toBe(0);
        expect(stderr).toContain(
          "deployment succeeded but notification failed",
        );
        expect(await Bun.file(ack).exists()).toBe(false);
      } else {
        expect(exit, stderr).toBe(0);
        expect(stdout).toContain("not an indexing guarantee");
        expect(JSON.parse(await readFile(ack, "utf8"))).toEqual(manifest);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
