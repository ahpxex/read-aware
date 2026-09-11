import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, validateInteractionForm, validateInteractionFormValues } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

const base = {
  id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$" }),
  label: Type.String({ minLength: 1, maxLength: 200 }),
  required: Type.Optional(Type.Boolean()),
};
const fields = Type.Union([
  Type.Object({ ...base, kind: Type.Union([Type.Literal("text"), Type.Literal("textarea")]),
    maxLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })), value: Type.Optional(Type.String({ maxLength: 4000 })) }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("number"), min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()), value: Type.Optional(Type.Number()) }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("select"), value: Type.Optional(Type.String()), options: Type.Array(
    Type.Object({ value: Type.String({ minLength: 1, maxLength: 128 }), label: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
    { minItems: 1, maxItems: 32 }) }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("checkbox"), value: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);

export function buildInteractionFormTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "ask_user_form", label: "Collect structured answers", executionMode: "sequential",
    description: "Pause to collect 1-8 related non-sensitive answers in one inline form when the task genuinely needs several fields. Use the user's language for title/labels. Fields: text, textarea, number, select (1-32 fixed choices) and checkbox. Optional empty answers return null; checkbox false is a valid answer, never approval. A supplied value is only a visible initial draft, not an answer until the user submits. Prefer ask_user for a single clarifying question. Never request credentials, payment details or secrets; this form does not authorize destructive actions, grant permissions or lift spoiler boundaries. Subsequent writes still use their existing tools and approvals. No callbacks, dynamic options or arbitrary JSON Schema. Entire request must fit 16384 characters.",
    parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 300 }), fields: Type.Array(fields, { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const form = validateInteractionForm(params);
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope),
        request: { kind: "form", ...form }, signal, onUpdate });
      if (answer.cancelled) return { ...textResult({ answered: false, reason: "The user skipped the form." }), details };
      const result = validateInteractionFormValues(form, answer.values);
      if (Object.keys(result.errors).length) throw new AppError("ai/invalid-interaction", "Invalid structured form response");
      return { ...textResult({ answered: true, values: result.values }), details: { ...details, answer: { values: result.values } } };
    },
  };
}
