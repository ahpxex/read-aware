import { XMLParser, XMLValidator } from "fast-xml-parser";
import { isHttpFeedUrl } from "./feed";

export const MAX_OPML_BYTES = 1024 * 1024;
export const MAX_OPML_FEEDS = 1000;

// Workers have no DOMParser; OPML parses through the same bundled XML parser
// as the feeds themselves.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
});

/** Collect `xmlUrl` attributes from an outline tree, at any nesting depth. */
function collectFeedUrls(node: unknown, urls: string[]): void {
  const pending: unknown[] = [node];
  while (pending.length) {
    const outline = pending.pop();
    if (Array.isArray(outline)) { for (let i = outline.length - 1; i >= 0; i--) pending.push(outline[i]); continue; }
    if (!outline || typeof outline !== "object") continue;
    const record = outline as Record<string, unknown>;
    const url = record["@_xmlUrl"];
    if (typeof url === "string" && url.trim()) urls.push(url.trim());
    pending.push(record.outline);
  }
}

export function feedUrlsFromOpml(text: string): string[] {
  if (new TextEncoder().encode(text).byteLength > MAX_OPML_BYTES) throw Object.assign(new Error("OPML exceeds 1 MiB"), { code: "plugin/payload-too-large" });
  if (XMLValidator.validate(text) !== true) return [];
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const body = (doc.opml as Record<string, unknown> | undefined)?.body as
    | Record<string, unknown>
    | undefined;
  const urls: string[] = [];
  collectFeedUrls(body?.outline, urls);
  const feeds = [...new Set(urls)].filter(isHttpFeedUrl);
  if (feeds.length > MAX_OPML_FEEDS || feeds.some(url => url.length > 2048)) {
    throw Object.assign(new Error("OPML exceeds feed count or URL size limit"), { code: "plugin/payload-too-large" });
  }
  return feeds;
}
