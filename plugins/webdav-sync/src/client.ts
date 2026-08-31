/**
 * A small WebDAV client over the plugin sandbox's `network.fetch` (the Rust
 * HTTP client — no CORS, custom verbs pass through). Only what the transport
 * needs: GET / PUT (optionally create-only) / DELETE / MKCOL chains / PROPFIND
 * Depth-1 listings / a reachability probe.
 *
 * Failure vocabulary: HTTP statuses that have a meaning in the sync contract
 * become errors carrying a stable `code` (`sync/unauthorized`, `sync/quota`,
 * …) — codes survive the sandbox bridge, drive the host's rejected-vs-retry
 * decisions, and render localized copy. Everything else throws uncoded and is
 * retried with backoff.
 *
 * The Worker has no DOMParser, so multistatus XML is parsed with the bundled
 * fast-xml-parser (same approach as the RSS plugin).
 */
import { XMLParser } from "fast-xml-parser";

export type WebdavFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WebdavClientOptions = {
  /** Absolute base URL of the sync folder, no trailing slash. */
  baseUrl: string;
  username: string;
  password: string;
  fetchFn: WebdavFetch;
  /** Control-op timeout (PROPFIND/MKCOL/DELETE); tests shrink it. */
  timeoutMs?: number;
  /** Data-op timeout (GET/PUT of objects) — generous, because an 8 MiB blob
   *  part on a slow uplink must be allowed to finish rather than looping
   *  through abort-and-retry forever. */
  dataTimeoutMs?: number;
};

export type WebdavChild = { name: string; collection: boolean };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DATA_TIMEOUT_MS = 300_000;

/** Errors the host's sync stack understands by `code` (see @read-aware/core
 *  errors.ts — string literals here, the plugin has no host dependency). */
function codeForStatus(status: number): string | null {
  if (status === 401 || status === 403) return "sync/unauthorized";
  if (status === 507) return "sync/quota";
  if (status === 413) return "sync/file-too-large";
  if (status === 429) return "sync/rate-limited";
  if (status >= 500) return "sync/server";
  return null;
}

export function webdavError(status: number, method: string, url: string): Error {
  const error = new Error(`webdav: ${method} ${url} answered ${status}`);
  const code = codeForStatus(status);
  return code ? Object.assign(error, { code }) : error;
}

