import { AppError } from "@read-aware/core";

const POLL_INTERVAL_MS = 300;
const TIMEOUT_MS = 10 * 60 * 1000;
let generation = 0;

/** How one Android picker is opened and how its parked result is collected. */
export interface ParkedPickChannel {
  start(generation: number): void | Promise<void>;
  take(): string | null | Promise<string | null>;
}

/**
 * Android parks a picker's result natively (MainActivity) and the webview
 * collects it, so a paused webview or an in-flight IPC call cannot lose the
 * user's choice. Each request carries a generation; a result left by an
 * abandoned pick is skipped. Resolves to the picked lines, empty when the user
 * cancelled. The parked result is
 * "<generation>\n<line>\n…", or a "__ERROR__:<message>" line on failure.
 */
export async function awaitParkedPick(channel: ParkedPickChannel, signal?: AbortSignal): Promise<string[]> {
  const request = ++generation;
  await channel.start(request);
  const deadline = performance.now() + TIMEOUT_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    signal?.throwIfAborted();
    const parked = await channel.take();
    if (parked == null) continue;
    const [parkedGeneration, ...lines] = parked.split("\n").filter(Boolean);
    if (Number(parkedGeneration) !== request) continue;
    const failure = lines.find((line) => line.startsWith("__ERROR__:"));
    if (failure)
      throw new AppError("ui/unavailable", `The native picker failed: ${failure.slice("__ERROR__:".length)}`);
    return lines;
  }
  throw new AppError("ui/unavailable", "The native picker timed out");
}
