import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai/providers/faux";
import type { ThreadChunk } from "../chunks";
import type { UserInteractionAnswer } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import { AgentThread } from "./thread";

const noopComplete = async () => fauxAssistantMessage('{"new": [], "reinforced": []}');

describe("interaction flow", () => {
  let faux: FauxProviderRegistration;

  afterEach(() => {
    faux?.unregister();
  });

  test("streams the question, pauses the tool loop, then resumes with the answer", async () => {
    faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    const model = faux.getModel() as Model<Api>;
    let secondRound: Context | undefined;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("ask_user", {
            question: "How should I approach this?",
            options: [
              { id: "summary", label: "Summarize" },
              { id: "compare", label: "Compare" },
            ],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        secondRound = context;
        return fauxAssistantMessage("I will compare them.");
      },
    ]);
    const { deps } = createInMemoryDeps();
    let resolveAnswer: ((answer: UserInteractionAnswer) => void) | undefined;
    deps.interactions.request = () =>
      new Promise<UserInteractionAnswer>((resolve) => {
        resolveAnswer = resolve;
      });
    const thread = new AgentThread({
      scope: { kind: "global", threadId: "thread-1" },
      deps,
      resolveModel: () => model,
      getApiKey: () => "test-key",
      completeFn: noopComplete,
    });
    const chunks: ThreadChunk[] = [];
    let finished = false;
    const running = (async () => {
      for await (const chunk of thread.sendTurn({ text: "Help me with two books" })) {
        chunks.push(chunk);
      }
      finished = true;
    })();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (chunks.some((chunk) => chunk.type === "interaction" && chunk.phase === "request")) {
        break;
      }
      await Bun.sleep(1);
    }
    expect(finished).toBe(false);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "interaction",
        phase: "request",
        request: expect.objectContaining({ kind: "question", question: "How should I approach this?" }),
      }),
    );

    resolveAnswer?.({ optionId: "compare", text: "Compare" });
    await running;

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "interaction",
        phase: "response",
        answer: { optionId: "compare", text: "Compare" },
      }),
    );
    expect(chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join(""))
      .toBe("I will compare them.");
    expect(JSON.stringify(secondRound?.messages ?? [])).toContain("Compare");
  });
});
