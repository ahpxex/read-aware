import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps, UserInteractionOption } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

const optionSchema = Type.Object({
  id: Type.String({ description: "Short stable id, such as summarize or compare" }),
  label: Type.String({ description: "Concise choice label in the user's language" }),
  description: Type.Optional(
    Type.String({ description: "One short sentence explaining this choice" }),
  ),
});

/** A first-class pause in the current tool loop, resolved by the in-chat UI. */
export function buildInteractionTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const askUser: AgentTool = {
    name: "ask_user",
    label: "Ask the user",
    description:
      "Pause and ask one concise clarifying question when materially different interpretations remain after using available read tools. Supply 2-4 useful choices in the user's language; the UI also lets them type a custom answer. Do not use this for rhetorical or ordinary conversational questions.",
    parameters: Type.Object({
      question: Type.String({ description: "One direct question in the user's language" }),
      options: Type.Array(optionSchema, {
        minItems: 2,
        maxItems: 4,
        description: "Mutually distinct, actionable choices",
      }),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { question, options } = params as {
        question: string;
        options: UserInteractionOption[];
      };
      const normalized = options.map((option) => ({
        id: option.id.trim(),
        label: option.label.trim(),
        description: option.description?.trim() || undefined,
      }));
      if (!question.trim()) throw new Error("question must not be empty");
      if (normalized.some((option) => !option.id || !option.label)) {
        throw new Error("every option needs a non-empty id and label");
      }
      if (new Set(normalized.map((option) => option.id)).size !== normalized.length) {
        throw new Error("option ids must be unique");
      }
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: {
          kind: "question",
          question: question.trim(),
          options: normalized,
          allowCustom: true,
        },
        signal,
        onUpdate,
      });
      return {
        ...textResult(
          answer.cancelled
            ? { answered: false, reason: "The user skipped the question." }
            : { answered: true, optionId: answer.optionId, answer: answer.text },
        ),
        details,
      };
    },
  };

  return [askUser];
}
