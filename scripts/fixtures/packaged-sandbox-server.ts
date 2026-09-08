// Only fixed test strings are received. Never bind this diagnostic off loopback.
const requests: Array<{ path: string; origin: string | null; at: string }> = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 18886,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/results") return Response.json(requests);
    if (path === "/control") return new Response("loopback-ready");
    if (!path.startsWith("/probe/")) return new Response("Not found", { status: 404 });
    const entry = { path, origin: request.headers.get("origin"), at: new Date().toISOString() };
    requests.push(entry);
    console.log(JSON.stringify(entry));
    return new Response(path.endsWith(".js") ? 'export const probe = "fixed-test-marker";' : "fixed-test-marker", {
      headers: { "access-control-allow-origin": "*", "content-type": path.endsWith(".js") ? "text/javascript" : "text/plain" },
    });
  },
});
console.log(`Listening on ${server.url}`);
