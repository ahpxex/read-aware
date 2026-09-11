// Loopback-only deterministic Atom source for native plugin composition acceptance.
let revision = 1, unavailable = false, requests = 0, delayMs = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 19846, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/state") return Response.json({ revision, unavailable, requests, delayMs });
  if (url.pathname === "/control" && request.method === "POST") {
    const value = await request.json() as { revision?: number; unavailable?: boolean; delayMs?: number };
    if (value.revision === 1 || value.revision === 2) revision = value.revision;
    if (typeof value.unavailable === "boolean") unavailable = value.unavailable;
    if (typeof value.delayMs === "number" && Number.isInteger(value.delayMs) && value.delayMs >= 0 && value.delayMs <= 20_000) delayMs = value.delayMs;
    return Response.json({ revision, unavailable, requests, delayMs });
  }
  if (url.pathname !== "/feed.atom") return new Response("Not found", { status: 404 });
  requests++;
  if (delayMs) await Bun.sleep(delayMs);
  if (unavailable) return new Response("Owned fixture unavailable", { status: 503 });
  const extra = revision === 2 ? '<entry><id>urn:composition:new</id><title>New article</title><updated>2026-09-11T01:00:00Z</updated><content type="html">&lt;p&gt;Newly published article.&lt;/p&gt;</content></entry>' : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:composition:feed</id><title>RSS Composition 19846</title><updated>2026-09-11T0${revision}:00:00Z</updated>${extra}
<entry><id>urn:composition:stable</id><title>Stable article</title><updated>2026-09-11T00:00:00Z</updated><content type="html">&lt;h1&gt;Stable article&lt;/h1&gt;&lt;p&gt;Edition ${revision === 1 ? "One" : "Two"}: locally cached reading content.&lt;/p&gt;</content></entry>
<entry><id>urn:composition:second</id><title>Second article</title><updated>2026-09-10T00:00:00Z</updated><content type="html">&lt;p&gt;Second article body.&lt;/p&gt;</content></entry></feed>`, { headers: { "Content-Type": "application/atom+xml" } });
} });
console.log(`RSS fixture listening on ${server.url}`);
