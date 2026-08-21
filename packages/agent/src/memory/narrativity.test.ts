/** 叙事性分类器的解析与置信闸门：错分类比晚分类毒得多，宁缺勿滥。 */
import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { classifyNarrativity } from "./narrativity";

const MODEL = { id: "stub", api: "openai-completions", provider: "stub" } as unknown as Model<Api>;

function reply(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "stub",
    model: "stub",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  } as AssistantMessage;
}

const base = {
  model: MODEL,
  title: "某书",
  toc: [{ index: 0, title: "第一章", chars: 100 }],
  sampleText: "正文样本……",
};

describe("classifyNarrativity", () => {
  test("parses a confident verdict", async () => {
    const verdict = await classifyNarrativity({
      ...base,
      complete: async () => reply('{"narrativity": "expository", "confidence": 0.95}'),
    });
    expect(verdict).toBe("expository");
  });

  test("low confidence degrades to undefined (retry next idle tick)", async () => {
    const verdict = await classifyNarrativity({
      ...base,
      complete: async () => reply('{"narrativity": "narrative", "confidence": 0.4}'),
    });
    expect(verdict).toBeUndefined();
  });

  test("malformed output and provider failure both degrade to undefined", async () => {
    expect(
      await classifyNarrativity({ ...base, complete: async () => reply("是小说吧我觉得") }),
    ).toBeUndefined();
    expect(
      await classifyNarrativity({
        ...base,
        complete: async () => {
          throw new Error("provider down");
        },
      }),
    ).toBeUndefined();
    expect(
      await classifyNarrativity({
        ...base,
        complete: async () => reply('{"narrativity": "poetry", "confidence": 0.9}'),
      }),
    ).toBeUndefined();
  });
});
