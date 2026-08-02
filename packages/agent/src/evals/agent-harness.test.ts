import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, type FauxProviderRegistration } from "@earendil-works/pi-ai/providers/faux";
import { createAgentEvalVariant, defineAgentEvalScenario } from "./agent-harness";

describe("agent eval harness", () => {
  let faux: FauxProviderRegistration | undefined;

  afterEach(() => {
    faux?.unregister();
    faux = undefined;
  });

  test("runs the real AgentThread and captures model-visible prompts and state", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    faux.setResponses([fauxAssistantMessage("The cursor says seventeen past nine.")]);
    const model = faux.getModel() as Model<Api>;
    const scenario = defineAgentEvalScenario({
      id: "cursor",
      description: "cursor",
      scope: { kind: "global", threadId: "eval-thread" },
      turns: [{ text: "What time is shown?" }],
      expectation: { answer: { mustContain: ["seventeen", "nine"] } },
      observeState: ({ stores }) => ({
        persistedTurns: stores.turns.get("global:eval-thread")?.length ?? 0,
      }),
    });
    const variant = createAgentEvalVariant({
      id: "faux",
      modelId: model.id,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      streamFn: streamSimple,
      thinkingLevel: "off",
      transformSystemPrompt: (prompt) => `EVAL PREFIX\n${prompt}`,
    });
    const controller = new AbortController();

    const result = await variant.run(scenario, { repetition: 1, signal: controller.signal });
    const assessment = await scenario.evaluate(result.observation);

    expect(assessment.passed).toBe(true);
    expect(result.observation.state).toEqual({ persistedTurns: 2 });
    expect(result.observation.modelRequests).toHaveLength(1);
    expect(result.observation.modelRequests[0]?.context.systemPrompt).toStartWith("EVAL PREFIX");
    expect(JSON.stringify(result.observation.modelRequests[0]?.context.messages)).toContain(
      "What time is shown?",
    );
  });
});
