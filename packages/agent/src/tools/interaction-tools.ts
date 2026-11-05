import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeDeps, UserInteractionOption } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { interactionGrantsSpoilerPermission } from "./spoiler-permission";
import { textResult } from "./tool-result";
import type { AgentTurnState } from "./turn-state";
import { requestUserInteraction } from "./user-interaction";
import { buildInteractionFormTool } from "./interaction-form-tool";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";

const optionSchema = obj({
  id: str({ description: "Short stable id, such as summarize or compare" }),
  label: str({ description: "Concise choice label in the user's language" }),
  description: opt(str({ description: "One short sentence explaining this choice" })),
});

/** A first-class pause in the current tool loop, resolved by the in-chat UI. */
export function buildInteractionTools(scope: ThreadScope, deps: RuntimeDeps, turnState?: AgentTurnState): AgentTool[] {
  const askUser: AgentTool = {
    name: "ask_user",
    label: "Ask the user",
    description:
      "Pause and ask one concise clarifying question when materially different interpretations remain after using available read tools. Supply 2-4 useful choices in the user's language; the UI also lets them type a custom answer. Do not use this for rhetorical or ordinary conversational questions.",
    parameters: obj({
      question: str({ description: "One direct question in the user's language" }),
      options: arr(optionSchema, {
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
      if (turnState && interactionGrantsSpoilerPermission({ question, options: normalized, answer })) {
        turnState.spoilerPermissionGranted = true;
        turnState.spoilerPermissionDenied = false;
      }
      return {
        ...textResult(
          answer.cancelled
            ? {
                answered: false,
                reason:
                  "The user skipped the question. The requested choice remains unresolved: stop the dependent operation without choosing a default or requesting destructive approval for a guessed target.",
              }
            : { answered: true, optionId: answer.optionId, answer: answer.text },
        ),
        details,
      };
    },
  };

  return [askUser, buildInteractionFormTool(scope, deps)];
}
