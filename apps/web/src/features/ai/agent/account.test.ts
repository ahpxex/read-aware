import { describe, expect, test } from "bun:test";
import { accountFromConfig } from "./account";
import { DEFAULT_THINKING_LEVEL } from "../lib/ai-config";

describe("accountFromConfig", () => {
  test("uses the primary model for both roles by default", () => {
    const result = accountFromConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.5",
    });

    expect(result.models).toEqual({ smart: "gpt-5.5", fast: "gpt-5.5" });
    expect(result.thinking).toEqual({
      smart: DEFAULT_THINKING_LEVEL,
      fast: DEFAULT_THINKING_LEVEL,
    });
  });

  test("preserves explicit advanced overrides", () => {
    const result = accountFromConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-opus-5",
      fastModel: "claude-haiku-4-5",
      thinkingLevel: "high",
      fastThinkingLevel: "off",
    });

    expect(result.models).toEqual({
      smart: "claude-opus-5",
      fast: "claude-haiku-4-5",
    });
    expect(result.thinking).toEqual({ smart: "high", fast: "off" });
  });

  test("shares thinking effort when Fast uses the primary model", () => {
    const result = accountFromConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.5",
      fastModel: "gpt-5.5",
      thinkingLevel: "high",
      fastThinkingLevel: "off",
    });

    expect(result.models).toEqual({ smart: "gpt-5.5", fast: "gpt-5.5" });
    expect(result.thinking).toEqual({ smart: "high", fast: "high" });
  });
});
