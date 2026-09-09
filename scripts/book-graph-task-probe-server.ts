/** Loopback-only scripted model for native public graph-task contract tests. */
const records: Array<{ chapter: number; held: boolean; failed: boolean; cancelled: boolean }> = [];
const releases = new Set<() => void>();
let failFirst = false, hold = false;
const encoder = new TextEncoder();
Bun.serve({ hostname: "127.0.0.1", port: 19844, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/state") return Response.json(records);
  if (path === "/fail") { failFirst = true; return new Response("ok"); }
  if (path === "/hold") { hold = true; return new Response("ok"); }
  if (path === "/release") { hold = false; for (const release of [...releases]) release(); return new Response("ok"); }
  if (path !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
  const body = await request.json() as { messages: unknown };
  const chapter = Number(JSON.stringify(body.messages).match(/Chapter #(\d+)/)?.[1] ?? -1);
  const record = { chapter, held: hold, failed: failFirst && chapter === 0, cancelled: false };
  if (record.failed) failFirst = false;
  records.push(record);
  let release!: () => void, timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    release = () => {
      if (timer) clearInterval(timer); releases.delete(release);
      if (record.cancelled) return;
      const content = chapter < 0 ? '{"narrativity":"narrative"}' : JSON.stringify({ summary: `Public task chapter ${chapter}`, characters: [{ name: `Task${chapter}` }], relations: [] });
      send({ id: "graph-task", object: "chat.completion.chunk", created: 1, model: "graph-task", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
      send({ id: "graph-task", object: "chat.completion.chunk", created: 1, model: "graph-task", choices: [{ index: 0, delta: {}, finish_reason: record.failed ? "length" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    };
    if (hold) { releases.add(release); timer = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 100); }
    else release();
  }, cancel() { record.cancelled = true; if (timer) clearInterval(timer); releases.delete(release); } });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
} });
console.log("Graph task probe: http://127.0.0.1:19844");
