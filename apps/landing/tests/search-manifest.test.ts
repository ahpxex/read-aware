import { expect, test } from "bun:test";
import {
  changedUrls,
  contentHash,
  INDEXNOW_KEY,
  submissionUrls,
  validateManifest,
} from "../scripts/search-manifest.mjs";

const page = (path: string, hash = "a".repeat(64)) => ({
  url: `https://readaware.app${path}`,
  hash,
});
test("IndexNow notifies only added, changed and removed public URLs", () => {
  const before = {
    version: 1,
    pages: [page("/"), page("/docs/"), page("/old/")],
  };
  const after = {
    version: 1,
    pages: [page("/"), page("/docs/", "b".repeat(64)), page("/new/")],
  };
  expect(changedUrls(before, after)).toEqual([
    "https://readaware.app/docs/",
    "https://readaware.app/new/",
    "https://readaware.app/old/",
  ]);
  expect(changedUrls(after, after)).toEqual([]);
  expect(changedUrls(null, after)).toHaveLength(3);
});
test("rejects private, duplicate, offsite and noncanonical URLs", () => {
  for (const invalid of [
    page("/sync/login/"),
    page("/api/events/"),
    page("/docs"),
    page("/?token=x"),
    { ...page("/"), url: "https://evil.test/" },
    { ...page("/"), hash: "x" },
  ]) {
    expect(() => validateManifest({ version: 1, pages: [invalid] })).toThrow();
  }
  expect(() =>
    validateManifest({ version: 1, pages: [page("/"), page("/")] }),
  ).toThrow();
});
test("a failed notification is retried even when the next deploy has identical content", () => {
  const acknowledged = { version: 1, pages: [page("/"), page("/removed/")] };
  const deployed = {
    version: 1,
    pages: [page("/", "b".repeat(64)), page("/new/")],
  };
  expect(submissionUrls(deployed, acknowledged, deployed)).toEqual([
    "https://readaware.app/",
    "https://readaware.app/new/",
    "https://readaware.app/removed/",
  ]);
  expect(submissionUrls(deployed, deployed, deployed)).toEqual([]);
  expect(submissionUrls(deployed, null, deployed)).toHaveLength(2);
});
test("content hashes ignore deployment-only bundle changes but catch content, links and metadata", async () => {
  const html =
    '<head><title>Reader</title><meta name="description" content="Books"><script src="/a.js"></script></head><main><h1>ReadAware</h1><a href="/docs/">Docs</a><img src="/reader.png" alt="Reader"></main>';
  const hash = await contentHash(html);
  expect(await contentHash(html.replace("/a.js", "/b.js"))).toBe(hash);
  for (const [a, b] of [
    ["Books", "Comics"],
    ["ReadAware", "Reader app"],
    ["/docs/", "/pricing/"],
    ["/reader.png", "/new.png"],
  ]) {
    expect(await contentHash(html.replace(a!, b!))).not.toBe(hash);
  }
  expect(
    (
      await Bun.file(
        new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url),
      ).text()
    ).trim(),
  ).toBe(INDEXNOW_KEY);
});
