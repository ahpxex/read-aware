/**
 * Semantic tests for `patchedDependencies` reachable from this package:
 * `openai` and `@anthropic-ai/sdk` (both via `@earendil-works/pi-ai`) carried a
 * lookbehind in their path-parameter guard, and pi-ai used one to drop lone
 * surrogates — code the app ships to iOS 16.0 WebKit, which cannot parse
 * lookbehind (issue #41). These exercise the real patched modules, so a lost
 * or reverted patch fails here.
 */
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const piAi = Bun.resolveSync("@earendil-works/pi-ai", new URL("./probe.ts", import.meta.url).pathname);
// piAi: <store>/node_modules/@earendil-works/pi-ai/dist/index.js — its sibling
// packages in the store are its own dependencies (openai, @anthropic-ai/sdk).
const sibling = (name: string, file: string) =>
  pathToFileURL(join(dirname(dirname(dirname(dirname(piAi)))), name, file)).href;

type PathTag = (statics: TemplateStringsArray, ...params: unknown[]) => string;

const loadPath = async (name: string): Promise<PathTag> => {
  const module = (await import(sibling(name, "internal/utils/path.mjs"))) as { path: PathTag };
  return module.path;
};

describe.each(["openai", "@anthropic-ai/sdk"])("%s path tag", (name) => {
  test("rejects dot-segments with the same spans and accepts safe paths", async () => {
    const path = await loadPath(name);
    expect(path`/v1/${"model"}/run${""}`).toBe("/v1/model/run");

    const message = (fn: () => string) => {
      try {
        fn();
      } catch (error) {
        return String(error);
      }
      throw new Error("expected a throw");
    };
    for (const bad of ["..", "."]) {
      const error = message(() => path`/v1/${bad}/run`);
      expect(error).toContain("invalid segments");
    }
    // `%` in a parameter is percent-encoded before the check; the encoded-dot
    // guard only fires for segments in the literal parts of the template.
    expect(message(() => path(["/v1/%2e%2E/", "/run"] as never, "ok" as never))).toContain("invalid segments");
    // The underline still lands on the segment, not the boundary slash.
    const error = message(() => path`/v1/${".."}/run`);
    const lines = error.split("\n");
    const pathLine = lines.findIndex((line) => line === "/v1/../run");
    expect(pathLine).toBeGreaterThan(-1);
    expect(lines[pathLine + 1]).toBe("    ^^");
  });
});

describe("@earendil-works/pi-ai sanitizeSurrogates", () => {
  test("drops only lone surrogates", async () => {
    const { sanitizeSurrogates } = (await import("@earendil-works/pi-ai/utils/sanitize-unicode")) as {
      sanitizeSurrogates: (text: string) => string;
    };
    expect(sanitizeSurrogates("Hello 🙈 World")).toBe("Hello 🙈 World");
    expect(sanitizeSurrogates(`Text ${String.fromCharCode(0xd83d)} here`)).toBe("Text  here");
    expect(sanitizeSurrogates(`Text ${String.fromCharCode(0xdc00)} here`)).toBe("Text  here");
    expect(sanitizeSurrogates(`a${String.fromCharCode(0xd83d, 0xde00)}b`)).toBe("a😀b");
  });
});
