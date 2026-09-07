import {
  DOWNLOAD_ASSETS,
  EVENT_PATH,
  SITE_ORIGIN,
  validateEvent,
} from "./lib/site-events";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SITE_ANALYTICS: {
    writeDataPoint(point: {
      indexes: string[];
      blobs: string[];
      doubles: number[];
    }): void;
  };
};
const pageCache = new WeakMap<Env["ASSETS"], Promise<Set<string>>>();
function publicPages(
  request: Request,
  assets: Env["ASSETS"],
): Promise<Set<string>> {
  let cached = pageCache.get(assets);
  if (!cached) {
    cached = (async () => {
      const response = await assets.fetch(
        new Request(new URL("/search-manifest.json", request.url)),
      );
      if (!response.ok) throw new Error("Missing search manifest");
      const manifest = (await response.json()) as {
        version: number;
        pages: { url: string }[];
      };
      if (manifest.version !== 1 || !manifest.pages.length)
        throw new Error("Invalid search manifest");
      return new Set(
        manifest.pages.map((page) => {
          const url = new URL(page.url);
          if (
            url.origin !== SITE_ORIGIN ||
            url.search ||
            url.hash ||
            url.pathname.startsWith("/sync/")
          )
            throw new Error("Invalid page");
          return url.pathname;
        }),
      );
    })();
    pageCache.set(assets, cached);
    void cached.catch(() => pageCache.delete(assets));
  }
  return cached;
}
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const reply = (status: number) => new Response(null, { status, headers });

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== EVENT_PATH)
      return env.ASSETS.fetch(request);
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { ...headers, allow: "POST" },
      });
    if (request.headers.get("origin") !== SITE_ORIGIN) return reply(403);
    if (
      request.headers.get("dnt") === "1" ||
      request.headers.get("sec-gpc") === "1"
    )
      return reply(204);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return reply(415);
    let event: unknown;
    try {
      event = await boundedJson(request);
    } catch {
      return reply(400);
    }
    let pages: Set<string>;
    try {
      pages = await publicPages(request, env.ASSETS);
    } catch {
      return reply(503);
    }
    if (!validateEvent(event, pages)) return reply(400);
    const platform =
      DOWNLOAD_ASSETS.find((asset) => asset.asset === event.asset)?.platform ??
      "";
    try {
      env.SITE_ANALYTICS.writeDataPoint({
        indexes: [event.source],
        blobs: [
          "v1",
          event.event,
          event.source,
          event.landing,
          event.page,
          platform,
          event.asset,
          event.release,
        ],
        doubles: [1],
      });
    } catch {
      // Do not log request headers/body: analytics must not collect identifiers.
      return reply(503);
    }
    return reply(204);
  },
};
