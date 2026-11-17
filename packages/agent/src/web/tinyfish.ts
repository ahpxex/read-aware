import { webImages } from "./images";
import { AppError } from "@read-aware/core";
import type { AgentFetch } from "../models/transport";
import type { WebClient, WebClientOptions, WebFetchInput, WebProvider, WebSearchInput } from "./types";
import { firstUsablePage, optionalImages } from "./optional-images";

import {
  bounded,
  invalid,
  jsonRequest,
  malformed,
  publicWebUrl,
  record,
  searchInput,
  searchResult,
  sourceUrl,
  string,
} from "./shared";
export { publicWebUrl } from "./shared";

export function createTinyFishClient(apiKey: string, transport: AgentFetch, options?: WebClientOptions): WebClient {
  const request = jsonRequest("TinyFish", apiKey, transport, { "X-API-Key": apiKey.trim() });
  const client: WebClient = {
    async search(raw: WebSearchInput, signal) {
      // The same input rules and result filtering as every other provider.
      const input = searchInput(raw);
      const params = new URLSearchParams({ query: input.query });
      if (input.recencyDays !== undefined)
        params.set("recency_minutes", String(bounded(input.recencyDays, 1, 1, 3650) * 1440));
      if (input.language !== undefined) params.set("language", input.language);
      if (input.domains?.length) params.set("include_domains", input.domains.join(","));
      const data = await request(`https://api.search.tinyfish.ai?${params}`, undefined, signal);
      if (!Array.isArray(data.results)) throw malformed();
      const result = searchResult(
        "tinyfish",
        input,
        data.results.map((item) => {
          const row = record(item);
          return {
            title: string(row.title, 300),
            url: sourceUrl(row.url),
            snippet: string(row.snippet, 800),
            ...(typeof row.date === "string" ? { publishedAt: row.date.slice(0, 80) } : {}),
          };
        }),
      );
      const sources = result.sources;
      if (!input.includeImages || !sources.length) return { ...result, ...(input.includeImages ? { images: [] } : {}) };
      // TinyFish has no image index. Read at most two ranked sources in parallel,
      // return the first usable one, and cancel the other. The model still chooses
      // relevant images; the excerpt avoids another model round just to find them.
      const page = await optionalImages(
        (signal) =>
          firstUsablePage(
            [...new Set(sources.map((source) => source.url))].slice(0, 2).map(async (url) => {
              const page = await (options?.fetchPage ?? client.fetch)(
                { url, includeImages: true, maxChars: 2000 },
                signal,
              );
              const host = new URL(page.finalUrl).hostname;
              if (
                !page.images?.length ||
                (input.domains?.length &&
                  !input.domains.some(
                    (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
                  ))
              )
                throw new Error("No usable images in scope");
              return page;
            }),
          ),
        signal,
      );
      return {
        ...result,
        images: page?.images ?? [],
        ...(page
          ? {
              imageContext: [
                {
                  finalUrl: page.finalUrl,
                  title: page.title,
                  text: page.text,
                  nextOffset: page.nextOffset,
                  retrievedAt: page.retrievedAt,
                },
              ],
            }
          : {
              warnings: [
                "The bounded image lookup found no usable candidates. It may have timed out or failed; this does not establish that the sources contain no images. Read a relevant source with includeImages=true if needed.",
              ],
            }),
      };
    },
    async fetch(input: WebFetchInput, signal) {
      const url = publicWebUrl(input.url);
      const offset = bounded(input.offset, 0, 0, 4_000_000);
      const maxChars = bounded(input.maxChars, 8000, 500, 12000);
      const data = await request(
        "https://api.fetch.tinyfish.ai",
        {
          urls: [url],
          format: "markdown",
          ...(input.includeImages ? { image_links: true } : {}),
          ttl: input.fresh ? 0 : 3600,
          per_url_timeout_ms: 45000,
        },
        signal,
      );
      if (!Array.isArray(data.results) || (data.errors !== undefined && !Array.isArray(data.errors))) throw malformed();
      if (!data.results.length) {
        const failure = Array.isArray(data.errors) && data.errors.length ? record(data.errors[0]) : null;
        const code =
          failure?.error === "timeout"
            ? "timeout"
            : failure?.error === "content_too_large"
              ? "too-large"
              : "fetch-failed";
        throw new AppError(`search/${code}`, "TinyFish could not read this URL", { retryable: code === "timeout" });
      }
      const row = record(data.results[0]);
      if (typeof row.text !== "string" || !row.text.trim())
        throw new AppError("search/fetch-failed", "Page contains no readable text");
      if (offset > row.text.length) throw invalid();
      const end = Math.min(offset + maxChars, row.text.length);
      return {
        provider: "tinyfish",
        url,
        finalUrl: sourceUrl(row.final_url ?? row.url ?? url),
        title: string(row.title, 300),
        text: row.text.slice(offset, end),
        offset,
        nextOffset: end < row.text.length ? end : null,
        ...(typeof row.published_date === "string" ? { publishedAt: row.published_date.slice(0, 80) } : {}),
        retrievedAt: new Date().toISOString(),
        ...(input.includeImages
          ? { images: webImages(row.image_links, row.final_url ?? row.url ?? url, row.title) }
          : {}),
      };
    },
  };
  return client;
}

export const tinyFishProvider: WebProvider = {
  id: "tinyfish",
  label: "TinyFish",
  keyUrl: "https://agent.tinyfish.ai/api-keys",
  supportsFetch: true,
  create: createTinyFishClient,
};
