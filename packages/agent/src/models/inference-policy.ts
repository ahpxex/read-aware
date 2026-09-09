import { AppError, ERR_AI_LOCAL_ONLY } from "@read-aware/core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";

/** Host policy is checked again for every model call, including cached runtimes. */
export interface InferencePolicy {
  localOnly(): boolean;
  subscribe(listener: () => void): () => void;
}

export function localOnlyError(): AppError {
  return new AppError(ERR_AI_LOCAL_ONLY, "[ai/local-only] Remote inference is disabled by local-only mode.");
}

export function inferenceCall(policy: InferencePolicy, signal?: AbortSignal) {
  const controller = new AbortController();
  const check = () => { if (policy.localOnly()) controller.abort(localOnlyError()); };
  const abort = () => controller.abort(signal?.reason);
  const unsubscribe = policy.subscribe(check);
  signal?.addEventListener("abort", abort, { once: true });
  check();
  if (signal?.aborted) abort();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  // A preflight rejection can precede the first raced operation.
  void aborted.catch(() => {});
  let disposed = false;
  return {
    signal: controller.signal,
    assertAllowed() { check(); controller.signal.throwIfAborted(); },
    wait<T>(operation: Promise<T>): Promise<T> { return Promise.race([operation, aborted]); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", onAbort);
    },
  };
}

export type InferenceCall = ReturnType<typeof inferenceCall>;

/** Preserve pi's terminal-event contract while suppressing late provider output. */
export function guardedInferenceStream(
  model: Model<Api>,
  call: InferenceCall,
  start: () => AssistantMessageEventStream,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void (async () => {
    let partial: AssistantMessage | undefined;
    try {
      call.assertAllowed();
      const upstream = start();
      const iterator = upstream[Symbol.asyncIterator]();
      while (true) {
        const next = await call.wait(iterator.next());
        call.assertAllowed();
        if (next.done) break;
        // Providers mutate their cumulative message in place, even after abort.
        if ("partial" in next.value) partial = structuredClone(next.value.partial);
        if (next.value.type === "done" || next.value.type === "error") {
          call.dispose();
          output.push(next.value);
          return;
        }
        output.push("partial" in next.value ? { ...next.value, partial: partial! } : next.value);
      }
      const result = await call.wait(upstream.result());
      call.assertAllowed();
      call.dispose();
      output.end(result);
    } catch (error) {
      const message: AssistantMessage = {
        ...(partial ? structuredClone(partial) : {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        }),
        stopReason: error instanceof AppError ? "error" : call.signal.aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      call.dispose();
      output.push({ type: "error", reason: message.stopReason as "error" | "aborted", error: message });
      output.end(message);
    } finally { call.dispose(); }
  })();
  return output;
}
