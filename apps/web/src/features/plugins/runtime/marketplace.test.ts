import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchMarketplaceRegistry, orderMirrors } from "./marketplace";

// localKV falls back to localStorage outside Tauri; the bare bun runtime has
// none, so back it with a map the tests control.
const kvBacking = new Map<string, string>();
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
const realFetch = globalThis.fetch;

beforeEach(() => {
  kvBacking.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => kvBacking.get(key) ?? null,
    setItem: (key: string, value: string) => void kvBacking.set(key, value),
    removeItem: (key: string) => void kvBacking.delete(key),
  };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).localStorage = realLocalStorage;
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string) => Response) {
  const hosts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    hosts.push(new URL(url).hostname);
    return handler(url);
  }) as typeof fetch;
  return hosts;
}

const SOURCES = ["https://raw.example/main", "https://cdn.example/main"];

describe("orderMirrors", () => {
  test("keeps the configured order when nothing is remembered", () => {
    expect(orderMirrors(SOURCES, null)).toEqual(SOURCES);
  });

  test("moves the remembered mirror to the front", () => {
    expect(orderMirrors(SOURCES, "https://cdn.example/main")).toEqual([
      "https://cdn.example/main",
      "https://raw.example/main",
    ]);
  });

  test("remembered mirror already first stays put", () => {
    expect(orderMirrors(SOURCES, "https://raw.example/main")).toEqual(SOURCES);
  });

  test("ignores a remembered mirror that is no longer configured", () => {
    expect(orderMirrors(SOURCES, "https://gone.example/main")).toEqual(SOURCES);
  });
});

describe("fetchMarketplaceRegistry mirror memory", () => {
  const registry = () => new Response(JSON.stringify({ plugins: [] }));

  test("remembers the mirror that answered and tries it first next time", async () => {
    const hosts = stubFetch((url) => {
      if (url.includes("raw.githubusercontent.com")) throw new Error("blocked");
      return registry();
    });

    await fetchMarketplaceRegistry();
    expect(hosts).toEqual(["raw.githubusercontent.com", "cdn.jsdelivr.net"]);

    hosts.length = 0;
    await fetchMarketplaceRegistry();
    expect(hosts).toEqual(["cdn.jsdelivr.net"]);
  });

  test("a non-ok response is not remembered as good", async () => {
    const hosts = stubFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? new Response("missing", { status: 404 })
        : registry(),
    );

    await fetchMarketplaceRegistry();
    hosts.length = 0;
    await fetchMarketplaceRegistry();
    expect(hosts).toEqual(["cdn.jsdelivr.net"]);
  });

  test("keeps no memory when every mirror fails", async () => {
    stubFetch(() => {
      throw new Error("offline");
    });

    await expect(fetchMarketplaceRegistry()).rejects.toThrow("offline");

    const hosts = stubFetch(() => registry());
    await fetchMarketplaceRegistry();
    expect(hosts).toEqual(["raw.githubusercontent.com"]);
  });
});
