import { createHash } from "node:crypto";

export const ORIGIN = "https://readaware.app";
export const MANIFEST_PATH = "/search-manifest.json";
export const INDEXNOW_KEY = "8ed986b9ae974eed8b63cce94762a5d4";

export async function contentHash(html) {
  const text = [];
  const attributes = [];
  await new HTMLRewriter()
    .on("title, main", {
      text(chunk) {
        text.push(chunk.text);
      },
    })
    .on(
      'meta[name="description"], link[rel="canonical"], link[hreflang], main a, main img',
      {
        element(el) {
          attributes.push(
            ["content", "href", "hreflang", "src", "alt"].map((key) =>
              el.getAttribute(key),
            ),
          );
        },
      },
    )
    .transform(new Response(html))
    .text();
  // Ignore bundle hashes, preloads, CSS and React IDs, not visible copy/links.
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: text.join("").replace(/\s+/g, " ").trim(),
        attributes,
      }),
    )
    .digest("hex");
}

export function validateManifest(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.pages) ||
    !value.pages.length
  )
    throw new Error("Invalid search manifest");
  const seen = new Set();
  for (const page of value.pages) {
    const url = new URL(page.url);
    if (
      url.origin !== ORIGIN ||
      url.username || url.password || page.url !== url.href ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith("/") ||
      !/^\/(?:[a-z0-9-]+\/)*$/.test(url.pathname) ||
      url.pathname.startsWith("/sync/") ||
      url.pathname.startsWith("/api/") ||
      !/^[a-f0-9]{64}$/.test(page.hash) ||
      seen.has(page.url)
    ) {
      throw new Error("Invalid public page in search manifest");
    }
    seen.add(page.url);
  }
  return value;
}

export function changedUrls(previous, current) {
  validateManifest(current);
  if (previous) validateManifest(previous);
  const old = new Map(
    (previous?.pages ?? []).map((page) => [page.url, page.hash]),
  );
  const now = new Map(current.pages.map((page) => [page.url, page.hash]));
  return [...new Set([...now.keys(), ...old.keys()])]
    .filter((url) => old.get(url) !== now.get(url))
    .sort();
}

export function submissionUrls(deployed, acknowledged, current) {
  // Deployment and notification can succeed independently. Diff against the
  // last acknowledged manifest too, so a later deploy retries missed changes.
  const pending = acknowledged
    ? changedUrls(acknowledged, current)
    : current.pages.map((page) => page.url);
  return [...new Set([...changedUrls(deployed, current), ...pending])].sort();
}
