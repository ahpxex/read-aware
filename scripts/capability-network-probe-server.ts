/** Local, credential-free endpoint for the isolated Tauri capability probes. */
const evidence: { path: string; method: string; token: string | null; body: number[]; aborted: boolean; completed: boolean }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 18884,
  idleTimeout: 30,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/evidence") return Response.json(evidence);
    const row = { path, method: request.method, token: request.headers.get("x-token"), body: [...new Uint8Array(await request.arrayBuffer())], aborted: false, completed: false };
    evidence.push(row);
    if (path === "/slow" || path.startsWith("/slow/")) {
      return new Promise<Response>(resolve => {
        const timer = setTimeout(() => { row.completed = true; resolve(new Response("late")); }, 10_000);
        request.signal.addEventListener("abort", () => {
          row.aborted = true; clearTimeout(timer); resolve(new Response("cancelled"));
        }, { once: true });
      });
    }
    row.completed = true;
    return Response.json(row);
  },
});
console.log(`Capability network probe: ${server.url}`);
