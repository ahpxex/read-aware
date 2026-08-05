import { XMLParser, XMLValidator } from "fast-xml-parser";
import { isHttpFeedUrl } from "./feed";

// Workers have no DOMParser; OPML parses through the same bundled XML parser
// as the feeds themselves.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
});

/** Collect `xmlUrl` attributes from an outline tree, at any nesting depth. */
function collectFeedUrls(node: unknown, urls: string[]): void {
  for (const outline of Array.isArray(node) ? node : node == null ? [] : [node]) {
    if (!outline || typeof outline !== "object") continue;
    const record = outline as Record<string, unknown>;
    const url = record["@_xmlUrl"];
    if (typeof url === "string" && url.trim()) urls.push(url.trim());
    collectFeedUrls(record.outline, urls);
  }
}

export function feedUrlsFromOpml(text: string): string[] {
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
  return [...new Set(urls)].filter(isHttpFeedUrl);
}
