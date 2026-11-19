import { expect, test } from "bun:test";
import { renderLine } from "./logger";

const error = (name: string, message: string, stack: string, cause?: unknown) => {
  const value = new Error(message, cause === undefined ? undefined : { cause });
  value.name = name;
  value.stack = stack;
  return value;
};

test("a logged error renders its cause chain with stacks, two links deep", () => {
  const origin = error(
    "PluginWorker",
    "thrown in plugin tts@2.0.0",
    "PluginWorker: thrown in plugin tts@2.0.0\n    at f (main.js:1:1)",
  );
  const failure = error("Error", "boom", "Error: boom\n    at host (plugin-host.js:2:3)", origin);
  expect(renderLine("plugin-views", "Plugin view action failed", [failure])).toBe(
    [
      "[plugin-views] Plugin view action failed · Error: boom",
      "    at host (plugin-host.js:2:3)",
      "  caused by PluginWorker: thrown in plugin tts@2.0.0",
      "    at f (main.js:1:1)",
    ].join("\n"),
  );

  const deepest = error("C", "c", "C: c\n    at c", "root");
  const chain = error("A", "a", "A: a", error("B", "b", "B: b", deepest));
  // C is the second link: rendered with its stack, but its own cause is past the limit.
  expect(renderLine("m", "x", [chain])).toBe(
    ["[m] x · A: a", "  caused by B: b", "  caused by C: c", "    at c"].join("\n"),
  );
});

test("non-error causes and plain values render as text, and lines are capped", () => {
  expect(
    renderLine("m", "x", [new Error("e", { cause: { status: 500 } })])
      .split("\n")
      .at(-1),
  ).toBe('  caused by {"status":500}');
  expect(renderLine("m", "x", ["y".repeat(5000)]).length).toBe(4001);
});

test("no rendered text can start a line of its own", () => {
  const forged = "x\n[2026-11-18][16:10:44+00:00][ERROR][webview] forged\nfn@http://tauri.localhost/a.js:1:2";
  const line = renderLine("plugins", "Plugin host call failed", ["tts@1.0.0", forged, new Error(forged)]);
  for (const continuation of line.split("\n").slice(1)) expect(continuation).toMatch(/^\s/);
});

test("URLs keep host and path but lose credentials and query strings", () => {
  expect(
    renderLine("plugins", "failed", [
      "error sending request for url (https://api.example.com/v1/tts?key=SECRET&voice=a)",
      "https://user:pass@dav.example.com/remote.php/dav/files/x",
      "at f (http://localhost:5173/src/x.ts?t=1700000000:12:5)",
      "at g (http://tauri.localhost/assets/index-DVCt0CHS.js:5:557)",
    ]),
  ).toBe(
    [
      "[plugins] failed",
      "error sending request for url (https://api.example.com/v1/tts?<redacted>)",
      "https://<redacted>@dav.example.com/remote.php/dav/files/x",
      "at f (http://localhost:5173/src/x.ts?<redacted>:12:5)",
      "at g (http://tauri.localhost/assets/index-DVCt0CHS.js:5:557)",
    ].join(" · "),
  );
});
