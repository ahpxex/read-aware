import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { ThreadChunk } from "../chunks";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

const noopComplete = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

async function collect(iterable: AsyncIterable<ThreadChunk>): Promise<ThreadChunk[]> {
  const chunks: ThreadChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

describe("settings flow", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => {
    faux?.unregister();
  });

  test("the core agent can update host settings in its normal tool loop", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("update_settings", {
            changes: {
              reading: { fontSize: "large" },
              ai: { preferences: { followStreaming: true } },
            },
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ]);
    const { deps, stores } = createInMemoryDeps();
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "settings-test" },
      deps,
      resolveModel: () => faux.getModel() as Model<Api>,
      getApiKey: () => "test-key",
      completeFn: noopComplete,
      streamFn: streamSimple,
    });

    const chunks = await collect(
      thread.sendTurn({ text: "Use larger reading text and follow streaming replies." }),
    );

    expect(stores.settings.reading.fontSize).toBe("large");
    expect(stores.settings.ai.preferences.followStreaming).toBe(true);
    expect(
      chunks.some(
        (chunk) =>
          chunk.type === "tool-step" &&
          chunk.tool === "update_settings" &&
          chunk.phase === "end" &&
          chunk.isError === false,
      ),
    ).toBe(true);
  });
});
