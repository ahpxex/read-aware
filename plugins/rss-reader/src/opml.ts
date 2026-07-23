import { isHttpFeedUrl } from "./feed";

export function feedUrlsFromOpml(text: string): string[] {
  const xml = new DOMParser().parseFromString(text, "text/xml");
  if (xml.querySelector("parsererror")) return [];

  return Array.from(xml.querySelectorAll("outline[xmlUrl]"))
    .map((node) => node.getAttribute("xmlUrl")?.trim() ?? "")
    .filter(isHttpFeedUrl);
}
