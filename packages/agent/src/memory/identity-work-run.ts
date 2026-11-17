import type { Api, Model } from "@earendil-works/pi-ai";
import type { CompleteFn } from "../models/complete";
import { identityBytes } from "./identity-input";
import { SOURCE_BYTES, DIGEST_BYTES, invalid } from "./identity-batch-state";

/** Model calls one consolidation pass may spend reducing an oversized input
 * and scanning a registry that does not fit beside it. Each call is bounded
 * (an input of at most 48 KB, 4096 output tokens); the resumable log this
 * replaced spent the same total across many four-call passes. A larger job
 * stays pending rather than running unbounded. */
export const MAX_IDENTITY_CALLS = 256;

export class WorkPaused extends Error {}

/** The model calls of one consolidation pass, in memory: an oversized input is
 * reduced and its registry scanned within the pass, and an interrupted pass
 * simply starts over next time. */
export function createIdentityWorkRun(input: {
  complete: CompleteFn;
  model: Model<Api>;
  maxTokens: number;
  signal?: AbortSignal;
}) {
  const { signal } = input;
  let calls = 0;
  const node = async <T>(
    body: unknown,
    prompt: string,
    validate: (value: unknown) => T,
    maxBytes = SOURCE_BYTES,
  ): Promise<T> => {
    signal?.throwIfAborted();
    const json = JSON.stringify(body);
    if (identityBytes(json) > maxBytes) return invalid();
    if (calls >= MAX_IDENTITY_CALLS) throw new WorkPaused("identity input needs more model calls than one pass allows");
    calls++;
    const response = await input.complete(
      input.model,
      { systemPrompt: prompt, messages: [{ role: "user", content: json, timestamp: Date.now() }] },
      { signal, maxTokens: input.maxTokens },
    );
    signal?.throwIfAborted();
    if (response.stopReason !== "stop" || response.content.some((part) => part.type === "toolCall")) return invalid();
    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (identityBytes(text) > DIGEST_BYTES) return invalid();
    return validate(JSON.parse(text));
  };
  return { node, calls: () => calls };
}
