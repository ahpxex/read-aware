import { describe, expect, test } from "bun:test";
import {
  analyticsAllowed,
  DOWNLOAD_ASSETS,
  sourceFrom,
  validateEvent,
  type SiteEvent,
} from "../src/lib/site-events";
import { resolveAttribution, SESSION_MS } from "../src/lib/site-attribution";
import worker from "../src/worker";

const pages = new Set(["/", "/zh/", "/epub-reader-for-android/"]);
const entry: SiteEvent = {
  version: 1,
  event: "landing",
  source: "chatgpt",
  landing: "/",
  page: "/",
  asset: "",
  release: "v0.5.4",
};
const download = {
  ...entry,
  event: "download",
  asset: "ReadAware-android-arm64.apk",
};
const url = (path = "/") => new URL(`https://readaware.app${path}`);

test("source categories strip all free-form referrer and campaign data", () => {
  for (const [referrer, source] of [
    ["https://www.google.com/search?q=private", "google"],
    ["https://chatgpt.com/c/private-id", "chatgpt"],
    ["https://www.bing.com/search?q=book", "bing"],
    ["https://copilot.microsoft.com/", "copilot"],
    ["https://google.com.evil.test/", "other"],
    ["https://secret.example/user/email", "other"],
    ["", "direct"],
  ])
    expect(sourceFrom(url(), referrer!)).toBe(source);
  expect(
    sourceFrom(url("/?utm_source=chatgpt.com&utm_campaign=secret"), ""),
  ).toBe("chatgpt");
  expect(sourceFrom(url("/?utm_source=someone@example.com"), "")).toBe("other");
});

test("locale redirects and internal navigation preserve attribution without counting another entry", () => {
  const first = resolveAttribution(
    null,
    url("/?utm_source=chatgpt.com"),
    "",
    pages,
    100,
  );
  expect(first.fresh).toBe(true);
  const redirected = resolveAttribution(
    first.attribution,
    url("/zh/?utm_source=chatgpt.com"),
    "https://readaware.app/",
    pages,
    200,
  );
  expect(redirected).toEqual({ attribution: first.attribution, fresh: false });
  const internal = resolveAttribution(
    first.attribution,
    url("/epub-reader-for-android/"),
    "https://readaware.app/zh/",
    pages,
    300,
  );
  expect(internal.fresh).toBe(false);
  expect(internal.attribution.landing).toBe("/");
  const expired = resolveAttribution(
    first.attribution,
    url("/zh/"),
    "",
    pages,
    SESSION_MS + 101,
  );
  expect(expired.fresh).toBe(true);
  expect(expired.attribution.source).toBe("direct");
  expect(
    resolveAttribution(
      { ...first.attribution, landing: "/private/email" },
      url(),
      "",
      pages,
      200,
    ).fresh,
  ).toBe(true);
});

test("opt-outs, previews and secret-bearing pages never enable either analytics script", () => {
  expect(analyticsAllowed(url(), null, false)).toBe(true);
  for (const path of [
    "/sync/login/",
    "/pricing/#upgrade=ticket",
    "/?email=private",
    "/?token=private",
  ]) {
    expect(analyticsAllowed(url(path), null, false)).toBe(false);
  }
  expect(analyticsAllowed(new URL("http://localhost:4175/"), null, false)).toBe(
    false,
  );
  expect(
    analyticsAllowed(new URL("https://preview.workers.dev/"), null, false),
  ).toBe(false);
  expect(analyticsAllowed(url(), "1", false)).toBe(false);
  expect(analyticsAllowed(url(), null, true)).toBe(false);
});

test("event schema permits only known public paths, source categories and official assets", () => {
  expect(validateEvent(entry, pages)).toBe(true);
  for (const asset of DOWNLOAD_ASSETS)
    expect(validateEvent({ ...download, asset: asset.asset }, pages)).toBe(
      true,
    );
  for (const invalid of [
    null,
    [],
    { ...entry, ip: "1.2.3.4" },
    { ...entry, page: "/?email=private" },
    { ...entry, source: "private" },
    { ...download, asset: "unknown.apk" },
    { ...entry, landing: "/sync/login/" },
  ]) {
    expect(validateEvent(invalid, pages)).toBe(false);
  }
});

function harness() {
  const points: unknown[] = [];
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        return new URL(request.url).pathname === "/search-manifest.json"
          ? Response.json({
              version: 1,
              pages: [...pages].map((path) => ({ url: url(path).href })),
            })
          : new Response("asset", { status: 200 });
      },
    },
    SITE_ANALYTICS: {
      writeDataPoint(point: unknown) {
        points.push(point);
      },
    },
  };
  const request = (
    body: unknown = entry,
    headers: Record<string, string> = {},
  ) =>
    new Request(url("/api/site-events"), {
      method: "POST",
      headers: {
        origin: "https://readaware.app",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { points, env, request };
}

describe("Worker endpoint", () => {
  test("writes a fixed anonymous schema and leaves assets alone", async () => {
    const { env, points, request } = harness();
    const response = await worker.fetch(request(download), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(points).toEqual([
      {
        indexes: ["chatgpt"],
        blobs: [
          "v1",
          "download",
          "chatgpt",
          "/",
          "/",
          "android",
          download.asset,
          "v0.5.4",
        ],
        doubles: [1],
      },
    ]);
    expect(
      await (await worker.fetch(new Request(url("/zh/")), env)).text(),
    ).toBe("asset");
  });
  test("rejects cross-origin, GET, malformed and oversized input without writes", async () => {
    const { env, points, request } = harness();
    expect(
      (
        await worker.fetch(
          request(entry, { origin: "https://evil.example" }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (await worker.fetch(new Request(url("/api/site-events")), env)).status,
    ).toBe(405);
    expect(
      (
        await worker.fetch(
          request(entry, { "content-type": "text/plain" }),
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (await worker.fetch(request({ ...entry, secret: "x".repeat(2000) }), env))
        .status,
    ).toBe(400);
    expect(
      (await worker.fetch(request({ ...entry, page: "/not-a-page/" }), env))
        .status,
    ).toBe(400);
    const malformed = request();
    expect(
      (await worker.fetch(new Request(malformed, { body: "{" }), env)).status,
    ).toBe(400);
    expect(points).toEqual([]);
  });
  test("honors privacy headers and handles missing bindings without exposing errors", async () => {
    const { env, points, request } = harness();
    expect((await worker.fetch(request(entry, { dnt: "1" }), env)).status).toBe(
      204,
    );
    expect(
      (await worker.fetch(request(entry, { "sec-gpc": "1" }), env)).status,
    ).toBe(204);
    expect(points).toEqual([]);
    env.SITE_ANALYTICS.writeDataPoint = () => {
      throw new Error("private detail");
    };
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
