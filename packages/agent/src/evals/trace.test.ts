import { describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import { buildAgentObservation, captureModelRequest, snapshotModelContext } from "./trace";

describe("agent eval trace", () => {
  test("pairs tool chunks and aggregates model telemetry", () => {
    const chunks: ThreadChunk[] = [
      { type: "status", status: "thinking" },
      {
        type: "tool-step",
        phase: "start",
        id: "call-1",
        tool: "search_book_text",
        args: { queries: ["clock"] },
      },
      {
        type: "tool-step",
        phase: "update",
        id: "call-1",
        tool: "search_book_text",
        output: "searching",
      },
      {
        type: "tool-step",
        phase: "end",
        id: "call-1",
        tool: "search_book_text",
        output: "found clock",
        isError: false,
      },
      {
        type: "interaction",
        phase: "request",
        request: {
          id: "question-1",
          threadKey: "book:one",
          kind: "question",
          question: "Which angle?",
          options: [],
          allowCustom: true,
        },
      },
      {
        type: "interaction",
        phase: "response",
        id: "question-1",
        answer: { text: "Historical" },
      },
      { type: "thinking", text: "brief thought" },
      { type: "text", text: "The clock stopped." },
      {
        type: "metric",
        round: 1,
        ttfbMs: 20,
        totalMs: 100,
        tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 },
        costUsd: 0.001,
      },
    ];
    const observation = buildAgentObservation({
      turns: [{ input: { text: "What happened?" }, chunks }],
      modelRequests: [],
      wallTimeMs: 120,
      state: { asks: 1 },
    });

    expect(observation).toMatchObject({
      answer: "The clock stopped.",
      thinking: "brief thought",
      tools: [
        {
          turn: 1,
          id: "call-1",
          name: "search_book_text",
          args: { queries: ["clock"] },
          output: "found clock",
          isError: false,
        },
      ],
      interactions: [
        { phase: "request", kind: "question", id: "question-1" },
        { phase: "response", id: "question-1" },
      ],
      telemetry: {
        wallTimeMs: 120,
        modelTimeMs: 100,
        meanTtfbMs: 20,
        rounds: 1,
        tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, total: 20 },
        costUsd: 0.001,
      },
      state: { asks: 1 },
    });
  });

  test("captures model-visible context while omitting image bytes and secret options", () => {
    const context: Context = {
      systemPrompt: "Use the cursor.",
      messages: [
        {
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "Read this" },
            { type: "image", mimeType: "image/png", data: "abcdef" },
          ],
        },
      ],
      tools: [],
    };
    const model = {
      provider: "test",
      id: "model",
      api: "openai-completions",
    } as unknown as Model<Api>;
    const request = captureModelRequest(1, 1, model, context, {
      apiKey: "must-not-appear",
      reasoning: "medium",
      cacheRetention: "short",
    });

    expect(JSON.stringify(snapshotModelContext(context))).toContain("omitted image data: 6 chars");
    expect(request.options).toEqual({ reasoning: "medium", cacheRetention: "short" });
    expect(JSON.stringify(request)).not.toContain("must-not-appear");
  });
});
