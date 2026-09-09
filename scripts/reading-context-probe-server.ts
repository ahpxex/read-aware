/** Loopback-only request evidence for the isolated desktop reading privacy probe. */
const records: Array<{ selected: boolean; viewport: boolean; grounding: boolean; held: boolean; cancelled: boolean }> = [];
const releases = new Set<() => void>();
const encoder = new TextEncoder();
let hold = false;
Bun.serve({
  hostname: "127.0.0.1", port: 19843,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/state") return Response.json(records);
    if (path === "/hold") { hold = true; return new Response("ok"); }
    if (path === "/release") {
      hold = false;
      for (const release of [...releases]) release();
      return new Response("ok");
    }
    if (path !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
    const body = await request.json() as { messages: unknown[] };
    const input = JSON.stringify(body.messages);
    const record = { selected: input.includes("SELECTION_MARKER_947"), viewport: input.includes("VIEWPORT_MARKER_628"),
      grounding: input.includes("<grounding_context>"), held: hold, cancelled: false };
    records.push(record);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let release!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        release = () => {
          if (heartbeat) clearInterval(heartbeat);
          releases.delete(release);
          if (record.cancelled) return;
          send({ id: "context-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe",
            choices: [{ index: 0, delta: { role: "assistant", content: "Controlled reading privacy answer." }, finish_reason: null }] });
          send({ id: "context-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
        };
        if (hold) {
          releases.add(release);
          heartbeat = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 100);
        } else release();
      },
      cancel() { record.cancelled = true; if (heartbeat) clearInterval(heartbeat); releases.delete(release); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});
console.log("Reading context probe: http://127.0.0.1:19843");
