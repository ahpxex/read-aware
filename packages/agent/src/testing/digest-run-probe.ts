import type { RuntimeDeps } from "../ports";
import type { DigestBookTickInput } from "../memory/graph-upkeep";
import { digestBookCatchUp } from "../memory/graph-upkeep";

/** Scripted inference with real host ports; no model credentials or network. */
export function digestRunProbe(deps: RuntimeDeps, bookId: string, href: string) {
  let controller: AbortController | undefined, release: (() => void) | undefined, task: Promise<void> | undefined;
  let outcome: unknown, started = false;
  const inputs: Array<{ chapter: number; hasFutureName: boolean }> = [];
  const run = async (mode: "fail-first" | "success" | "pause") => {
    let paused = false;
    const complete: DigestBookTickInput["complete"] = async (_model, context) => {
      const chapter = Number(JSON.stringify(context.messages).match(/Chapter #(\d+)/)?.[1]);
      inputs.push({ chapter, hasFutureName: /Hidden|Secret future identity/.test(context.systemPrompt ?? "") });
      started = true;
      if (mode === "pause" && !paused) {
        paused = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      return { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: Date.now(),
        stopReason: mode === "fail-first" && chapter === 0 ? "length" : "stop",
        content: [{ type: "text", text: JSON.stringify({ summary: `Rebuilt chapter ${chapter}`, characters: [{ name: `Rebuilt${chapter}` }], relations: [] }) }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    };
    return digestBookCatchUp({ deps, bookId, throughChapterHref: href, model: { id: "fixture" } as DigestBookTickInput["model"], complete, concurrency: 1, signal: controller?.signal });
  };
  return {
    run: async (mode: "fail-first" | "success") => ({ report: await run(mode), inputs: [...inputs] }),
    begin() { if (task) throw Error("Probe running"); controller = new AbortController(); started = false; outcome = { status: "running" };
      task = run("pause").then(report => { outcome = { status: "done", report }; }, error => { outcome = { status: "cancelled-or-error", name: error?.name, code: error?.code }; }); },
    status: () => ({ outcome, started, inputs: [...inputs] }),
    cancel() { controller?.abort(); },
    async release() { release?.(); await task; task = undefined; controller = undefined; release = undefined; return outcome; },
    async dispose() { controller?.abort(); release?.(); await task; },
  };
}
