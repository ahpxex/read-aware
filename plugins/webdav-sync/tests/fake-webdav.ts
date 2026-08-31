/**
 * In-memory WebDAV server behind a fetch-shaped function — enough of the
 * protocol for the client and transport suites: GET / PUT (If-None-Match) /
 * DELETE / MKCOL / PROPFIND Depth 0|1 with a multistatus body. Paths are
 * decoded URL segments, so what the tests see mirrors what a real server's
 * filesystem would hold.
 */

export type FakeWebdav = {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  /** Decoded path → object bytes ("base/blobs/bookfile%3A1"). */
  files: Map<string, Uint8Array>;
  collections: Set<string>;
  /** Every request's method+path, for behavioral assertions. */
  requests: Array<{ method: string; path: string }>;
  /** When true, If-None-Match is ignored (a sloppy server overwrites). */
  ignoreIfNoneMatch: boolean;
  /** When set, every request answers this status. */
  failWith: number | null;
};

const decodePath = (url: string): string => {
  const pathname = new URL(url).pathname;
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
};

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error(`fake webdav: unsupported body type ${Object.prototype.toString.call(body)}`);
}

export function fakeWebdavServer(): FakeWebdav {
  const files = new Map<string, Uint8Array>();
  const collections = new Set<string>();
  const requests: FakeWebdav["requests"] = [];

  const server: FakeWebdav = {
    files,
    collections,
    requests,
    ignoreIfNoneMatch: false,
    failWith: null,
    async fetchFn(url, init = {}) {
      const method = (init.method ?? "GET").toUpperCase();
      const path = decodePath(url);
      requests.push({ method, path });
      if (server.failWith !== null) return new Response(null, { status: server.failWith });
      const headers = new Headers(init.headers);

      if (method === "GET") {
        const stored = files.get(path);
        if (!stored) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(stored), { status: 200 });
      }

      if (method === "PUT") {
        if (
          headers.get("if-none-match") === "*" &&
          !server.ignoreIfNoneMatch &&
          files.has(path)
        ) {
          return new Response(null, { status: 412 });
        }
        files.set(path, await bodyBytes(init.body));
        return new Response(null, { status: 201 });
      }

      if (method === "DELETE") {
        if (!files.has(path)) return new Response(null, { status: 404 });
        files.delete(path);
        return new Response(null, { status: 204 });
      }

      if (method === "MKCOL") {
        if (collections.has(path)) return new Response(null, { status: 405 });
        collections.add(path);
        return new Response(null, { status: 201 });
      }

      if (method === "PROPFIND") {
        const depth = headers.get("depth") ?? "1";
        const exists =
          collections.has(path) ||
          files.has(path) ||
          path === "" ||
          [...files.keys(), ...collections].some((entry) => entry.startsWith(`${path}/`));
        if (!exists) return new Response(null, { status: 404 });
        const entries: Array<{ path: string; collection: boolean }> = [
          { path, collection: true },
        ];
        if (depth === "1") {
          const seen = new Set<string>();
          const childOf = (candidate: string): string | null => {
            if (!candidate.startsWith(path === "" ? "" : `${path}/`)) return null;
            const rest = path === "" ? candidate : candidate.slice(path.length + 1);
            const name = rest.split("/")[0];
            return name || null;
          };
          for (const file of files.keys()) {
            const name = childOf(file);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const full = path === "" ? name : `${path}/${name}`;
            entries.push({ path: full, collection: !files.has(full) });
          }
          for (const collection of collections) {
            const name = childOf(collection);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            entries.push({ path: path === "" ? name : `${path}/${name}`, collection: true });
          }
        }
        const xml =
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<D:multistatus xmlns:D="DAV:">' +
          entries
            .map((entry) => {
              const href = `/${entry.path
                .split("/")
                .filter(Boolean)
                .map((segment) => encodeURIComponent(segment))
                .join("/")}${entry.collection ? "/" : ""}`;
              const resourcetype = entry.collection
                ? "<D:resourcetype><D:collection/></D:resourcetype>"
                : "<D:resourcetype/>";
              return (
                `<D:response><D:href>${href}</D:href>` +
                `<D:propstat><D:prop>${resourcetype}</D:prop>` +
                "<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"
              );
            })
            .join("") +
          "</D:multistatus>";
        return new Response(xml, {
          status: 207,
          headers: { "content-type": "application/xml; charset=utf-8" },
        });
      }

      return new Response(null, { status: 405 });
    },
  };
  return server;
}
