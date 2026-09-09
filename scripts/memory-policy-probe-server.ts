/** Controlled loopback inference for the isolated desktop memory-policy probe. */
const records: Array<{ kind: string; goal: boolean; held: boolean; cancelled: boolean }> = [];
const releases = new Set<() => void>();
let holdExtraction = false;
const encoder = new TextEncoder();
Bun.serve({
  hostname: "127.0.0.1", port: 19843,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/state") return Response.json(records);
    if (url.pathname === "/hold") { holdExtraction = true; return new Response("ok"); }
    if (url.pathname === "/release") { holdExtraction = false; for (const release of releases) release(); releases.clear(); return new Response("ok"); }
    if (url.pathname !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
    const body = await request.json() as { messages: Array<{ role: string; content: unknown }> };
    const system = body.messages.filter(message => message.role === "system" || message.role === "developer").map(message => JSON.stringify(message.content)).join("\n");
    const kind = system.includes('"reinforced"') || system.includes('\\"reinforced\\"') ? "extraction" : system.includes("rolling summary") ? "summary" : "chat";
    const record = { kind, goal: JSON.stringify(body.messages).includes("Memory policy probe goal"), held: holdExtraction && kind === "extraction", cancelled: false };
    records.push(record);
    let release!: () => void;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        const finish = () => {
          if (timer) clearInterval(timer);
          releases.delete(release);
          if (record.cancelled) return;
          const text = kind === "extraction" ? '{"new":[],"reinforced":[]}' : kind === "summary" ? "Memory policy probe summary." : "Memory policy probe answer.";
          send({ id: "memory-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] });
          send({ id: "memory-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
        };
        release = finish;
        if (record.held) { releases.add(release); timer = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 100); }
        else finish();
      },
      cancel() { record.cancelled = true; if (timer) clearInterval(timer); releases.delete(release); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});
console.log("Memory policy probe: http://127.0.0.1:19843");