const networkError = (method: string, url: string, cause: unknown): Error =>
  Object.assign(
    new Error(
      `webdav: ${method} ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    ),
    { code: "sync/network" },
  );

/** UTF-8-safe Basic credentials (btoa alone rejects non-Latin-1 passwords). */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  // A single <response> must still arrive as an array-like shape.
  isArray: (tagName) => tagName === "response" || tagName === "propstat",
});

/** Normalize a pathname for comparison: decoded, no trailing slash. */
function normalizePath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Keep the raw path — comparison just has to be consistent.
  }
  return decoded.replace(/\/+$/, "");
}

export type WebdavClient = ReturnType<typeof createWebdavClient>;

export function createWebdavClient(options: WebdavClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dataTimeoutMs = options.dataTimeoutMs ?? options.timeoutMs ?? DEFAULT_DATA_TIMEOUT_MS;
  const auth = basicAuth(options.username, options.password);
  /** Collections this session has already verified/created. */
  const ensured = new Set<string>();

  /** Base + path segments (each percent-encoded onto the wire). */
  const urlFor = (segments: string[], directory = false): string => {
    const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
    return `${base}${path ? `/${path}` : ""}${directory ? "/" : ""}`;
  };

  async function request(
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number } = {},
  ): Promise<Response> {
    try {
      return await options.fetchFn(url, {
        method,
        headers: { authorization: auth, ...init.headers },
        body: init.body,
        redirect: "follow",
        signal: AbortSignal.timeout(init.timeoutMs ?? timeoutMs),
      });
    } catch (cause) {
      throw networkError(method, url, cause);
    }
  }

  /** GET an object; null when the server doesn't have it. */
  async function get(segments: string[]): Promise<Uint8Array | null> {
    const url = urlFor(segments);
    const res = await request("GET", url, { timeoutMs: dataTimeoutMs });
    if (res.status === 404) return null;
    if (!res.ok) throw webdavError(res.status, "GET", url);
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * PUT an object. With `ifNoneMatch`, the write is create-only: an existing
   * object answers `"exists"` and stays untouched (412 from compliant
   * servers; a read-back compare catches servers that ignore the header).
   */
  async function put(
    segments: string[],
    bytes: Uint8Array,
    opts: { ifNoneMatch?: boolean } = {},
  ): Promise<"stored" | "exists"> {
    const url = urlFor(segments);
    const headers: Record<string, string> = { "content-type": "application/octet-stream" };
    if (opts.ifNoneMatch) headers["if-none-match"] = "*";
    const res = await request("PUT", url, {
      headers,
      body: bytes as unknown as BodyInit,
      timeoutMs: dataTimeoutMs,
    });
    if (opts.ifNoneMatch && res.status === 412) return "exists";
    if (!res.ok) throw webdavError(res.status, "PUT", url);
    return "stored";
  }

  /** DELETE an object; a 404 is already the desired state. */
  async function remove(segments: string[]): Promise<void> {
    const url = urlFor(segments);
    const res = await request("DELETE", url);
    if (!res.ok && res.status !== 404) throw webdavError(res.status, "DELETE", url);
  }

  /**
   * Make sure the collection chain base/…/segments exists, creating each
   * level with MKCOL. 405 means "already there" (the usual answer on an
   * existing collection); anything else unexpected throws.
   */
  async function ensureCollections(segments: string[]): Promise<void> {
    for (let depth = 0; depth <= segments.length; depth += 1) {
      const prefix = segments.slice(0, depth);
      const key = prefix.join("/");
      if (ensured.has(key)) continue;
      const url = urlFor(prefix, true);
      const res = await request("MKCOL", url);
      // 2xx = created; 405 = exists. Both mean the level is usable.
      if (!res.ok && res.status !== 405) throw webdavError(res.status, "MKCOL", url);
      ensured.add(key);
    }
  }

  /**
   * Depth-1 listing of a collection: its immediate children (never itself),
   * decoded names + whether each is a collection. Null when the collection
   * does not exist.
   */
  async function listChildren(segments: string[]): Promise<WebdavChild[] | null> {
    const url = urlFor(segments, true);
    const res = await request("PROPFIND", url, {
      headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return null;
    // 207 Multi-Status is the correct answer; tolerate a plain 2xx.
    if (res.status !== 207 && !res.ok) throw webdavError(res.status, "PROPFIND", url);
    const text = await res.text();
    let doc: unknown;
    try {
      doc = parser.parse(text);
    } catch {
      throw new Error(`webdav: PROPFIND ${url} answered unparseable XML`);
    }
    const multistatus = (doc as { multistatus?: { response?: unknown[] } }).multistatus;
    const responses = Array.isArray(multistatus?.response) ? multistatus.response : [];
    const selfPath = normalizePath(new URL(url).pathname);
    const children: WebdavChild[] = [];
    for (const entry of responses) {
      const record = entry as { href?: unknown; propstat?: unknown[] };
      if (typeof record.href !== "string") continue;
      let pathname: string;
      try {
        pathname = new URL(record.href, url).pathname;
      } catch {
        continue;
      }
      const normalized = normalizePath(pathname);
      if (normalized === selfPath) continue;
      const name = normalized.slice(normalized.lastIndexOf("/") + 1);
      if (!name) continue;
      const propstats = Array.isArray(record.propstat) ? record.propstat : [];
      const collection = propstats.some((propstat) => {
        const prop = (propstat as { prop?: { resourcetype?: unknown } }).prop;
        const resourcetype = prop?.resourcetype;
        return (
          resourcetype !== null &&
          typeof resourcetype === "object" &&
          "collection" in (resourcetype as Record<string, unknown>)
        );
      });
      children.push({ name, collection });
    }
    return children;
  }

  /** Reachability + credential check: the base folder answers PROPFIND. */
  async function probe(): Promise<void> {
    await ensureCollections([]);
    const url = urlFor([], true);
    const res = await request("PROPFIND", url, {
      headers: { depth: "0", "content-type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    });
    if (res.status !== 207 && !res.ok) throw webdavError(res.status, "PROPFIND", url);
  }

  return { get, put, remove, ensureCollections, listChildren, probe };
}
