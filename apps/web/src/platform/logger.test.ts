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
  // Cut mid-URL by the cap: what remains no longer parses and is redacted whole.
  const cut = renderLine("m", "x", [`${"y".repeat(3980)} https://user:SECRET@host.example/x`]);
  expect(cut).not.toContain("SECRET");
  // Cut right after a numeric password, the rest parses as host and port: still redacted.
  const prefix = `${"y".repeat(4000 - "[m] x · ".length - " https://user:12345".length)} `;
  const numeric = renderLine("m", "x", [`${prefix}https://user:12345@host.example/x`]);
  expect(numeric).not.toContain("12345");
  expect(numeric.endsWith("https://<redacted>…")).toBe(true);
});

test("no rendered text can start a line of its own", () => {
  const forged = "x\n[2026-11-18][16:10:44+00:00][ERROR][webview] forged\nfn@http://tauri.localhost/a.js:1:2";
  const line = renderLine("plugins", "Plugin host call failed", ["tts@1.0.0", forged, new Error(forged)]);
  for (const continuation of line.split("\n").slice(1)) expect(continuation).toMatch(/^\s/);
});

test("credentials hidden behind path-like characters, fragments and any scheme are redacted too", () => {
  const line = renderLine("sync", "failed", [
    "https://user:pa/ss?w0rd@dav.example.com/files",
    "https://app.example.com/callback#access_token=SECRET",
    "wss://relay.example.com/v1/events/watch?ticket=SECRET",
    "ftp://anon:SECRET@files.example.com/pub",
    "https://user:pa?ss@dav.example.com/files",
    "(https://user:pa(ss)SECRET@dav.example.com/files?k=SECRET)",
    "url \"https://u:'SECRET'@h.example/x\"",
    "https://h.example/x?k=1:12:34",
    "https://user:SECRET@dav.example.com/files?q=a@b.example#x",
  ]);
  expect(line).not.toContain("SECRET");
  expect(line).not.toContain("pa/ss");
  expect(line).toBe(
    [
      "[sync] failed",
      "https://<redacted>",
      "https://app.example.com/callback#<redacted>",
      "wss://relay.example.com/v1/events/watch?<redacted>",
      "ftp://<redacted>@files.example.com/pub",
      "https://<redacted>",
      "(https://<redacted>@dav.example.com/files?<redacted>)",
      'url "https://<redacted>@h.example/x"',
      "https://h.example/x?<redacted>",
      "https://<redacted>@dav.example.com/files?<redacted>#<redacted>",
    ].join(" · "),
  );
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

test("URLs run together or nested in each other are redacted, never split", () => {
  const json = renderLine("sync", "failed", [
    {
      relay: "https://relay.example/v1",
      dav: "https://u:SECRET@dav.example/x?k=SECRET",
      list: ["wss://w.example/?t=SECRET"],
    },
  ]);
  expect(json).not.toContain("SECRET");
  expect(json).toBe('[sync] failed · {"relay":"https://relay.example/<redacted>"]}');
  const nested = renderLine("auth", "failed", [
    "https://app.example/cb?redirect=https://evil.example/x&token=SECRET",
    `https://h.example/${"a".repeat(2100)}?token=SECRET`,
  ]);
  expect(nested).not.toContain("SECRET");
  expect(nested).toContain("https://app.example/cb?<redacted>");
  const malformed = renderLine("net", "failed", [
    "https://h.example://u:SECRET@x.example/",
    "https://h.example/a/b:SECRET@c/",
  ]);
  expect(malformed).toBe("[net] failed · https://h.example/<redacted> · https://h.example/<redacted>");
});

test("a path with an @ keeps its host, and app frames stay intact", () => {
  expect(
    renderLine("rss", "failed", [
      "error sending request for url (https://mastodon.social/@reader.rss)",
      "at f (tauri://localhost/assets/index-DVCt0CHS.js:5:557)",
      "at g (https://tauri.localhost/assets/plugin-host-BXLa5K2T.js:2:207408)",
    ]),
  ).toBe(
    [
      "[rss] failed",
      "error sending request for url (https://mastodon.social/<redacted>)",
      "at f (tauri://localhost/assets/index-DVCt0CHS.js:5:557)",
      "at g (https://tauri.localhost/assets/plugin-host-BXLa5K2T.js:2:207408)",
    ].join(" · "),
  );
});

test("redaction stays linear on long runs of punctuation and digits", () => {
  const started = performance.now();
  renderLine("m", "x", [`https://h.example/${",".repeat(3900)}a`, `https://h.example/x?${":1".repeat(1900)}`]);
  expect(performance.now() - started).toBeLessThan(100);
});
