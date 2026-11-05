import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  AppError,
  normalizeOnboardingChange,
  validateInteractionForm,
  validateInteractionFormValues,
} from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";
import { obj, str } from "@earendil-works/pi-schema";

const labels = {
  goals: str({ minLength: 1, maxLength: 200 }),
  background: str({ minLength: 1, maxLength: 200 }),
  explanationDepth: str({ minLength: 1, maxLength: 200 }),
  language: str({ minLength: 1, maxLength: 200 }),
};

/** One conversation tool owns collection, complete review, and the atomic decision.
 * Model-generated labels cannot supply answers or bypass the second approval. */
export function buildOnboardingTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "onboard_reader",
    label: "Set up reading profile",
    executionMode: "sequential",
    description:
      "Offer this optional interview in a global conversation when the reader has no profile and wants to introduce their reading preferences. Provide a warm title and four short labels in the reader's language for goals, background, explanationDepth, language. The host collects the actual answers, shows the entire profile and every seed memory for explicit approval, then saves everything atomically. No answers are inferred or prefilled. Skipping or declining writes nothing. Existing nonempty profiles are not replaced: use get_user_profile/update_user_profile for corrections. No separate remember calls for these answers. A concurrent profile edit requires restarting and renewed confirmation. The event-backed receipt includes stable memory IDs; this is not a guarantee about remote sync or model quality.",
    parameters: obj({
      title: str({ minLength: 1, maxLength: 300 }),
      labels: obj(labels),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (scope.kind !== "global")
        throw new AppError("memory/forbidden", "Onboarding belongs to the global conversation");
      const allowed = () => {
        signal?.throwIfAborted();
        if (deps.memoryPolicy && !deps.memoryPolicy.enabled())
          throw new AppError("ai/memory-disabled", "Building memory is disabled");
      };
      allowed();
      const previous = await deps.profile.readProfile({ limit: 2 }, signal);
      if (previous.totalLength) return textResult({ status: "already-configured", revision: previous.revision });
      const input = params as { title: string; labels: Record<keyof typeof labels, string> };
      const form = validateInteractionForm({
        title: input.title,
        fields: (Object.keys(labels) as Array<keyof typeof labels>).map((id) => ({
          id,
          kind: "textarea",
          label: input.labels[id],
          maxLength: 3700,
        })),
      });
      const threadKey = threadScopeKey(scope);
      const collected = await requestUserInteraction({
        deps,
        toolCallId: `${toolCallId}:answers`,
        threadKey,
        request: { kind: "form", ...form },
        signal,
        onUpdate,
      });
      if (collected.answer.cancelled) return { ...textResult({ status: "cancelled" }), details: collected.details };
      const validated = validateInteractionFormValues(form, collected.answer.values);
      if (Object.keys(validated.errors).length)
        throw new AppError("ai/invalid-interaction", "Invalid onboarding answers");
      const seeds = form.fields.flatMap((field) => {
        const value = validated.values[field.id];
        return typeof value === "string" && value.trim()
          ? [
              {
                kind: field.id === "background" ? ("fact" as const) : ("preference" as const),
                content: `${field.label}: ${value.trim()}`,
              },
            ]
          : [];
      });
      if (!seeds.length) return { ...textResult({ status: "cancelled" }), details: collected.details };
      const candidate = normalizeOnboardingChange({
        submissionId: crypto.randomUUID(),
        expectedRevision: previous.revision,
        summary: seeds.map((seed) => seed.content).join("\n"),
        seeds,
      });
      allowed();
      const approved = await requestUserInteraction({
        deps,
        toolCallId: `${toolCallId}:confirm`,
        threadKey,
        signal,
        onUpdate,
        request: {
          kind: "permission",
          action: "complete-onboarding",
          subject: candidate.summary,
          onboardingSeeds: structuredClone(candidate.seeds),
        },
      });
      if (approved.answer.cancelled || approved.answer.optionId !== "approve")
        return { ...textResult({ status: "cancelled" }), details: approved.details };
      allowed();
      // Native CAS is checked after approval. Once dispatched, return the real
      // receipt even if the caller cancels; never call a committed write undone.
      return { ...textResult(await deps.profile.completeOnboarding(candidate, signal)), details: approved.details };
    },
  };
}
