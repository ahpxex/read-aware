import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelReadingContext } from "@read-aware/core";
import type { CompleteFn, StreamFn, InferenceSourceTracking } from "../models/complete";
import { classifyModelFailure } from "../models/failure";
import type { ModelRole } from "../models/roles";
import { extractJsonObject, schemaViolations } from "../structured";
import { modelReadingPrompt, validateModelReadingContext } from "./model-reading-context";
import { readingContextCall, type ReadingContextPolicy } from "./reading-context-policy";

export type OneShotInput = InferenceSourceTracking & {
  prompt: string;
  system?: string;
  model?: ModelRole;
  readingContext?: ModelReadingContext;
  schema?: Record<string, unknown>;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
};

export async function askOneShot(input: OneShotInput, deps: {
  resolveModel: (role: ModelRole) => Model<Api>;
  completeFns: Record<ModelRole, CompleteFn>;
  streamFns: Record<ModelRole, StreamFn>;
  readingContextPolicy?: ReadingContextPolicy;
}): Promise<unknown> {
  if (input.schema && input.onText) throw new Error("ask: schema and onText are mutually exclusive");
  const reading = input.readingContext === undefined ? undefined : validateModelReadingContext(input.readingContext);
  const failed = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, failed.signal]) : failed.signal;
  const call = readingContextCall(reading ? deps.readingContextPolicy : undefined, signal);
  try {
    call?.assertAllowed();
    const originalPrompt = reading ? modelReadingPrompt(input.prompt, reading, call!.permissions) : input.prompt;
    const complete = async (system: string | undefined, prompt: string): Promise<string> => {
      call?.assertAllowed();
      const role = input.model ?? "fast";
      const model = deps.resolveModel(role);
      const context = { systemPrompt: system, messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }] };
      const run = async () => {
        let message;
        if (input.onText) {
          const stream = deps.streamFns[role](model, context, { signal: call.signal, trackSource: input.trackSource });
          for await (const event of stream) {
            call?.assertAllowed();
            if (event.type === "text_delta") await call.wait(Promise.resolve(input.onText!(event.delta)));
          }
          message = await stream.result();
        } else {
          message = await deps.completeFns[role](model, context, { signal: call.signal, trackSource: input.trackSource });
        }
        call?.assertAllowed();
        if (message.stopReason === "error") throw classifyModelFailure(message.errorMessage ?? "ask failed");
        if (message.stopReason === "aborted") throw new Error(message.errorMessage ?? "ask aborted");
        return message.content.filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map(block => block.text).join("");
      };
      return call ? call.wait(run()) : run();
    };
    if (!input.schema) return await complete(input.system, originalPrompt);

    const instruction = "Return ONLY a single JSON object — no prose, no markdown, no code fences. " +
      `It must validate against this JSON Schema:\n${JSON.stringify(input.schema)}`;
    const system = input.system ? `${input.system}\n\n${instruction}` : instruction;
    let feedback = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0 ? originalPrompt
        : `${originalPrompt}\n\nYour previous reply was invalid (${feedback}). Reply again with ONLY the corrected JSON object.`;
      const text = await complete(system, prompt);
      try {
        const value: unknown = JSON.parse(extractJsonObject(text));
        const problems = schemaViolations(value, input.schema);
        if (problems.length === 0) return value;
        feedback = problems.slice(0, 5).join("; ");
      } catch (error) { feedback = error instanceof Error ? error.message : String(error); }
    }
    throw new Error(`structured ask failed schema validation: ${feedback}`);
  } catch (error) {
    failed.abort(error);
    throw error;
  } finally { call.dispose(); }
}
